import { createBookmarkStore, createChromeStorageAdapter } from "../core/localPersistence.js";

const bookmarkStore = createBookmarkStore(createChromeStorageAdapter());

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "LECTIO_EXTRACT_ARTICLE" });
    if (response && response.ok === false) {
      await openReaderTab(
        {
          id: tab.url || crypto.randomUUID(),
          title: "Lectio extraction failed",
          url: tab.url || "",
          pageUrl: tab.url || "",
          error: response.error || "Lectio could not extract usable article content."
        },
        tab.id
      );
    }
  } catch (error) {
    console.warn("Lectio could not reach the page content script.", error);
    await openReaderTab(
      {
        id: tab.url || crypto.randomUUID(),
        title: "Lectio is unavailable on this page",
        url: tab.url || "",
        pageUrl: tab.url || "",
        error: "Lectio could not access this page. Try a normal article page."
      },
      tab.id
    );
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "LECTIO_ARTICLE_EXTRACTED") {
    openReaderTab(message.article, sender.tab?.id)
      .then((url) => sendResponse({ ok: true, url }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === "LECTIO_OPEN_BOOKMARK") {
    openBookmarkedArticle(message.articleId)
      .then((url) => sendResponse({ ok: true, url }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  return false;
});

async function openBookmarkedArticle(articleId) {
  const article = await bookmarkStore.load(articleId);
  if (!article) throw new Error("This bookmarked article is no longer available in browser storage.");
  return openReaderTab(article);
}

async function openReaderTab(article, openerTabId) {
  const sessionId = crypto.randomUUID();
  await chrome.storage.session.set({ [`lectio:session:${sessionId}`]: article });

  const readerUrl = chrome.runtime.getURL(`reader.html?session=${encodeURIComponent(sessionId)}`);
  await chrome.tabs.create({
    url: readerUrl,
    openerTabId
  });

  return readerUrl;
}
