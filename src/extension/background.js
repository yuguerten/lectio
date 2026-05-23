chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "OPENREAD_EXTRACT_ARTICLE" });
    if (response && response.ok === false) {
      await openReaderTab(
        {
          id: tab.url || crypto.randomUUID(),
          title: "OpenRead extraction failed",
          url: tab.url || "",
          pageUrl: tab.url || "",
          error: response.error || "OpenRead could not extract usable article content."
        },
        tab.id
      );
    }
  } catch (error) {
    console.warn("OpenRead could not reach the page content script.", error);
    await openReaderTab(
      {
        id: tab.url || crypto.randomUUID(),
        title: "OpenRead is unavailable on this page",
        url: tab.url || "",
        pageUrl: tab.url || "",
        error: "OpenRead could not access this page. Try a normal article page."
      },
      tab.id
    );
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "OPENREAD_ARTICLE_EXTRACTED") return false;

  openReaderTab(message.article, sender.tab?.id)
    .then((url) => sendResponse({ ok: true, url }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function openReaderTab(article, openerTabId) {
  const sessionId = crypto.randomUUID();
  await chrome.storage.session.set({ [`openread:session:${sessionId}`]: article });

  const readerUrl = chrome.runtime.getURL(`reader.html?session=${encodeURIComponent(sessionId)}`);
  await chrome.tabs.create({
    url: readerUrl,
    openerTabId
  });

  return readerUrl;
}
