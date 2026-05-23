import { Readability } from "@mozilla/readability";
import { deriveArticleIdentity, findCanonicalUrl } from "./urlIdentity.js";

export function extractArticleFromDocument(documentLike, pageUrl = documentLike.location?.href) {
  const canonicalUrl = findCanonicalUrl(documentLike);
  const articleId = deriveArticleIdentity({ pageUrl, canonicalUrl });
  const clone = documentLike.cloneNode(true);
  const readable = new Readability(clone).parse();

  if (!readable?.content || !readable?.textContent?.trim()) {
    throw new Error("Readability could not extract usable article content.");
  }

  return {
    id: articleId,
    title: readable.title || documentLike.title || "Untitled article",
    url: articleId,
    pageUrl,
    canonicalUrl,
    html: readable.content,
    text: normalizeExtractedText(readable.textContent),
    excerpt: readable.excerpt || "",
    byline: readable.byline || "",
    siteName: readable.siteName || ""
  };
}

export function normalizeExtractedText(text) {
  return text.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
