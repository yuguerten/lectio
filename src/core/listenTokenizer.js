const WORD_PATTERN = /[A-Za-z0-9'\u2019]+/g;

export function tokenizeWords(text) {
  if (!text) return [];
  const tokens = [];
  for (const match of String(text).matchAll(WORD_PATTERN)) {
    tokens.push({
      word: match[0],
      charStart: match.index,
      charEnd: match.index + match[0].length
    });
  }
  return tokens;
}

export function buildWordTimeline(text, duration) {
  const tokens = tokenizeWords(text);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const totalChars = tokens.reduce((sum, token) => sum + token.word.length, 0);

  if (tokens.length === 0 || safeDuration === 0 || totalChars === 0) {
    for (const token of tokens) {
      token.start = 0;
      token.end = 0;
    }
    return { tokens, totalChars, duration: safeDuration };
  }

  let cumulative = 0;
  for (const token of tokens) {
    const weight = token.word.length / totalChars;
    const start = cumulative;
    const end = cumulative + weight * safeDuration;
    token.start = start;
    token.end = end;
    cumulative = end;
  }

  const last = tokens[tokens.length - 1];
  if (last.end < safeDuration) {
    last.end = safeDuration;
  }

  return { tokens, totalChars, duration: safeDuration };
}

export function findWordIndexAtTime(timeline, time) {
  const tokens = timeline?.tokens;
  if (!tokens || tokens.length === 0 || !Number.isFinite(time) || time < 0) {
    return -1;
  }
  if (timeline.duration > 0 && time >= timeline.duration) {
    return tokens.length - 1;
  }
  let lo = 0;
  let hi = tokens.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].end <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const LISTEN_WORD_PATTERN = WORD_PATTERN;

export function tokenizeListenSegments(text, options = {}) {
  const source = String(text || "");
  const maxChars = Number.isFinite(options.maxChars) && options.maxChars > 40 ? options.maxChars : 220;
  const segments = [];
  let start = -1;
  let lastBreak = -1;

  const pushSegment = (end) => {
    if (start < 0) return;
    let charStart = start;
    let charEnd = Math.max(charStart, end);
    while (charStart < charEnd && /\s/.test(source[charStart])) charStart += 1;
    while (charEnd > charStart && /\s/.test(source[charEnd - 1])) charEnd -= 1;
    if (charEnd > charStart) {
      segments.push({
        text: source.slice(charStart, charEnd),
        charStart,
        charEnd
      });
    }
    start = -1;
    lastBreak = -1;
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (start < 0) {
      if (/\s/.test(char)) continue;
      start = i;
    }

    if (/[,;:)]/.test(char)) lastBreak = i + 1;

    if (/[.!?]/.test(char)) {
      const next = source[i + 1] || "";
      if (!next || /\s/.test(next)) {
        pushSegment(i + 1);
        continue;
      }
    }

    if (char === "\n") {
      pushSegment(i);
      continue;
    }

    if (start >= 0 && i - start >= maxChars) {
      const breakAt = lastBreak > start ? lastBreak : i + 1;
      pushSegment(breakAt);
      i = breakAt - 1;
    }
  }
  pushSegment(source.length);
  return segments;
}

export function buildSegmentTimeline(text, duration) {
  const segments = tokenizeListenSegments(text);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const totalChars = segments.reduce((sum, segment) => sum + segment.text.length, 0);

  if (segments.length === 0 || safeDuration === 0 || totalChars === 0) {
    for (const segment of segments) {
      segment.start = 0;
      segment.end = 0;
    }
    return { segments, totalChars, duration: safeDuration };
  }

  let cumulative = 0;
  for (const segment of segments) {
    const weight = segment.text.length / totalChars;
    segment.start = cumulative;
    segment.end = cumulative + weight * safeDuration;
    cumulative = segment.end;
  }

  segments[segments.length - 1].end = safeDuration;
  return { segments, totalChars, duration: safeDuration };
}

export function findSegmentIndexAtTime(timeline, time) {
  const segments = timeline?.segments;
  if (!segments || segments.length === 0 || !Number.isFinite(time) || time < 0) return -1;
  if (timeline.duration > 0 && time >= timeline.duration) return segments.length - 1;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].end <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
