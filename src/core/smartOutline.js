const MAX_CHUNKS = 36;
const MAX_CHARS_PER_CHUNK = 1200;
const MIN_BLOCK_CHARS = 40;
const MAX_SECTIONS = 12;

export function createSmartOutlineChunks(blocks, options = {}) {
  const maxChunks = options.maxChunks || MAX_CHUNKS;
  const maxChars = options.maxChars || MAX_CHARS_PER_CHUNK;
  const chunks = [];
  let current = null;

  for (const block of blocks || []) {
    const text = normalizeOutlineText(block?.text);
    if (text.length < MIN_BLOCK_CHARS && !isHeadingTag(block?.tagName)) continue;
    const id = String(block?.id || "").trim();
    if (!id) continue;
    const entry = { id, tagName: normalizeTagName(block?.tagName), text };
    const shouldStart = !current || isHeadingTag(entry.tagName) || current.text.length + text.length > maxChars;

    if (shouldStart) {
      if (current) chunks.push(current);
      current = { id: entry.id, text: entry.text, blockIds: [entry.id] };
    } else {
      current.text = `${current.text}\n\n${entry.text}`;
      current.blockIds.push(entry.id);
    }

    if (chunks.length >= maxChunks) break;
  }

  if (current && chunks.length < maxChunks) chunks.push(current);
  return chunks.map((chunk, index) => ({
    id: `chunk_${index + 1}`,
    targetId: chunk.id,
    text: chunk.text.slice(0, maxChars),
    blockIds: chunk.blockIds
  }));
}

export function normalizeSmartOutline(input, chunks, options = {}) {
  const maxSections = options.maxSections || MAX_SECTIONS;
  const validChunkIds = new Set((chunks || []).map((chunk) => chunk.id));
  const rawSections = Array.isArray(input?.sections) ? input.sections : [];
  const sections = [];
  const seenTitles = new Set();
  const seenChunks = new Set();

  for (const raw of rawSections) {
    const title = normalizeOutlineTitle(raw?.title);
    const chunkId = String(raw?.startChunkId || raw?.chunkId || "").trim();
    if (!title || !validChunkIds.has(chunkId)) continue;
    const key = title.toLowerCase();
    if (seenTitles.has(key) || seenChunks.has(chunkId)) continue;
    seenTitles.add(key);
    seenChunks.add(chunkId);
    sections.push({
      title,
      startChunkId: chunkId,
      summary: normalizeOutlineSummary(raw?.summary)
    });
    if (sections.length >= maxSections) break;
  }

  return { sections };
}

export function createSmartOutlineSignature(chunks) {
  const source = (chunks || []).map((chunk) => `${chunk.id}:${chunk.targetId}:${chunk.text.slice(0, 160)}`).join("|");
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = Math.imul(31, hash) + source.charCodeAt(i) | 0;
  }
  return String(hash >>> 0);
}

export function buildSmartOutlinePrompt({ title = "Untitled article", url = "", chunks = [] }) {
  return [
    "Create a semantic outline for the article.",
    "Use only the provided chunks. Do not invent sections that are not grounded in the chunks.",
    'Return strict JSON with this shape: {"sections":[{"title":"...","summary":"...","startChunkId":"chunk_1"}]}',
    "Each section must point to the first chunk where that section starts.",
    "Prefer 5 to 9 sections. Use concise titles of 2 to 8 words.",
    `Title: ${title}`,
    url ? `URL: ${url}` : "",
    "Chunks:",
    chunks.map((chunk) => `[${chunk.id}] ${chunk.text}`).join("\n\n")
  ].filter(Boolean).join("\n\n");
}

export function parseSmartOutlineJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  return {};
}

function normalizeOutlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeOutlineTitle(value) {
  return normalizeOutlineText(value).replace(/[.:-]+$/g, "").slice(0, 80);
}

function normalizeOutlineSummary(value) {
  return normalizeOutlineText(value).slice(0, 180);
}

function normalizeTagName(value) {
  return String(value || "").toLowerCase();
}

function isHeadingTag(value) {
  return /^h[1-6]$/.test(normalizeTagName(value));
}
