import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnnotation,
  deleteAnnotation,
  filterAnnotations,
  updateAnnotation,
  upsertAnnotation
} from "../src/core/annotations.js";

const anchor = {
  exact: "important text",
  prefix: "Some ",
  suffix: " here.",
  startOffset: 5,
  endOffset: 19,
  blockIndex: 0
};

test("creates highlights and notes from one annotation object", () => {
  assert.equal(createAnnotation({ anchor }).type, "highlight");
  assert.equal(createAnnotation({ anchor, note: "Remember this" }).type, "note");
});

test("prevents exact duplicate anchors", () => {
  const first = createAnnotation({ anchor, color: "yellow" });
  const second = createAnnotation({ anchor, color: "blue" });
  const annotations = upsertAnnotation([first], second);

  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].color, "blue");
});

test("edits, filters, and deletes annotations", () => {
  const created = createAnnotation({ anchor, color: "green" });
  const edited = updateAnnotation([created], created.id, { note: "My note", type: "note" });

  assert.equal(edited[0].type, "note");
  assert.equal(filterAnnotations(edited, { type: "notes", color: "green" }).length, 1);
  assert.equal(deleteAnnotation(edited, created.id).length, 0);
});
