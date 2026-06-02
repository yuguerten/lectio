import test from "node:test";
import assert from "node:assert/strict";
import { isImplicitHeadingText, isStandaloneCodeParagraph } from "../src/reader/heuristics.js";

test("does not treat article prose as a code block", () => {
  const prose = "As inference demand surges, existing datacenters are quickly reaching full utilization and companies are trying to build new ones as fast as possible.";

  assert.equal(isStandaloneCodeParagraph(prose), false);
});

test("recognizes extracted plain-text section titles as TOC headings", () => {
  const titleVariants = new Set();
  const text = "Datacenters matter more than ever";

  assert.equal(isImplicitHeadingText(text, text.toLowerCase(), titleVariants), true);
});


test("rejects article title variants as implicit headings", () => {
  const text = "How the hell is Groq raising more money?";
  const titleVariants = new Set([text.toLowerCase()]);

  assert.equal(isImplicitHeadingText(text, text.toLowerCase(), titleVariants), false);
});
