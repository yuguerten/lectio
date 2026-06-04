import test from "node:test";
import assert from "node:assert/strict";
import {
  LISTEN_WORD_PATTERN,
  buildSegmentTimeline,
  buildWordTimeline,
  findSegmentIndexAtTime,
  findWordIndexAtTime,
  tokenizeListenSegments,
  tokenizeWords
} from "../src/core/listenTokenizer.js";

test("tokenizeWords returns empty array for empty input", () => {
  assert.deepEqual(tokenizeWords(""), []);
  assert.deepEqual(tokenizeWords(null), []);
  assert.deepEqual(tokenizeWords(undefined), []);
});

test("tokenizeWords finds simple words and skips punctuation", () => {
  const tokens = tokenizeWords("Hello, world! How are you?");
  assert.deepEqual(
    tokens.map((t) => t.word),
    ["Hello", "world", "How", "are", "you"]
  );
  assert.equal(tokens[0].charStart, 0);
  assert.equal(tokens[0].charEnd, 5);
  assert.equal(tokens[1].charStart, 7);
});

test("tokenizeWords keeps apostrophes inside one word", () => {
  const tokens = tokenizeWords("don't worry; it's fine.");
  assert.deepEqual(
    tokens.map((t) => t.word),
    ["don't", "worry", "it's", "fine"]
  );
  const curly = tokenizeWords("it\u2019s a test");
  assert.deepEqual(
    curly.map((t) => t.word),
    ["it\u2019s", "a", "test"]
  );
});

test("tokenizeWords captures character offsets", () => {
  const text = "Foo bar baz";
  const tokens = tokenizeWords(text);
  for (const token of tokens) {
    assert.equal(text.slice(token.charStart, token.charEnd), token.word);
  }
});

test("LISTEN_WORD_PATTERN is global and matches ascii words", () => {
  const matches = [...String("one two three").matchAll(LISTEN_WORD_PATTERN)].map((m) => m[0]);
  assert.deepEqual(matches, ["one", "two", "three"]);
});

test("buildWordTimeline produces a duration that sums to total audio length", () => {
  const text = "one two three four five";
  const timeline = buildWordTimeline(text, 10);
  assert.equal(timeline.tokens.length, 5);
  assert.equal(Math.round(timeline.tokens[0].start * 1000), 0);
  assert.equal(Math.round(timeline.tokens.at(-1).end * 1000), 10000);
  for (let i = 1; i < timeline.tokens.length; i += 1) {
    assert.ok(timeline.tokens[i].start >= timeline.tokens[i - 1].start);
  }
});

test("buildWordTimeline allocates time proportional to word length", () => {
  const text = "a longerword bb";
  const timeline = buildWordTimeline(text, 12);
  const short1 = timeline.tokens[0];
  const long = timeline.tokens[1];
  const short2 = timeline.tokens[2];
  assert.ok(long.end - long.start > short1.end - short1.start);
  assert.ok(long.end - long.start > short2.end - short2.start);
});

test("buildWordTimeline returns zero duration slots when duration is invalid", () => {
  const timeline = buildWordTimeline("hello world", 0);
  for (const token of timeline.tokens) {
    assert.equal(token.start, 0);
    assert.equal(token.end, 0);
  }
  const noDuration = buildWordTimeline("hello world", NaN);
  for (const token of noDuration.tokens) {
    assert.equal(token.start, 0);
    assert.equal(token.end, 0);
  }
});

test("buildWordTimeline handles empty or whitespace-only text", () => {
  const empty = buildWordTimeline("", 5);
  assert.equal(empty.tokens.length, 0);
  assert.equal(empty.totalChars, 0);
  const whitespace = buildWordTimeline("   \n\t  ", 5);
  assert.equal(whitespace.tokens.length, 0);
});

test("findWordIndexAtTime returns -1 for empty timeline or invalid time", () => {
  assert.equal(findWordIndexAtTime(null, 1), -1);
  assert.equal(findWordIndexAtTime({ tokens: [], duration: 10 }, 1), -1);
  assert.equal(findWordIndexAtTime({ tokens: [{ start: 0, end: 1, word: "a" }], duration: 1 }, -1), -1);
  assert.equal(findWordIndexAtTime({ tokens: [{ start: 0, end: 1, word: "a" }], duration: 1 }, NaN), -1);
});

test("findWordIndexAtTime locates the active word for any timestamp", () => {
  const text = "a bb ccc dddd eeeee";
  const timeline = buildWordTimeline(text, 15);
  assert.equal(findWordIndexAtTime(timeline, 0), 0);
  assert.equal(findWordIndexAtTime(timeline, 0.5), 0);
  assert.equal(findWordIndexAtTime(timeline, 1.0), 1);
  assert.equal(findWordIndexAtTime(timeline, 2.0), 1);
  assert.equal(findWordIndexAtTime(timeline, 3.0), 2);
  assert.equal(findWordIndexAtTime(timeline, 5.5), 2);
  assert.equal(findWordIndexAtTime(timeline, 6.0), 3);
  assert.equal(findWordIndexAtTime(timeline, 9.5), 3);
  assert.equal(findWordIndexAtTime(timeline, 10.0), 4);
  assert.equal(findWordIndexAtTime(timeline, 14.5), 4);
  assert.equal(findWordIndexAtTime(timeline, 999), 4);
});

test("findWordIndexAtTime is monotonic as time advances", () => {
  const text = "a bb ccc dddd eeeee";
  const timeline = buildWordTimeline(text, 15);
  let previous = -1;
  for (let t = 0; t <= 15; t += 0.5) {
    const index = findWordIndexAtTime(timeline, t);
    assert.ok(index >= previous, `time ${t} regressed from ${previous} to ${index}`);
    previous = index;
  }
});


test("tokenizeListenSegments groups text into sentence-level passages", () => {
  const text = "First sentence. Second sentence is longer! Third has no punctuation";
  const segments = tokenizeListenSegments(text);
  assert.deepEqual(
    segments.map((segment) => segment.text),
    ["First sentence.", "Second sentence is longer!", "Third has no punctuation"]
  );
  for (const segment of segments) {
    assert.equal(text.slice(segment.charStart, segment.charEnd), segment.text);
  }
});

test("tokenizeListenSegments splits very long passages at soft breaks", () => {
  const text = "This is a long setup, with a useful pause, and enough additional words to force a segment split before the final period.";
  const segments = tokenizeListenSegments(text, { maxChars: 45 });
  assert.ok(segments.length > 1);
  assert.match(segments[0].text, /pause,$/);
});

test("buildSegmentTimeline and findSegmentIndexAtTime track active passages", () => {
  const timeline = buildSegmentTimeline("Short. A much longer sentence follows here. End.", 12);
  assert.equal(timeline.segments.length, 3);
  assert.equal(findSegmentIndexAtTime(timeline, 0), 0);
  assert.equal(findSegmentIndexAtTime(timeline, timeline.segments[0].end + 0.01), 1);
  assert.equal(findSegmentIndexAtTime(timeline, 999), 2);
});
