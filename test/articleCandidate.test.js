import test from "node:test";
import assert from "node:assert/strict";
import { chooseBetterArticleCandidate, isAccessBarrierText, scoreArticleCandidate } from "../src/core/articleCandidate.js";

test("recognizes common anti-adblock barrier language", () => {
  assert.equal(isAccessBarrierText("Please disable your ad blocker to continue reading."), true);
  assert.equal(isAccessBarrierText("This article explains how browser extensions work."), false);
});

test("keeps a complete snapshot when the current page becomes an access warning", () => {
  const complete = { pageUrl: "https://example.com/article", text: "Article paragraph. ".repeat(180), html: "<p>Article paragraph.</p>".repeat(30) };
  const warning = { pageUrl: complete.pageUrl, title: "Ad blocker detected", text: "Please disable your ad blocker to continue reading.", html: "<div>Warning</div>" };

  assert.equal(chooseBetterArticleCandidate(complete, warning), complete);
  assert.ok(scoreArticleCandidate(complete) > scoreArticleCandidate(warning));
});

test("replaces an early partial snapshot with a richer article", () => {
  const partial = { pageUrl: "https://example.com/article", text: "Short introduction.", html: "<p>Short introduction.</p>" };
  const complete = { pageUrl: partial.pageUrl, text: "Complete article paragraph. ".repeat(120), html: "<p>Complete article paragraph.</p>".repeat(25) };

  assert.equal(chooseBetterArticleCandidate(partial, complete), complete);
});

test("does not reuse a snapshot after single-page navigation", () => {
  const previous = { id: "https://example.com/one", pageUrl: "https://example.com/one", text: "Long previous article. ".repeat(100), html: "<p>Previous</p>" };
  const current = { id: "https://example.com/two", pageUrl: "https://example.com/two", text: "New article.", html: "<p>New article.</p>" };

  assert.equal(chooseBetterArticleCandidate(previous, current), current);
});

test("keeps the richer snapshot when only the page fragment changes", () => {
  const complete = { id: "https://example.com/article", pageUrl: "https://example.com/article", text: "Full article. ".repeat(100), html: "<p>Full article.</p>" };
  const fragmentWarning = { id: complete.id, pageUrl: "https://example.com/article#comments", text: "Please disable your ad blocker.", html: "<div>Warning</div>" };

  assert.equal(chooseBetterArticleCandidate(complete, fragmentWarning), complete);
});
