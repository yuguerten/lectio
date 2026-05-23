import test from "node:test";
import assert from "node:assert/strict";
import { deriveArticleIdentity, normalizeArticleUrl } from "../src/core/urlIdentity.js";

test("normalizes tracking parameters and fragments", () => {
  assert.equal(
    normalizeArticleUrl("https://example.com/post/?utm_source=hn&b=2&a=1#section"),
    "https://example.com/post?a=1&b=2"
  );
});

test("prefers canonical URL for identity", () => {
  assert.equal(
    deriveArticleIdentity({
      pageUrl: "https://example.com/post?utm_source=hn",
      canonicalUrl: "https://example.com/canonical/"
    }),
    "https://example.com/canonical"
  );
});
