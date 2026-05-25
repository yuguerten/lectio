import test from "node:test";
import assert from "node:assert/strict";
import { generateMarkdownExport } from "../src/core/exportMarkdown.js";

test("exports highlights and notes in document order", () => {
  const markdown = generateMarkdownExport(
    { title: "Example", url: "https://example.com/post" },
    [
      {
        type: "note",
        color: "blue",
        note: "Worth revisiting.",
        anchor: { exact: "second quote", startOffset: 20, endOffset: 32 }
      },
      {
        type: "highlight",
        color: "yellow",
        note: "",
        anchor: { exact: "first quote", startOffset: 1, endOffset: 12 }
      }
    ]
  );

  assert.match(markdown, /^# Example/);
  assert.ok(markdown.indexOf("first quote") < markdown.indexOf("second quote"));
  assert.match(markdown, /## Note \(blue\)/);
  assert.match(markdown, /Worth revisiting/);
});


test("exports drawing snapshot metadata when present", () => {
  const markdown = generateMarkdownExport(
    { title: "Sketch", url: "https://example.com/sketch" },
    [],
    {
      drawingImage: "data:image/png;base64,abc123",
      drawings: [{ id: "s1" }, { id: "s2" }]
    }
  );

  assert.match(markdown, /## Drawing Layer/);
  assert.match(markdown, /2 drawing marks/);
  assert.match(markdown, /!\[Drawing layer\]\(data:image\/png;base64,abc123\)/);
});
