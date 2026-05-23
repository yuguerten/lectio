import test from "node:test";
import assert from "node:assert/strict";
import { createAnchorFromOffsets, resolveAnchor } from "../src/core/textAnchor.js";

test("creates text quote anchors with context", () => {
  const text = "Alpha beta gamma delta.";
  const anchor = createAnchorFromOffsets(text, 6, 10, 2);

  assert.equal(anchor.exact, "beta");
  assert.equal(anchor.prefix, "Alpha ");
  assert.equal(anchor.suffix, " gamma delta.");
  assert.equal(anchor.blockIndex, 2);
});

test("resolves anchors by direct offsets", () => {
  const text = "Alpha beta gamma delta.";
  const anchor = createAnchorFromOffsets(text, 6, 10);

  assert.deepEqual(resolveAnchor(text, anchor), {
    startOffset: 6,
    endOffset: 10,
    exact: "beta",
    confidence: "exact-offset"
  });
});

test("recovers shifted anchors with context", () => {
  const original = "Alpha beta gamma delta.";
  const shifted = "Intro. Alpha beta gamma delta.";
  const anchor = createAnchorFromOffsets(original, 6, 10);

  assert.equal(resolveAnchor(shifted, anchor).startOffset, 13);
});
