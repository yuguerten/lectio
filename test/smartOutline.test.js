import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSmartOutlinePrompt,
  createSmartOutlineChunks,
  createSmartOutlineSignature,
  normalizeSmartOutline,
  parseSmartOutlineJson
} from "../src/core/smartOutline.js";

test("creates navigable outline chunks from article blocks", () => {
  const chunks = createSmartOutlineChunks([
    { id: "h", tagName: "h2", text: "Introduction" },
    { id: "p1", tagName: "p", text: "This paragraph is long enough to become part of the first chunk and explains the setup." },
    { id: "p2", tagName: "p", text: "This paragraph continues the same idea with more details about the initial context." },
    { id: "h2", tagName: "h2", text: "Main Result" },
    { id: "p3", tagName: "p", text: "This paragraph starts the next semantic section with the important result and consequences." }
  ], { maxChars: 500 });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].id, "chunk_1");
  assert.equal(chunks[0].targetId, "h");
  assert.deepEqual(chunks[0].blockIds, ["h", "p1", "p2"]);
  assert.equal(chunks[1].targetId, "h2");
});

test("normalizes model sections and rejects unknown chunk ids", () => {
  const chunks = [
    { id: "chunk_1", targetId: "p1", text: "one" },
    { id: "chunk_2", targetId: "p2", text: "two" }
  ];
  const outline = normalizeSmartOutline({
    sections: [
      { title: "First Idea", summary: "Starts here", startChunkId: "chunk_1" },
      { title: "Invented", startChunkId: "chunk_9" },
      { title: "First Idea", startChunkId: "chunk_2" },
      { title: "Second Idea:", startChunkId: "chunk_2" }
    ]
  }, chunks);

  assert.deepEqual(outline.sections, [
    { title: "First Idea", summary: "Starts here", startChunkId: "chunk_1" },
    { title: "Second Idea", summary: "", startChunkId: "chunk_2" }
  ]);
});

test("parses fenced smart outline JSON", () => {
  const parsed = parseSmartOutlineJson('```json\n{"sections":[{"title":"A","startChunkId":"chunk_1"}]}\n```');
  assert.equal(parsed.sections[0].title, "A");
});

test("smart outline signatures change when chunk content changes", () => {
  const first = createSmartOutlineSignature([{ id: "chunk_1", targetId: "p1", text: "alpha" }]);
  const second = createSmartOutlineSignature([{ id: "chunk_1", targetId: "p1", text: "beta" }]);
  assert.notEqual(first, second);
});

test("prompt includes chunk ids for grounded navigation", () => {
  const prompt = buildSmartOutlinePrompt({ title: "Article", chunks: [{ id: "chunk_1", text: "A useful paragraph." }] });
  assert.match(prompt, /startChunkId/);
  assert.match(prompt, /\[chunk_1\]/);
});
