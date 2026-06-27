import { extractArticleFromDocument } from "../core/extractArticle.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "LECTIO_EXTRACT_ARTICLE") return false;

  try {
    const article = extractArticleFromDocument(document, window.location.href);
    chrome.runtime.sendMessage({ type: "LECTIO_ARTICLE_EXTRACTED", article }, sendResponse);
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }

  return true;
});
