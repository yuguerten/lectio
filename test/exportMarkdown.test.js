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
