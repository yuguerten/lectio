import { extractArticleFromDocument } from "../core/extractArticle.js";
import { chooseBetterArticleCandidate } from "../core/articleCandidate.js";

let bestArticle = null;
let bestArticleLocation = "";
let lastCaptureError = null;

startArticleSnapshotting();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "LECTIO_EXTRACT_ARTICLE") return false;

  try {
    captureArticleCandidate();
    if (!bestArticle) throw lastCaptureError || new Error("Readability could not extract usable article content.");
    const article = bestArticle;
    chrome.runtime.sendMessage({ type: "LECTIO_ARTICLE_EXTRACTED", article }, sendResponse);
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }

  return true;
});

function captureArticleCandidate() {
  const locationKey = currentLocationKey();
  if (bestArticleLocation && bestArticleLocation !== locationKey) {
    bestArticle = null;
    bestArticleLocation = "";
  }
  try {
    const candidate = extractArticleFromDocument(document, window.location.href);
    const selected = chooseBetterArticleCandidate(bestArticle, candidate);
    if (selected === candidate) bestArticleLocation = locationKey;
    bestArticle = selected;
    lastCaptureError = null;
    return candidate;
  } catch (error) {
    lastCaptureError = error;
    return null;
  }
}

function currentLocationKey() {
  try {
    const url = new URL(window.location.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return window.location.href.split("#")[0].split("?")[0];
  }
}

function startArticleSnapshotting() {
  let captureTimer = null;
  let observedTextLength = 0;
  const scheduleCapture = (delay = 120) => {
    clearTimeout(captureTimer);
    captureTimer = setTimeout(captureArticleCandidate, delay);
  };

  const observer = new MutationObserver(() => {
    const textLength = document.body?.textContent?.length || 0;
    if (textLength < 800 || textLength < observedTextLength + 1500) return;
    observedTextLength = textLength;
    scheduleCapture();
  });
  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });

  const beginTimedCaptures = () => {
    captureArticleCandidate();
    [500, 1500, 3500, 8000].forEach((delay) => setTimeout(captureArticleCandidate, delay));
    setTimeout(() => observer.disconnect(), 2500);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", beginTimedCaptures, { once: true });
  } else {
    beginTimedCaptures();
  }
}
