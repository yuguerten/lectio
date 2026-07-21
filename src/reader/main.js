import "./styles.css";
import "./brutalist.css";
import "./minimalist.css";
import {
  HIGHLIGHT_COLORS,
  createAnnotation,
  deleteAnnotation,
  filterAnnotations,
  updateAnnotation,
  upsertAnnotation
} from "../core/annotations.js";
import { createAnchorFromSelection, resolveAnchor } from "../core/textAnchor.js";
import { createSmartOutlineChunks, createSmartOutlineSignature } from "../core/smartOutline.js";
import {
  createAnnotationStore,
  createBookmarkStore,
  createChromeStorageAdapter,
  createDrawingStore,
  createSmartOutlineStore
} from "../core/localPersistence.js";
import { getListenText, renderHighlights, renderSearchHighlights, sanitizeArticleHtml } from "./dom.js";
import { isImplicitHeadingText, isStandaloneCodeParagraph, isTerminalSnippet } from "./heuristics.js";

const colorMap = new Map(HIGHLIGHT_COLORS.map((color) => [color.id, color.value]));
const colorLabelMap = new Map(HIGHLIGHT_COLORS.map((color) => [color.id, color.label]));
const DRAWING_COLORS = ["#24211d", "#245f8f"];
const ASSIST_LANGUAGES = [
  { value: "en", label: "English", flag: "🇬🇧", direction: "ltr" },
  { value: "fr", label: "French", flag: "🇫🇷", direction: "ltr" },
  { value: "es", label: "Spanish", flag: "🇪🇸", direction: "ltr" },
  { value: "de", label: "German", flag: "🇩🇪", direction: "ltr" },
  { value: "ar", label: "Arabic", flag: "🇸🇦", direction: "rtl" },
  { value: "zh-CN", label: "Chinese", flag: "🇨🇳", direction: "ltr" },
  { value: "ja", label: "Japanese", flag: "🇯🇵", direction: "ltr" }
];
const LISTEN_MODEL = "hexgrad/kokoro-82m";
const LISTEN_VOICE = "af_heart";
const LISTEN_SPEEDS = [0.85, 1, 1.15, 1.3];
const ASSIST_ENDPOINT = resolveAssistEndpoint();
const SPEECH_ENDPOINT = resolveBackendEndpoint(import.meta.env.VITE_LECTIO_SPEECH_ENDPOINT || "/api/speech");
const SMART_OUTLINE_ENDPOINT = resolveBackendEndpoint(import.meta.env.VITE_LECTIO_OUTLINE_ENDPOINT || "/api/outline");
const LISTEN_AUDIO_CACHE_DB = "lectio-listen-cache";
const LISTEN_AUDIO_CACHE_STORE = "audio";
const LISTEN_AUDIO_CACHE_LIMIT = 24;
const state = {
  article: null,
  annotations: [],
  drawings: [],
  bookmarks: [],
  filters: { color: "all", type: "all" },
  searchQuery: "",
  searchMatchCount: 0,
  searchActiveIndex: 0,
  activeId: null,
  commentOpenId: null,
  selectionAnchor: null,
  theme: "paper",
  focusMode: false,
  listening: false,
  listen: {
    model: LISTEN_MODEL,
    voice: LISTEN_VOICE,
    speed: 1,
    audio: null,
    audioUrl: "",
    status: "idle",
    error: "",
    volume: 0.82,
    dirty: true,
    ttsText: "",
    generationPromise: null,
    prewarmStarted: false,
    cacheKey: "",
    source: ""
  },
  assist: {
    selectedText: "",
    mode: "translate",
    targetLanguage: "en",
    requestId: 0
  },
  smartOutline: {
    status: "idle",
    sections: [],
    chunks: [],
    signature: "",
    cacheLoaded: false,
    error: "",
    requestId: 0
  },
  toc: [],
  typography: {
    size: 21,
    lineHeight: 1.75,
    width: 760
  },
  drawing: {
    enabled: false,
    tool: "pen",
    color: DRAWING_COLORS[0],
    size: 4,
    activeStroke: null,
    redoStack: []
  },
  overlayHistory: {
    search: false
  },
  suppressOverlayPop: false
};

const storageAdapter = createChromeStorageAdapter();
const store = createAnnotationStore(storageAdapter);
const drawingStore = createDrawingStore(storageAdapter);
const bookmarkStore = createBookmarkStore(storageAdapter);
const smartOutlineStore = createSmartOutlineStore(storageAdapter);
const app = document.querySelector("#app");

boot().catch((error) => {
  renderError(error.message);
});

async function boot() {
  state.article = await loadArticleFromSession();
  if (state.article.error) throw new Error(state.article.error);
  const [annotations, drawings, bookmarks] = await Promise.all([
    store.load(state.article.id),
    drawingStore.load(state.article.id),
    bookmarkStore.list()
  ]);
  state.annotations = annotations;
  state.drawings = drawings;
  state.bookmarks = bookmarks;
  renderWorkspace();
}

async function loadArticleFromSession() {
  const sessionId = new URLSearchParams(window.location.search).get("session");
  if (!sessionId) throw new Error("Missing reader session.");

  const key = `lectio:session:${sessionId}`;
  const result = await chrome.storage.session.get(key);
  const article = result[key];
  if (!article) throw new Error("The reader session expired. Reopen the article from the extension button.");
  await chrome.storage.session.remove(key);
  return article;
}

function renderWorkspace() {
  state.filters = { color: "all", type: "all" };
  const sourceUrl = state.article.pageUrl || state.article.url;
  const sourceHost = hostFor(sourceUrl);
  const readingMinutes = estimateReadingMinutes();
  const wordCount = articleWordCount();
  app.innerHTML = `
    <main class="workspace theme-paper">
      <div class="register-strip" aria-label="Reader edition information">
        <span>[ LECTIO READER® ]</span>
        <span>ISSUE 001</span>
        <span>${escapeHtml(sourceHost)}</span>
        <span>/// LOCAL READING FILE</span>
        <span id="reader-progress">000%</span>
      </div>
      <header class="appbar">
        <div class="reader-meta">
          <div class="brand-block">
            <span class="brand-mark" aria-hidden="true">${bookIcon()}</span>
            <span class="brand-name">Lectio</span>
          </div>
          <div class="appbar-divider" aria-hidden="true"></div>
          <div class="title-block">
            <a class="source-title" href="${escapeAttribute(state.article.pageUrl || state.article.url)}" target="_blank" rel="noreferrer" title="Open source page">
              <h1>${escapeHtml(state.article.title)}</h1>
            </a>
            <span class="saved-status">[ SAVED ]</span>
          </div>
        </div>
        <div class="top-actions">
          <div class="toolbar-group toolbar-primary">
            <button id="search-toggle" class="toolbar-button toolbar-labeled search-toggle" type="button" title="Search article (/)" aria-label="Search article"><span class="toolbar-icon">${searchIcon()}</span><span class="toolbar-label">Search</span><kbd class="shortcut-badge" aria-hidden="true">/</kbd></button>
            <button id="listen-top" class="toolbar-button toolbar-labeled listen-toolbar-button" type="button" aria-label="Listen to article" aria-pressed="false" title="Listen to article (L)"><span class="toolbar-icon">${headphonesIcon()}</span><span class="toolbar-label">Listen</span><kbd class="shortcut-badge" aria-hidden="true">L</kbd></button>
          </div>
          <div class="toolbar-group toolbar-content">
            <button id="draw-toggle" class="toolbar-button toolbar-labeled" type="button" aria-pressed="false" title="Draw on page (D)" aria-label="Draw on page"><span class="toolbar-icon">${drawIcon()}</span><span class="toolbar-label">Draw</span><kbd class="shortcut-badge" aria-hidden="true">D</kbd></button>
            <button id="export-pdf" class="toolbar-button toolbar-labeled export-button" type="button" title="Export PDF" aria-label="Export PDF"><span class="toolbar-icon">${downloadIcon()}</span><span class="toolbar-label">Export</span></button>
            <button id="bookmark-top" class="toolbar-button toolbar-labeled bookmark-button ${isCurrentArticleBookmarked() ? "is-bookmarked" : ""}" type="button" title="${isCurrentArticleBookmarked() ? "Bookmarked" : "Bookmark article (B)"}" aria-label="${isCurrentArticleBookmarked() ? "Article bookmarked" : "Bookmark article"}" aria-pressed="${isCurrentArticleBookmarked() ? "true" : "false"}"><span class="toolbar-icon">${bookmarkIcon(isCurrentArticleBookmarked())}</span><span class="toolbar-label">Bookmark</span><kbd class="shortcut-badge" aria-hidden="true">B</kbd></button>
          </div>
          <div class="toolbar-group toolbar-settings">
            <button id="focus-toggle" class="toolbar-button toolbar-icon-only focus-toggle" type="button" aria-label="Enter focus mode" aria-pressed="false" title="Focus mode (F)"><span>${focusIcon()}</span><kbd class="shortcut-badge" aria-hidden="true">F</kbd></button>
            <button id="theme-toggle" class="toolbar-button toolbar-labeled theme-toggle" type="button" aria-label="Toggle paper tone" aria-pressed="false" title="Toggle paper tone"><span class="toolbar-icon theme-icon">${sunIcon()}</span><span class="toolbar-label">Paper</span></button>
            <button id="typography-toggle" class="toolbar-button toolbar-labeled text-button" type="button" title="Typography settings" aria-label="Typography settings"><span class="toolbar-icon">Aa</span><span class="toolbar-label">Typography</span></button>
          </div>
        </div>
        <div class="top-progress" aria-hidden="true"><span id="top-progress-bar"></span></div>
      </header>
      <button id="focus-floating-toggle" class="focus-mode-button" type="button" aria-label="Enter focus mode" aria-pressed="false" title="Focus mode (F)">${focusIcon()}<span class="focus-mode-label">Focus mode</span></button>
      <aside class="reader-sidebar" aria-label="Reader margin">
        <section class="dossier-hero" aria-label="Article dossier">
          <p>[ DOSSIER ]</p>
          <strong aria-hidden="true">01</strong>
          <dl>
            <div><dt>Source</dt><dd>${escapeHtml(sourceHost)}</dd></div>
            <div><dt>Read</dt><dd>${readingMinutes} min</dd></div>
            <div><dt>Words</dt><dd>${wordCount.toLocaleString()}</dd></div>
            <div><dt>Section</dt><dd id="active-section-index">01</dd></div>
          </dl>
        </section>
        <div class="toc-panel">
          <p class="margin-eyebrow">[ ARTICLE INDEX ]</p>
          <div class="toc-header">
            <p class="toc-heading">Contents</p>
            <button id="smart-outline-action" class="toc-action" type="button">Generate index</button>
          </div>
          <nav id="toc-list" class="toc-list"></nav>
          <p id="smart-outline-status" class="toc-status" role="status" aria-live="polite"></p>
        </div>
        <details class="saved-panel" aria-label="Bookmarked articles">
          <summary><span>[ ARCHIVE ]</span><small>Local files</small></summary>
          <div id="saved-article-list" class="saved-article-list"></div>
        </details>
      </aside>

      <div id="search-popover" class="search-popover" aria-label="Article search">
        <label class="search-box">
          ${searchIcon()}
          <input id="article-search" type="search" placeholder="Search article" autocomplete="off" />
          <span id="search-count" class="search-count" aria-live="polite"></span>
          <kbd>/</kbd>
        </label>
      </div>
      <div id="listen-popover" class="listen-popover" aria-label="Listen settings" role="dialog"></div>
      <div id="typography-popover" class="typography-popover" aria-label="Reading settings" role="dialog">
        <section class="type-panel">
          <header class="settings-header">
            <div class="settings-title"><span class="brand-mark" aria-hidden="true">${bookIcon()}</span><h2>Reading settings</h2></div>
            <button id="type-close" class="settings-close" type="button" aria-label="Close reading settings">${xIcon()}</button>
          </header>
          <div class="type-specimen" aria-label="Typography specimen">
            <span>[ TYPE SPECIMEN ]</span>
            <strong>LECTIO</strong>
            <p>READ / MARK / RETURN</p>
            <small>INTER 12 / MONO 10 / CARBON INK</small>
          </div>
          <div class="settings-control">
            <div class="settings-row-heading"><span class="settings-icon">Aa</span><label for="type-size">Text size</label><strong id="type-size-value"></strong></div>
            <div class="slider-row"><span>A</span><input id="type-size" type="range" min="18" max="25" value="${state.typography.size}" /><span>AA</span></div>
          </div>
          <div class="settings-control">
            <div class="settings-row-heading"><span class="settings-icon">↕</span><label for="type-line">Line height</label><strong id="type-line-value"></strong></div>
            <div class="slider-row"><span>1.6×</span><input id="type-line" type="range" min="1.6" max="2" step="0.05" value="${state.typography.lineHeight}" /><span>2.0×</span></div>
          </div>
          <div class="settings-control">
            <div class="settings-row-heading"><span class="settings-icon">↔</span><label for="type-width">Content width</label><strong id="type-width-value"></strong></div>
            <div class="slider-row"><span>640</span><input id="type-width" type="range" min="640" max="880" step="20" value="${state.typography.width}" /><span>880</span></div>
          </div>
        </section>
      </div>

      <div class="study-layout">
        <section class="paper-shell">
          <header class="article-register">
            <div class="article-register-title">
              <span>[ SOURCE TEXT ]</span>
              <strong>&gt;&gt;&gt; READ / MARK / EXPORT</strong>
            </div>
            <dl>
              <div><dt>Publication</dt><dd>${escapeHtml(state.article.siteName || sourceHost)}</dd></div>
              <div><dt>Byline</dt><dd>${escapeHtml(state.article.byline || "Source author")}</dd></div>
              <div><dt>Length</dt><dd>${wordCount.toLocaleString()} words</dd></div>
            </dl>
          </header>
          <div class="article-listen-entry">
            <button id="article-listen-start" class="article-listen-button" type="button" aria-label="Listen to article">
              <span class="article-listen-icon" aria-hidden="true">${headphonesIcon()}</span>
              <span class="article-listen-copy">
                <strong id="article-listen-status">${listenStatusLabel()}</strong>
                <small id="article-listen-duration">${listenButtonDurationLabel()}</small>
              </span>
              <kbd class="shortcut-badge listen-shortcut" aria-hidden="true">L</kbd>
            </button>
          </div>
          <article id="article" class="article" tabindex="-1"></article>
          <footer class="reader-colophon" aria-label="Reader colophon">
            <span>[ COLOPHON ]</span>
            <p>LECTIO READER PRESS /// PAPER STOCK F4 /// EDITION 001</p>
            <p>SET IN INTER / SYSTEM MONO /// SOURCE PRESERVED LOCALLY</p>
          </footer>
          <canvas id="drawing-canvas" class="drawing-canvas" aria-label="Drawing layer"></canvas>
        </section>
        <section id="print-notes" class="print-notes" aria-hidden="true"></section>
      </div>

      <div id="drawing-tools" class="drawing-tools" aria-label="Drawing tools">
        <button class="icon-tool is-active" type="button" data-tool="pen" title="Pen (P)">${penIcon()}<kbd class="shortcut-badge draw-shortcut" aria-hidden="true">P</kbd></button>
        <button class="icon-tool" type="button" data-tool="line" title="Line (X)">${lineIcon()}<kbd class="shortcut-badge draw-shortcut" aria-hidden="true">X</kbd></button>
        <button class="icon-tool" type="button" data-tool="arrow" title="Arrow (A)">${arrowIcon()}<kbd class="shortcut-badge draw-shortcut" aria-hidden="true">A</kbd></button>
        <button class="icon-tool" type="button" data-tool="rect" title="Rectangle (R)">${rectangleIcon()}<kbd class="shortcut-badge draw-shortcut" aria-hidden="true">R</kbd></button>
        <button class="icon-tool" type="button" data-tool="ellipse" title="Ellipse (O)">${ellipseIcon()}<kbd class="shortcut-badge draw-shortcut" aria-hidden="true">O</kbd></button>
        <button class="icon-tool" type="button" data-tool="eraser" title="Eraser (E)">${eraserIcon()}<kbd class="shortcut-badge draw-shortcut" aria-hidden="true">E</kbd></button>
        <div class="drawing-swatches" aria-label="Drawing color">
          ${DRAWING_COLORS.map((color) => `<button class="drawing-swatch" type="button" data-color="${color}" title="${color}" style="background:${color}"></button>`).join("")}
        </div>
        <label class="size-control" title="Brush size">
          <input id="draw-size" type="range" min="2" max="18" value="4" />
        </label>
        <button id="draw-undo" class="icon-tool" type="button" title="Undo (Ctrl+Z)">${undoIcon()}<kbd class="shortcut-badge draw-shortcut wide" aria-hidden="true">Z</kbd></button>
        <button id="draw-redo" class="icon-tool" type="button" title="Redo (Ctrl+Y)">${redoIcon()}<kbd class="shortcut-badge draw-shortcut wide" aria-hidden="true">Y</kbd></button>
        <button id="draw-clear" class="icon-tool" type="button" title="Clear drawing">${trashIcon()}</button>
      </div>
      <div id="reader-toast" class="reader-toast" role="status" aria-live="polite"></div>
      <div id="review-modal" class="review-modal" aria-live="polite"></div>
      <div id="assist-popover" class="assist-popover" aria-live="polite"></div>
      <div id="selection-popover" class="popover" role="toolbar" aria-label="Selection actions"></div>
      <div id="comment-popover" class="comment-popover" aria-live="polite"></div>
    </main>
  `;

  document.querySelector("#article-search").value = state.searchQuery;
  document.querySelector("#search-toggle").addEventListener("click", toggleSearchPopover);
  document.querySelector("#listen-top")?.addEventListener("click", startArticleListening);
  document.querySelector("#typography-toggle").addEventListener("click", openTypographyPopover);
  document.querySelector("#type-close").addEventListener("click", closeTypographyPopover);
  document.querySelector("#focus-toggle")?.addEventListener("click", toggleFocusMode);
  document.querySelector("#focus-floating-toggle")?.addEventListener("click", toggleFocusMode);
  document.querySelector("#theme-toggle").addEventListener("click", toggleTheme);
  document.querySelector("#article-listen-start")?.addEventListener("click", startArticleListening);
  document.querySelector("#highlight-tool")?.addEventListener("click", handleHighlightTool);
  document.querySelector("#bookmark-tool")?.addEventListener("click", handleBookmarkArticle);
  document.querySelector("#bookmark-top").addEventListener("click", handleBookmarkArticle);
  bindTypographyControls();
  renderListenPopover();
  applyReaderPreferences();
  document.querySelector("#article-search").addEventListener("input", (event) => {
    state.searchQuery = event.target.value;
    state.searchActiveIndex = 0;
    renderArticleAndMargin({ focusSearch: true, scrollToSearch: true });
  });
  document.querySelector("#article-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && state.searchMatchCount > 0) {
      event.preventDefault();
      moveSearchMatch(event.shiftKey ? -1 : 1);
    }
    if (event.key === "Escape") {
      closeSearchPopover();
    }
  });
  document.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("popstate", handleOverlayPopstate);
  window.addEventListener("scroll", updateReadingProgress, { passive: true });
  window.addEventListener("resize", updateReadingProgress);
  document.querySelector("#export-pdf").addEventListener("click", exportPdf);
  document.querySelector("#review-open")?.addEventListener("click", openReviewModal);
  document.querySelector("#selection-popover").addEventListener("mousedown", (event) => event.preventDefault());
  document.addEventListener("mousedown", closeFloatingCommentOnOutsideClick);

  renderArticleAndMargin();
  bindSelectionPopover();
  bindDrawingControls();
  prepareArticleListening();
}

async function handleBookmarkArticle() {
  try {
    await bookmarkStore.save(state.article);
    state.bookmarks = await bookmarkStore.list();
    updateBookmarkButton();
    renderSavedArticles();
    showReaderToast("Article saved locally in this browser");
  } catch (error) {
    showReaderToast(error.message || "Lectio could not save this article");
  }
}

function isCurrentArticleBookmarked() {
  return state.bookmarks.some((bookmark) => bookmark.id === state.article?.id);
}

function updateBookmarkButton() {
  const button = document.querySelector("#bookmark-top");
  if (!button) return;
  const bookmarked = isCurrentArticleBookmarked();
  button.classList.toggle("is-bookmarked", bookmarked);
  button.setAttribute("aria-pressed", String(bookmarked));
  button.setAttribute("aria-label", bookmarked ? "Article bookmarked" : "Bookmark article");
  button.title = bookmarked ? "Bookmarked" : "Bookmark article (B)";
  const icon = button.querySelector(".toolbar-icon");
  if (icon) icon.innerHTML = bookmarkIcon(bookmarked);
}

function renderArticleAndMargin(options = {}) {
  const articleRoot = document.querySelector("#article");
  articleRoot.innerHTML = sanitizeArticleHtml(state.article.html);
  prepareArticleHeadings(articleRoot);
  markArticleCaptions(articleRoot);
  updateSmartOutlineChunks(articleRoot);
  enhanceCodeBlocks(articleRoot);
  const articleText = articleRoot.textContent || "";
  const visible = filterAnnotations(state.annotations, state.filters)
    .map((annotation) => ({
      ...annotation,
      resolved: resolveAnchor(articleText, annotation.anchor),
      colorValue: colorMap.get(annotation.color) || colorMap.get("yellow")
    }))
    .filter((annotation) => annotation.resolved);

  renderHighlights(articleRoot, visible, activateAnnotation);
  state.searchMatchCount = renderSearchHighlights(articleRoot, state.searchQuery);
  if (state.searchActiveIndex >= state.searchMatchCount) state.searchActiveIndex = Math.max(0, state.searchMatchCount - 1);
  markSearchActive();
  updateSearchCount();
  renderTableOfContents();
  renderSavedArticles();
  triggerSmartOutlineLoad();
  renderPrintNotes();
  markActive();
  for (const image of articleRoot.querySelectorAll("img")) {
    image.addEventListener("load", resizeDrawingCanvas, { once: true });
  }
  requestAnimationFrame(() => {
    resizeDrawingCanvas();
    updateReadingProgress();
    if (options.scrollToSearch) scrollToSearchMatch();
    if (options.focusSearch) document.querySelector("#article-search")?.focus();
  });
}

function updateSearchCount() {
  const count = document.querySelector("#search-count");
  if (!count) return;
  if (!state.searchQuery.trim()) {
    count.textContent = "";
    return;
  }
  count.textContent = state.searchMatchCount ? `${state.searchActiveIndex + 1}/${state.searchMatchCount}` : "0/0";
}

function markSearchActive() {
  document.querySelectorAll(".search-hit").forEach((hit, index) => {
    hit.classList.toggle("is-active", index === state.searchActiveIndex);
  });
}

function moveSearchMatch(direction) {
  if (!state.searchMatchCount) return;
  state.searchActiveIndex = (state.searchActiveIndex + direction + state.searchMatchCount) % state.searchMatchCount;
  markSearchActive();
  updateSearchCount();
  scrollToSearchMatch();
}

function scrollToSearchMatch() {
  if (!state.searchQuery.trim() || !state.searchMatchCount) return;
  document.querySelector(`.search-hit[data-search-index="${state.searchActiveIndex}"]`)?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

const BLOCKED_TOC_HEADINGS = new Set([
  "sources",
  "comments",
  "comment",
  "references",
  "related",
  "recommended",
  "share",
  "subscribe",
  "newsletter",
  "table of contents"
]);

function prepareArticleHeadings(articleRoot) {
  markArticleMetadata(articleRoot);
  promoteImplicitArticleHeadings(articleRoot);
  let headings = collectTocHeadings(articleRoot);
  if (!headings.length) {
    promoteImplicitArticleHeadings(articleRoot, { force: true });
    headings = collectTocHeadings(articleRoot);
  }
  state.toc = headings.slice(0, 12).map((heading, index) => {
    if (!heading.id) heading.id = `lectio-section-${index + 1}`;
    return {
      id: heading.id,
      text: (heading.textContent || `Section ${index + 1}`).trim(),
      level: heading.tagName.toLowerCase(),
      index
    };
  });
}

function collectTocHeadings(articleRoot) {
  const seen = new Set();
  const candidates = [...articleRoot.querySelectorAll("h1, h2, h3, h4")];
  return filterArticleTocHeadings(candidates, seen);
}
function promoteImplicitArticleHeadings(articleRoot, options = {}) {
  if (!options.force && articleRoot.querySelectorAll("h2, h3").length) return;
  const titleVariants = articleTitleVariants();
  articleRoot.querySelectorAll("p, div").forEach((element) => {
    if (element.matches(".article-meta, .code-card, .code-card *, form, form *, nav, nav *")) return;
    if (element.querySelector("a, button, input, textarea, select, code, pre")) return;
    const text = (element.textContent || "").trim();
    const normalized = normalizeTocText(text);
    if (!isImplicitHeadingText(text, normalized, titleVariants)) return;
    const heading = document.createElement("h2");
    heading.innerHTML = element.innerHTML;
    element.replaceWith(heading);
  });
}

function filterArticleTocHeadings(headings, seen) {
  const titleVariants = articleTitleVariants();
  return headings.filter((heading) => {
    const text = (heading.textContent || "").trim();
    const normalized = normalizeTocText(text);
    if (!normalized || BLOCKED_TOC_HEADINGS.has(normalized)) return false;
    if (titleVariants.has(normalized)) return false;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function articleTitleVariants() {
  const title = state.article?.title || "";
  const variants = new Set([normalizeTocText(title)]);
  for (const part of title.split(/[|—-]/)) {
    const normalized = normalizeTocText(part);
    if (normalized) variants.add(normalized);
  }
  return variants;
}

function normalizeTocText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
    .toLowerCase();
}

function updateSmartOutlineChunks(articleRoot) {
  const blocks = [...articleRoot.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre")]
    .filter((element) => !element.closest(".article-meta, .code-card, form, nav, button, .comment-marker"))
    .map((element, index) => {
      if (!element.id) element.id = `lectio-block-${index + 1}`;
      return {
        id: element.id,
        tagName: element.tagName,
        text: element.textContent || ""
      };
    });
  const chunks = createSmartOutlineChunks(blocks);
  const signature = createSmartOutlineSignature(chunks);
  if (signature !== state.smartOutline.signature) {
    state.smartOutline = {
      status: "idle",
      sections: [],
      chunks,
      signature,
      cacheLoaded: false,
      error: "",
      requestId: state.smartOutline.requestId + 1
    };
    return;
  }
  state.smartOutline.chunks = chunks;
}

function smartOutlineShouldAutoGenerate() {
  return state.smartOutline.chunks.length >= 3 && state.toc.length < 3;
}

async function triggerSmartOutlineLoad(options = {}) {
  const force = Boolean(options.force);
  if (!state.article || !state.smartOutline.chunks.length) return;
  if (state.smartOutline.status === "loading") return;
  if (!force && state.smartOutline.cacheLoaded && !smartOutlineShouldAutoGenerate()) return;

  const requestId = ++state.smartOutline.requestId;
  const shouldGenerate = force || smartOutlineShouldAutoGenerate();

  if (!force && !state.smartOutline.cacheLoaded) {
    const cached = await smartOutlineStore.load(state.article.id, state.smartOutline.signature);
    if (requestId !== state.smartOutline.requestId) return;
    state.smartOutline.cacheLoaded = true;
    if (cached?.sections?.length) {
      state.smartOutline.status = "ready";
      state.smartOutline.sections = cached.sections;
      state.smartOutline.error = "";
      renderTableOfContents();
      updateReadingProgress();
      return;
    }
  }

  if (!shouldGenerate) {
    renderTableOfContents();
    return;
  }

  state.smartOutline.status = "loading";
  state.smartOutline.error = "";
  renderTableOfContents();

  try {
    const payload = await fetchSmartOutline();
    if (requestId !== state.smartOutline.requestId) return;
    const sections = mapSmartOutlineSections(payload.sections || []);
    if (!sections.length) throw new Error("Smart outline did not return usable sections.");
    state.smartOutline.status = "ready";
    state.smartOutline.sections = sections;
    state.smartOutline.cacheLoaded = true;
    state.smartOutline.error = "";
    await smartOutlineStore.save(state.article.id, {
      signature: state.smartOutline.signature,
      sections,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    if (requestId !== state.smartOutline.requestId) return;
    state.smartOutline.status = "error";
    state.smartOutline.error = error.message || "Smart outline is unavailable.";
    if (force) showReaderToast(state.smartOutline.error);
  }

  renderTableOfContents();
  updateReadingProgress();
}

async function fetchSmartOutline() {
  const response = await fetch(SMART_OUTLINE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: state.article.title,
      url: state.article.pageUrl || state.article.url,
      chunks: state.smartOutline.chunks.map(({ id, targetId, text }) => ({ id, targetId, text }))
    })
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload.error || `Smart outline failed with ${response.status}`;
    if (message === "API route not found.") {
      throw new Error("Smart outline backend is not running the latest /api/outline route. Restart npm run serve and rebuild/reload the extension.");
    }
    throw new Error(message);
  }
  return payload;
}

function mapSmartOutlineSections(sections) {
  const chunksById = new Map(state.smartOutline.chunks.map((chunk) => [chunk.id, chunk]));
  return sections
    .map((section, index) => {
      const chunk = chunksById.get(section.startChunkId);
      if (!chunk || !document.getElementById(chunk.targetId)) return null;
      return {
        id: chunk.targetId,
        text: section.title || `Section ${index + 1}`,
        summary: section.summary || "",
        level: "smart",
        index
      };
    })
    .filter(Boolean);
}

function visibleTocItems() {
  return state.smartOutline.status === "ready" && state.smartOutline.sections.length ? state.smartOutline.sections : state.toc;
}

function markArticleMetadata(articleRoot) {
  articleRoot.querySelectorAll("p").forEach((paragraph) => {
    const text = (paragraph.textContent || "").trim();
    paragraph.classList.toggle("article-meta", /^Author:/i.test(text));
  });
}

function markArticleCaptions(articleRoot) {
  articleRoot.querySelectorAll("img, video").forEach((media) => {
    if (media.closest("figure")?.querySelector("figcaption")) return;
    const parentBlock = media.closest("p, div, section") || media;
    const candidate = media.nextElementSibling?.matches?.("p") ? media.nextElementSibling : parentBlock.nextElementSibling;
    if (!candidate?.matches?.("p")) return;
    const text = (candidate.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 260) return;
    if (/[.!?].+\s[A-Z][a-z]/.test(text) && !/\b(image|photo|figure|source|credit|caption)\b/i.test(text)) return;
    candidate.classList.add("article-caption");
  });
}

function renderTableOfContents() {
  const tocList = document.querySelector("#toc-list");
  if (!tocList) return;
  const items = visibleTocItems();
  updateSmartOutlineControls();
  if (!items.length) {
    tocList.innerHTML = `<span class="toc-empty">Article</span>`;
    return;
  }
  tocList.innerHTML = items
    .map(
      (item, index) =>
        `<a href="#${escapeAttribute(item.id)}" class="toc-link ${item.level === "h3" ? "is-nested" : ""} ${item.level === "smart" ? "is-smart" : ""}" data-section-id="${escapeAttribute(item.id)}" title="${escapeAttribute(item.summary || item.text)}"><b aria-hidden="true">${String(index + 1).padStart(2, "0")}.</b>${escapeHtml(item.text)}</a>`
    )
    .join("");
  tocList.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById(link.dataset.sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderSavedArticles() {
  const list = document.querySelector("#saved-article-list");
  if (!list) return;
  const bookmarks = state.bookmarks.slice(0, 8);
  if (!bookmarks.length) {
    list.innerHTML = `<p class="saved-empty">Click Bookmark or press B to keep articles here locally.</p>`;
    return;
  }

  list.innerHTML = bookmarks
    .map((bookmark) => `
      <button class="saved-article-link ${bookmark.id === state.article.id ? "is-current" : ""}" type="button" data-article-id="${escapeAttribute(bookmark.id)}" title="${escapeAttribute(bookmark.title)}">
        <span>${escapeHtml(bookmark.title)}</span>
        <small>${escapeHtml(bookmark.siteName || hostFor(bookmark.pageUrl))}${savedAtLabel(bookmark.savedAt)}</small>
      </button>
    `)
    .join("");
  list.querySelectorAll("[data-article-id]").forEach((button) => {
    button.addEventListener("click", () => openSavedArticle(button.dataset.articleId));
  });
}

async function openSavedArticle(articleId) {
  if (!articleId || articleId === state.article.id) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: "LECTIO_OPEN_BOOKMARK", articleId });
    if (response?.ok === false) throw new Error(response.error || "Lectio could not open this bookmarked article.");
  } catch (error) {
    showReaderToast(error.message || "Lectio could not open this bookmarked article");
  }
}


function updateSmartOutlineControls() {
  const action = document.querySelector("#smart-outline-action");
  const status = document.querySelector("#smart-outline-status");
  if (!action || !status) return;
  const canOutline = state.smartOutline.chunks.length >= 2;
  action.hidden = !canOutline;
  action.disabled = state.smartOutline.status === "loading";
  action.textContent = state.smartOutline.status === "ready" ? "Regenerate" : "Smart outline";
  action.onclick = () => triggerSmartOutlineLoad({ force: true });

  if (state.smartOutline.status === "loading") {
    status.innerHTML = smartOutlineSkeletonTemplate();
  } else if (state.smartOutline.status === "ready") {
    status.textContent = "AI outline";
  } else if (state.smartOutline.status === "error") {
    status.textContent = "Using detected headings";
  } else if (smartOutlineShouldAutoGenerate()) {
    status.textContent = "Detected headings are sparse";
  } else {
    status.textContent = "";
  }
}

function smartOutlineSkeletonTemplate() {
  const widths = ["78%", "94%", "66%", "88%", "54%"];
  return `
    <span class="toc-skeleton" aria-label="Generating semantic sections">
      ${widths.map((width) => `<span style="--skeleton-width:${width}"></span>`).join("")}
    </span>
  `;
}

function updateReadingProgress() {
  const shell = document.querySelector(".paper-shell");
  if (!shell) return;
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const start = Math.max(0, shell.offsetTop - 120);
  const end = Math.max(start + 1, shell.offsetTop + shell.scrollHeight - window.innerHeight + 120);
  const progress = clamp((scrollTop - start) / (end - start), 0, 1);
  const percent = Math.round(progress * 100);
  document.querySelector("#top-progress-bar")?.style.setProperty("width", `${percent}%`);
  let activeIndex = 0;
  visibleTocItems().forEach((item, index) => {
  const progressLabel = document.querySelector("#reader-progress");
  if (progressLabel) progressLabel.textContent = `${String(percent).padStart(3, "0")}%`;
    const heading = document.getElementById(item.id);
    if (heading && heading.getBoundingClientRect().top <= 150) activeIndex = index;
  });
  document.querySelectorAll(".toc-link").forEach((link, index) => link.classList.toggle("is-active", index === activeIndex));
}

  const activeSection = document.querySelector("#active-section-index");
  if (activeSection) activeSection.textContent = String(activeIndex + 1).padStart(2, "0");

function openTypographyPopover() {
  closeSearchPopover();
  closeFilterPopover();
  closeCommentPopover();
  document.querySelector("#typography-popover")?.classList.toggle("is-visible");
}

function closeTypographyPopover() {
  document.querySelector("#typography-popover")?.classList.remove("is-visible");
}

function bindTypographyControls() {
  document.querySelector("#type-size")?.addEventListener("input", (event) => {
    state.typography.size = Number(event.target.value);
    applyReaderPreferences();
  });
  document.querySelector("#type-line")?.addEventListener("input", (event) => {
    state.typography.lineHeight = Number(event.target.value);
    applyReaderPreferences();
  });
  document.querySelector("#type-width")?.addEventListener("input", (event) => {
    state.typography.width = Number(event.target.value);
    applyReaderPreferences();
  });
}

function applyReaderPreferences() {
  const workspace = document.querySelector(".workspace");
  const article = document.querySelector("#article");
  if (workspace) {
    workspace.classList.toggle("theme-newsprint", state.theme === "newsprint");
    workspace.classList.toggle("theme-paper", state.theme !== "newsprint");
    workspace.classList.toggle("is-focus-mode", state.focusMode);
  }
  if (article) {
    article.style.setProperty("--article-size", `${state.typography.size}px`);
    article.style.setProperty("--article-line", String(state.typography.lineHeight));
    article.style.setProperty("--article-width", `${state.typography.width}px`);
  }
  updateTypographyLabels();
  document.querySelector("#theme-toggle")?.setAttribute("aria-pressed", String(state.theme === "newsprint"));
  const paperLabel = document.querySelector("#theme-toggle .toolbar-label");
  if (paperLabel) paperLabel.textContent = state.theme === "newsprint" ? "Warm paper" : "Paper";
  const paperIcon = document.querySelector("#theme-toggle .theme-icon");
  if (paperIcon) paperIcon.innerHTML = state.theme === "newsprint" ? moonIcon() : sunIcon();
  updateFocusModeButtons();
}

function updateFocusModeButtons() {
  const label = state.focusMode ? "Exit focus mode" : "Enter focus mode";
  for (const button of document.querySelectorAll("#focus-toggle, #focus-floating-toggle")) {
    button.classList.toggle("is-active", state.focusMode);
    button.setAttribute("aria-pressed", String(state.focusMode));
    button.setAttribute("aria-label", label);
    button.title = "Focus mode (F)";
    const textLabel = button.querySelector(".focus-mode-label");
    if (textLabel && button.id === "focus-floating-toggle") textLabel.textContent = state.focusMode ? "Exit focus mode" : "Focus mode";
  }
}

function updateTypographyLabels() {
  const sizeLabel = state.typography.size <= 19 ? "Small" : state.typography.size >= 24 ? "Large" : "Medium";
  const widthPercent = Math.round(((state.typography.width - 640) / (880 - 640)) * 60 + 40);
  const sizeValue = document.querySelector("#type-size-value");
  const lineValue = document.querySelector("#type-line-value");
  const widthValue = document.querySelector("#type-width-value");
  if (sizeValue) sizeValue.textContent = sizeLabel;
  if (lineValue) lineValue.textContent = `${state.typography.lineHeight.toFixed(2).replace(/0$/, "")}×`;
  if (widthValue) widthValue.textContent = `${widthPercent}%`;
}

function toggleTheme() {
  state.theme = state.theme === "newsprint" ? "paper" : "newsprint";
  applyReaderPreferences();
}

function toggleFocusMode() {
  state.focusMode = !state.focusMode;
  applyReaderPreferences();
  updateReadingProgress();
}

async function startArticleListening() {
  openListenPopover();
  if (state.listen.status === "loading" || state.listen.generationPromise) return;
  if (state.listen.status !== "playing") await toggleListenMode();
}

function openListenPopover() {
  closeSearchPopover();
  closeFilterPopover();
  closeTypographyPopover();
  closeCommentPopover();
  closeAssistPopover();
  renderListenPopover();
  document.querySelector("#listen-popover")?.classList.add("is-visible");
  setListenDockVisible(true);
}

function closeListenPopover() {
  document.querySelector("#listen-popover")?.classList.remove("is-visible");
  setListenDockVisible(false);
}

function renderListenPopover() {
  const popover = document.querySelector("#listen-popover");
  if (!popover) return;
  const isLoading = state.listen.status === "loading";
  const isPlaying = state.listen.status === "playing";
  popover.innerHTML = `
    <section class="listen-player ${isPlaying ? "is-playing" : ""} ${isLoading ? "is-loading" : ""}" aria-label="Audio player">
      <div class="listen-transport" aria-label="Playback controls">
        <div class="listen-now" aria-hidden="true"><span>${audioWaveIcon()}</span><strong>Listening</strong><small class="listen-title-marquee"><span>${escapeHtml(state.article?.title || "Article")}</span><span>${escapeHtml(state.article?.title || "Article")}</span></small></div>
        <button id="listen-speed" class="listen-speed-control" type="button" aria-label="Playback speed">${formatListenSpeed(state.listen.speed)}</button>
        <button class="listen-skip" type="button" data-skip="-15" aria-label="Skip back 15 seconds">${skipBack15Icon()}</button>
        <button id="listen-play" class="listen-play" type="button" aria-label="${isPlaying ? "Pause" : "Play"}" ${isLoading ? "disabled" : ""}>${isLoading ? spinnerIcon() : isPlaying ? pauseIcon() : playIcon()}</button>
        <button class="listen-skip" type="button" data-skip="15" aria-label="Skip forward 15 seconds">${skipForward15Icon()}</button>
        <button id="listen-close" class="listen-window-button" type="button" aria-label="Close player">${xIcon()}</button>
      </div>
      <div class="listen-track">
        <span id="listen-current" class="listen-time">0:00</span>
        <input id="listen-progress" class="listen-progress" type="range" min="0" max="1000" value="0" aria-label="Playback progress" />
        <span id="listen-duration" class="listen-time">0:00</span>
      </div>
      ${state.listen.error ? `<p class="listen-error">${escapeHtml(state.listen.error)}</p>` : ""}
    </section>
  `;
  bindListenControls();
  updateListenProgress();
}

function bindListenControls() {
  document.querySelector("#listen-play")?.addEventListener("click", toggleListenMode);
  document.querySelector("#listen-progress")?.addEventListener("input", seekListenAudio);
  document.querySelector("#listen-close")?.addEventListener("click", closeListenPopover);
  document.querySelectorAll("[data-skip]").forEach((button) => {
    button.addEventListener("click", () => skipListenAudio(Number(button.dataset.skip) || 0));
  });
  document.querySelector("#listen-speed")?.addEventListener("click", cycleListenSpeed);
}

function normalizeListenError(message) {
  const text = String(message || "").trim();
  if (/guardrail restrictions|data policy|privacy/i.test(text)) {
    return "OpenRouter privacy settings are blocking this TTS request. Enable the required data policy at https://openrouter.ai/settings/privacy, or choose another TTS model.";
  }
  return text || "Audio generation failed";
}

function cycleListenSpeed() {
  const currentIndex = LISTEN_SPEEDS.indexOf(state.listen.speed);
  const nextSpeed = LISTEN_SPEEDS[(currentIndex + 1) % LISTEN_SPEEDS.length] || 1;
  updateListenConfig({ speed: nextSpeed });
}

function formatListenSpeed(speed) {
  return `${Number(speed).toFixed(2).replace(/\.00$/, "").replace(/0$/, "")}x`;
}

function updateListenConfig(patch) {
  Object.assign(state.listen, patch, { model: LISTEN_MODEL, voice: LISTEN_VOICE, dirty: true, error: "", cacheKey: "", source: "" });
  if (state.listen.audio) {
    state.listen.audio.pause();
    state.listen.audio.currentTime = 0;
  }
  state.listen.status = "idle";
  revokeListenAudio();
  renderListenPopover();
  updateListenState();
}

async function toggleListenMode() {
  try {
    if (state.listen.status === "playing") {
      state.listen.audio?.pause();
      state.listen.status = "paused";
      updateListenState();
      renderListenPopover();
      return;
    }
    if (!state.listen.audio || state.listen.dirty) await generateListenAudio();
    await state.listen.audio.play();
    state.listen.status = "playing";
    updateListenState();
    renderListenPopover();
  } catch (error) {
    state.listen.status = "idle";
    state.listen.error = error.message || "Audio playback failed";
    updateListenState();
    renderListenPopover();
  }
}

async function generateListenAudio() {
  if (state.listen.generationPromise) return state.listen.generationPromise;
  state.listen.generationPromise = generateListenAudioRequest().finally(() => {
    state.listen.generationPromise = null;
    updateListenState();
    renderListenPopover();
  });
  return state.listen.generationPromise;
}

async function generateListenAudioRequest() {
  const ttsText = currentListenText();
  const cacheKey = listenAudioCacheKey(ttsText);
  state.listen.ttsText = ttsText;
  state.listen.cacheKey = cacheKey;
  state.listen.status = "loading";
  state.listen.error = "";
  renderListenPopover();
  updateListenState();

  const cached = await tryLoadCachedListenAudio(cacheKey);
  if (cached?.blob) {
    attachListenAudioBlob(cached.blob, { ttsText, cacheKey, source: "cache" });
    return;
  }

  const response = await fetch(SPEECH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: ttsText, model: state.listen.model, voice: state.listen.voice, speed: state.listen.speed })
  });
  if (!response.ok) {
    let message = "Audio generation failed";
    try {
      const payload = await response.json();
      message = normalizeListenError(payload.error || message);
    } catch {
      message = normalizeListenError(await response.text() || message);
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  await trySaveCachedListenAudio(cacheKey, {
    blob,
    articleId: state.article.id,
    title: state.article.title,
    model: state.listen.model,
    voice: state.listen.voice,
    speed: state.listen.speed,
    textHash: hashText(ttsText),
    createdAt: new Date().toISOString()
  });
  attachListenAudioBlob(blob, { ttsText, cacheKey, source: "network" });
}

function currentListenText() {
  const articleRoot = document.querySelector("#article");
  const articleText = getListenText(articleRoot);
  if (!articleText) throw new Error("No article text to read");
  return articleText.slice(0, 12000);
}

function attachListenAudioBlob(blob, { ttsText, cacheKey, source }) {
  revokeListenAudio();
  state.listen.ttsText = ttsText;
  state.listen.cacheKey = cacheKey;
  state.listen.source = source;
  state.listen.audioUrl = URL.createObjectURL(blob);
  state.listen.audio = new Audio(state.listen.audioUrl);
  state.listen.audio.preload = "metadata";
  state.listen.audio.playbackRate = state.listen.speed;
  state.listen.audio.volume = state.listen.volume;
  state.listen.audio.addEventListener("timeupdate", updateListenProgress);
  state.listen.audio.addEventListener("loadedmetadata", updateListenProgress);
  state.listen.audio.load();
  state.listen.audio.addEventListener("ended", () => {
    state.listen.status = "idle";
    updateListenState();
    renderListenPopover();
  });
  state.listen.dirty = false;
  state.listen.status = "paused";
  updateListenState();
  renderListenPopover();
}

function prepareArticleListening() {
  if (state.listen.prewarmStarted) return;
  state.listen.prewarmStarted = true;
  const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 600));
  schedule(async () => {
    if (state.listen.audio || !state.listen.dirty || state.listen.status !== "idle") return;
    try {
      await generateListenAudio();
    } catch (error) {
      state.listen.status = "idle";
      state.listen.error = error.message || "Audio preparation failed";
      updateListenState();
      renderListenPopover();
    }
  });
}

function listenAudioCacheKey(ttsText) {
  return ["listen", state.article?.id || "article", state.listen.model, state.listen.voice, state.listen.speed, hashText(ttsText)].join(":");
}

function hashText(text) {
  let hash = 2166136261;
  const value = String(text || "");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function tryLoadCachedListenAudio(key) {
  try {
    return await loadCachedListenAudio(key);
  } catch {
    return null;
  }
}

async function trySaveCachedListenAudio(key, value) {
  try {
    await saveCachedListenAudio(key, value);
  } catch {
    // Cache writes are best-effort; playback should still work if storage is full or unavailable.
  }
}

async function loadCachedListenAudio(key) {
  const store = await openListenAudioCache();
  const cached = await idbRequest(store.transaction.objectStore(LISTEN_AUDIO_CACHE_STORE).get(key));
  if (cached) touchCachedListenAudio(key).catch(() => {});
  return cached;
}

async function saveCachedListenAudio(key, value) {
  const store = await openListenAudioCache("readwrite");
  const tx = store.transaction;
  tx.objectStore(LISTEN_AUDIO_CACHE_STORE).put({ key, ...value, lastUsedAt: new Date().toISOString() });
  await idbTransactionDone(tx);
  pruneListenAudioCache().catch(() => {});
}

async function touchCachedListenAudio(key) {
  const store = await openListenAudioCache("readwrite");
  const tx = store.transaction;
  const objectStore = tx.objectStore(LISTEN_AUDIO_CACHE_STORE);
  const cached = await idbRequest(objectStore.get(key));
  if (cached) objectStore.put({ ...cached, lastUsedAt: new Date().toISOString() });
  await idbTransactionDone(tx);
}

async function pruneListenAudioCache() {
  const store = await openListenAudioCache("readwrite");
  const tx = store.transaction;
  const objectStore = tx.objectStore(LISTEN_AUDIO_CACHE_STORE);
  const entries = await idbRequest(objectStore.getAll());
  const stale = entries
    .sort((a, b) => String(b.lastUsedAt || b.createdAt || "").localeCompare(String(a.lastUsedAt || a.createdAt || "")))
    .slice(LISTEN_AUDIO_CACHE_LIMIT);
  for (const entry of stale) objectStore.delete(entry.key);
  await idbTransactionDone(tx);
}

async function openListenAudioCache(mode = "readonly") {
  if (!globalThis.indexedDB) throw new Error("Browser audio cache is unavailable.");
  const db = await idbRequest(globalThis.indexedDB.open(LISTEN_AUDIO_CACHE_DB, 1), {
    upgrade(request) {
      const database = request.result;
      if (!database.objectStoreNames.contains(LISTEN_AUDIO_CACHE_STORE)) {
        database.createObjectStore(LISTEN_AUDIO_CACHE_STORE, { keyPath: "key" });
      }
    }
  });
  return { db, transaction: db.transaction(LISTEN_AUDIO_CACHE_STORE, mode) };
}

function idbRequest(request, options = {}) {
  return new Promise((resolve, reject) => {
    request.onupgradeneeded = () => options.upgrade?.(request);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function idbTransactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

function revokeListenAudio() {
  if (state.listen.audioUrl) URL.revokeObjectURL(state.listen.audioUrl);
  state.listen.audioUrl = "";
  state.listen.audio = null;
}

function seekListenAudio(event) {
  const audio = state.listen.audio;
  if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  audio.currentTime = (Number(event.target.value) / 1000) * audio.duration;
  updateListenProgress();
}

function skipListenAudio(delta) {
  const audio = state.listen.audio;
  if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  audio.currentTime = Math.min(Math.max(audio.currentTime + delta, 0), audio.duration);
  updateListenProgress();
}

function updateListenProgress() {
  const audio = state.listen.audio;
  const current = audio?.currentTime || 0;
  const duration = Number.isFinite(audio?.duration) ? audio.duration : 0;
  const progress = document.querySelector("#listen-progress");
  const currentLabel = document.querySelector("#listen-current");
  const durationLabel = document.querySelector("#listen-duration");
  if (progress) {
    const value = duration > 0 ? Math.round((current / duration) * 1000) : 0;
    progress.value = String(value);
    progress.style.setProperty("--listen-fill", `${value / 10}%`);
  }
  if (currentLabel) currentLabel.textContent = formatListenTime(current);
  if (durationLabel) durationLabel.textContent = formatListenTime(duration);
  updateListenButtonDuration(duration);
}

function listenButtonDurationLabel(duration = Number.isFinite(state.listen.audio?.duration) ? state.listen.audio.duration : 0) {
  if (Number.isFinite(duration) && duration > 0) return formatListenTime(duration);
  if (isListenPreparing()) return "Loading";
  return `${estimateReadingMinutes()} min`;
}

function listenStatusLabel() {
  if (isListenPreparing()) return "Loading audio";
  if (state.listen.status === "playing") return "Listening";
  if (state.listen.error) return "Audio unavailable";
  if (state.listen.audio && !state.listen.dirty) return "Audio ready";
  return "Listen while reading";
}

function isListenPreparing() {
  return state.listen.status === "loading" || Boolean(state.listen.generationPromise);
}

function updateListenButtonDuration(duration) {
  const label = document.querySelector("#article-listen-duration");
  if (label) label.textContent = listenButtonDurationLabel(duration);
  const status = document.querySelector("#article-listen-status");
  if (status) status.textContent = listenStatusLabel();
  document.querySelector("#article-listen-start")?.classList.toggle("is-preparing", isListenPreparing());
}

function formatListenTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function setListenDockVisible(visible) {
  document.querySelector(".workspace")?.classList.toggle("has-listen-player", Boolean(visible));
}

function updateListenState() {
  const active = state.listen.status === "playing" || state.listen.status === "loading";
  const toolbarLabel = document.querySelector("#listen-top .toolbar-label");
  if (toolbarLabel) toolbarLabel.textContent = state.listen.status === "playing" ? "Playing" : state.listen.error ? "Retry" : "Listen";
  for (const button of document.querySelectorAll("#article-listen-start, #listen-top")) {
    button.classList.toggle("is-active", active);
    button.classList.toggle("is-preparing", isListenPreparing());
    button.classList.toggle("has-error", Boolean(state.listen.error));
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", listenStatusLabel());
  }
  updateListenButtonDuration();
}
function handleHighlightTool() {
  if (state.selectionAnchor) {
    addAnnotation("green", false);
    return;
  }
  showReaderToast("Select text in the article to highlight it");
  document.querySelector("#article")?.focus();
}

function handleReaderAssistTool(mode) {
  const selectedText = getSelectedArticleText();
  if (!selectedText) {
    showReaderToast("Select text in the article first");
    document.querySelector("#article")?.focus();
    return;
  }
  openAssistPopover(mode, selectedText);
}

function showReaderToast(message) {
  const toast = document.querySelector("#reader-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showReaderToast.timeout);
  showReaderToast.timeout = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function articleWordCount() {
  return (state.article?.text || state.article?.html || "").replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

function estimateReadingMinutes() {
  const words = articleWordCount();
  return Math.max(1, Math.round(words / 220));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}


function safeCreateAnchorFromSelection(articleRoot, selection) {
  try {
    return createAnchorFromSelection(articleRoot, selection);
  } catch (error) {
    console.warn("Lectio selection anchor failed", error);
    return null;
  }
}

function getSelectedArticleText() {
  const articleRoot = document.querySelector("#article");
  const selection = window.getSelection();
  const anchor = safeCreateAnchorFromSelection(articleRoot, selection);
  if (anchor?.exact?.trim()) {
    state.selectionAnchor = anchor;
    return anchor.exact.trim();
  }
  return state.selectionAnchor?.exact?.trim() || "";
}

function resolveAssistEndpoint() {
  return resolveBackendEndpoint(import.meta.env.VITE_LECTIO_ASSIST_ENDPOINT || "/api/assist");
}

function resolveBackendEndpoint(path) {
  if (window.location.protocol === "chrome-extension:" && path.startsWith("/")) {
    return `http://127.0.0.1:8787${path}`;
  }
  return path;
}

function openAssistPopover(mode, text) {
  const cleanText = text.trim();
  if (!cleanText) return;
  state.assist.mode = mode;
  state.assist.selectedText = cleanText;
  document.querySelector("#selection-popover")?.classList.remove("is-visible");
  closeSearchPopover();
  closeFilterPopover();
  closeTypographyPopover();
  closeCommentPopover();
  renderAssistPopover();
  if (mode === "explain") {
    requestAssist("explain");
  }
}

function renderAssistPopover(content = "", options = {}) {
  const popover = document.querySelector("#assist-popover");
  if (!popover) return;
  const mode = state.assist.mode;
  popover.innerHTML = `
    <section class="assist-card" role="dialog" aria-label="${mode === "translate" ? "Translate selection" : "Explain selection"}">
      <header class="assist-header">
        <div>
          <strong>${mode === "translate" ? "Translate to" : "Explanation"}</strong>
        </div>
        <button type="button" data-action="close" title="Close">${xIcon()}</button>
      </header>
      ${mode === "translate" ? translateAssistTemplate(content, options) : explainAssistTemplate(content, options)}
    </section>
  `;
  popover.classList.add("is-visible");
  popover.querySelector('[data-action="close"]').addEventListener("click", closeAssistPopover);
  popover.querySelector("[data-language]")?.addEventListener("change", (event) => {
    state.assist.targetLanguage = event.target.value;
    requestAssist("translate");
  });
}

function translateAssistTemplate(content, options = {}) {
  return `
    <div class="assist-body">
      <label class="assist-language-select">
        <span>Target language</span>
        <select data-language>
          ${ASSIST_LANGUAGES
            .map((language) => `<option value="${language.value}" ${state.assist.targetLanguage === language.value ? "selected" : ""}>${language.flag} ${language.label}</option>`)
            .join("")}
        </select>
      </label>
      ${assistResultTemplate(content, { ...options, mode: "translate" })}
    </div>
  `;
}
function explainAssistTemplate(content, options = {}) {
  return `
    <div class="assist-body">
      ${assistResultTemplate(content, { ...options, mode: "explain", loading: options.loading || !content })}
    </div>
  `;
}

function assistResultTemplate(content, options = {}) {
  const mode = options.mode || state.assist.mode;
  const direction = assistResultDirection(mode);
  if (options.loading) return assistSkeletonTemplate(mode, direction);
  if (!content) return "";
  return `<div class="assist-result ${options.error ? "is-error" : ""}" dir="${direction}">${escapeHtml(normalizeAssistDisplayText(content))}</div>`;
}

function normalizeAssistDisplayText(text) {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\s+[—–-]{2,}\s+/g, ", ")
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .trim();
}

function assistSkeletonTemplate(mode, direction = "ltr") {
  const widths = mode === "translate" ? ["72%", "91%", "44%"] : ["88%", "96%", "82%", "93%", "74%", "52%"];
  return `
    <div class="assist-result assist-skeleton" dir="${direction}" role="status" aria-live="polite" aria-label="${mode === "translate" ? "Translating" : "Explaining"}">
      ${widths.map((width) => `<span style="--skeleton-width:${width}"></span>`).join("")}
    </div>
  `;
}


async function requestAssist(mode) {
  const requestId = ++state.assist.requestId;
  const cacheKey = assistCacheKey(mode);
  try {
    renderAssistPopover(mode === "translate" ? "Translating..." : "Explaining...", { loading: true });
    const cached = await tryLoadAssistResult(cacheKey);
    if (requestId !== state.assist.requestId) return;
    if (cached?.text) {
      renderAssistPopover(cached.text);
      return;
    }

    const response = await fetch(ASSIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        text: state.assist.selectedText,
        targetLanguage: languageLabel(state.assist.targetLanguage)
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (requestId !== state.assist.requestId) return;
    if (!response.ok) throw new Error(payload.error || "Assist request failed");
    const text = payload.text || "";
    if (text) trySaveAssistResult(cacheKey, { text, createdAt: new Date().toISOString() });
    renderAssistPopover(text);
  } catch (error) {
    if (requestId !== state.assist.requestId) return;
    renderAssistPopover(error.message || "Assist request failed", { error: true });
    showReaderToast(error.message || "Assist request failed");
  }
}

function assistCacheKey(mode) {
  return ["lectio:assist", "v1", mode, state.assist.targetLanguage, hashText(state.assist.selectedText)].join(":");
}

async function tryLoadAssistResult(key) {
  try {
    return await storageAdapter.get(key);
  } catch {
    return null;
  }
}

function trySaveAssistResult(key, value) {
  storageAdapter.set(key, value).catch(() => {});
}

function languageLabel(value) {
  return languageMeta(value).label;
}

function languageMeta(value) {
  return ASSIST_LANGUAGES.find((language) => language.value === value) || ASSIST_LANGUAGES[0];
}

function assistResultDirection(mode) {
  return mode === "translate" ? languageMeta(state.assist.targetLanguage).direction : "ltr";
}

async function copyText(text, message) {
  await navigator.clipboard?.writeText(text);
  showReaderToast(message);
}

function closeAssistPopover() {
  state.assist.requestId += 1;
  document.querySelector("#assist-popover")?.classList.remove("is-visible");
}

function enhanceCodeBlocks(articleRoot) {
  const codeCandidates = [...articleRoot.querySelectorAll("pre")];
  articleRoot.querySelectorAll("code:not(pre code)").forEach((code) => {
    const text = code.textContent || "";
    if (text.includes("\n") || text.length > 96) codeCandidates.push(code);
  });
  articleRoot.querySelectorAll("p").forEach((paragraph) => {
    const text = paragraph.textContent || "";
    if (isStandaloneCodeParagraph(text)) codeCandidates.push(paragraph);
  });

  const seen = new Set();
  codeCandidates.forEach((element, index) => {
    const block = element.closest("pre") || element;
    if (seen.has(block) || block.closest(".code-card")) return;
    seen.add(block);
    const rawCode = block.textContent.trim();
    if (!rawCode) return;
    const language = detectCodeLanguage(block, rawCode);
    const wrapper = document.createElement("figure");
    wrapper.className = language === "Terminal" ? "code-card is-terminal" : "code-card is-code";
    wrapper.dataset.language = language;
    const header = document.createElement("figcaption");
    header.dataset.language = language;
    header.innerHTML = `<span class="window-dots" aria-hidden="true"><span></span><span></span><span></span></span><button type="button" class="copy-code" title="Copy code" aria-label="Copy code">${copyIcon()}</button>`;
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = rawCode;
    pre.append(code);
    wrapper.append(header, pre);
    block.replaceWith(wrapper);
    wrapper.querySelector("button").addEventListener("click", () => copyText(rawCode, "Code copied"));
  });
}

function detectCodeLanguage(element, code) {
  const className = `${element.className || ""} ${element.querySelector?.("code")?.className || ""}`;
  const match = className.match(/language-([\w-]+)|lang-([\w-]+)/i);
  if (match) return normalizeLanguageLabel(match[1] || match[2]);
  if (isTerminalSnippet(code)) return "Terminal";
  if (/^\s*</.test(code) && /<\/?[a-z][\s\S]*>/i.test(code)) return "HTML";
  if (/\b(import|export|const|let|function|=>|console\.)\b/.test(code)) return "JavaScript";
  if (/\b(def|import|from|print)\b.*:/.test(code)) return "Python";
  if (/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i.test(code)) return "SQL";
  if (/\{[\s\S]*:[\s\S]*\}/.test(code)) return "Code";
  return "Code";
}

function normalizeLanguageLabel(value) {
  const normalized = value.toLowerCase();
  if (["sh", "shell", "bash", "zsh", "terminal", "console", "cmd", "powershell", "ps1"].includes(normalized)) return "Terminal";
  if (normalized === "js" || normalized === "javascript") return "JavaScript";
  if (normalized === "ts" || normalized === "typescript") return "TypeScript";
  if (normalized === "py" || normalized === "python") return "Python";
  return value.replace(/^./, (letter) => letter.toUpperCase());
}

function bindSelectionPopover() {
  document.addEventListener("selectionchange", () => {
    if (state.drawing.enabled) return;
    const selection = window.getSelection();
    const articleRoot = document.querySelector("#article");
    const anchor = safeCreateAnchorFromSelection(articleRoot, selection);
    state.selectionAnchor = anchor;

    const popover = document.querySelector("#selection-popover");
    if (!anchor) {
      popover.classList.remove("is-visible");
      return;
    }

    popover.innerHTML = `
      <button class="selection-action" type="button" data-color="yellow" title="Highlight selected text">${highlightIcon()}<span>Highlight</span></button>
      <button class="selection-action" type="button" data-assist="translate" title="Translate selected text">${translateIcon()}<span>Translate</span></button>
      <button class="selection-action" type="button" data-assist="explain" title="Explain selected text">${sparkIcon()}<span>Explain</span></button>
      <button class="selection-action is-primary" type="button" data-note="true" title="Add note">${noteIcon()}<span>Note</span></button>
    `;

    for (const button of popover.querySelectorAll("[data-color]")) {
      button.addEventListener("click", () => addAnnotation(button.dataset.color, false));
    }
    popover.querySelector("[data-note]").addEventListener("click", () => addAnnotation("yellow", true));
    popover.querySelectorAll("[data-assist]").forEach((button) => {
      button.addEventListener("click", () => openAssistPopover(button.dataset.assist, anchor.exact));
    });

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    popover.style.width = "max-content";
    popover.style.maxWidth = `${window.innerWidth - 28}px`;
    popover.classList.add("is-visible");
    const popoverWidth = popover.getBoundingClientRect().width;
    popover.style.left = `${clamp(rect.left + rect.width / 2 - popoverWidth / 2, 14, window.innerWidth - popoverWidth - 14)}px`;
    popover.style.top = `${Math.max(72, rect.top - 58)}px`;
  });
}

async function addAnnotation(color, withNote) {
  if (!state.selectionAnchor) return;

  const annotation = createAnnotation({
    anchor: state.selectionAnchor,
    color,
    note: withNote ? " " : ""
  });
  if (withNote) annotation.type = "note";

  const nextAnnotations = upsertAnnotation(state.annotations, annotation);
  const stored = findSameAnchor(nextAnnotations, annotation.anchor) || annotation;
  await saveAnnotations(nextAnnotations);
  state.activeId = stored.id;
  window.getSelection()?.removeAllRanges();
  document.querySelector("#selection-popover").classList.remove("is-visible");
  renderArticleAndMargin();

  if (withNote) {
    openComment(stored.id, document.querySelector(`[data-annotation-id="${stored.id}"]`));
  }
}

async function removeAnnotation(id) {
  await saveAnnotations(deleteAnnotation(state.annotations, id));
  if (state.activeId === id) state.activeId = null;
  renderArticleAndMargin();
}

async function saveAnnotations(nextAnnotations) {
  state.annotations = nextAnnotations;
  await store.save(state.article.id, state.annotations);
}

function activateAnnotation(id, target) {
  const annotation = state.annotations.find((item) => item.id === id);
  if (!annotation) return;

  if (annotation.type !== "note") {
    saveAnnotations(updateAnnotation(state.annotations, id, { note: " ", type: "note" })).then(() => {
      state.activeId = id;
      renderArticleAndMargin();
      openComment(id, document.querySelector(`[data-annotation-id="${id}"]`));
    });
    return;
  }

  openComment(id, target);
}

function markActive() {
  document.querySelectorAll(".highlight, .comment-marker").forEach((element) => element.classList.remove("is-focused"));
  if (!state.activeId) return;
  document.querySelectorAll(`[data-annotation-id="${state.activeId}"]`).forEach((element) => {
    element.classList.add("is-focused");
  });
}

function scrollToHighlight(id) {
  state.activeId = id;
  const highlight = document.querySelector(`[data-annotation-id="${id}"]`);
  highlight?.scrollIntoView({ block: "center", behavior: "smooth" });
  markActive();
}

async function copyAnnotation(id) {
  const annotation = state.annotations.find((item) => item.id === id);
  if (!annotation) return;
  const text = `${annotation.anchor.exact}\n\n${annotation.note.trim()}`.trim();
  await navigator.clipboard?.writeText(text);
}

function openComment(id, target) {
  const annotation = state.annotations.find((item) => item.id === id);
  if (!annotation) return;

  state.activeId = id;
  state.commentOpenId = id;
  markActive();
  renderCommentPopover(annotation, target || document.querySelector(`[data-annotation-id="${id}"]`));
}

function renderCommentPopover(annotation, target) {
  const popover = document.querySelector("#comment-popover");
  const color = annotation.color || "yellow";
  const colorValue = colorMap.get(color) || colorMap.get("yellow");
  popover.innerHTML = `
    <section class="pdf-comment" style="--note-color: ${colorValue}; --note-wash: ${noteWash(color)}">
      <div class="pdf-comment-header">
        <span class="note-color"><span aria-hidden="true"></span>${escapeHtml(colorLabelMap.get(color) || color)}</span>
        <button type="button" data-action="close" title="Close comment">${xIcon()}</button>
      </div>
      <textarea class="note-editor floating-editor" data-action="edit" placeholder="Write a comment...">${escapeHtml(annotation.note.trim())}</textarea>
      <div class="note-actions pdf-actions">
        <button type="button" data-action="jump" title="Jump to highlight">${pencilIcon()}</button>
        <button type="button" data-action="copy" title="Copy comment">${copyIcon()}</button>
        <button type="button" data-action="delete" title="Delete comment">${trashIcon()}</button>
      </div>
    </section>
  `;

  const rect = target?.getBoundingClientRect?.() || { left: window.innerWidth / 2, top: 140, width: 0, bottom: 160 };
  const popoverWidth = Math.min(380, window.innerWidth - 28);
  const preferredLeft = rect.left + rect.width + 16;
  const fallbackLeft = rect.left - popoverWidth - 16;
  const left = preferredLeft + popoverWidth <= window.innerWidth - 14 ? preferredLeft : Math.max(14, fallbackLeft);
  const top = Math.min(window.innerHeight - 280, Math.max(88, rect.bottom + 8));
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(88, top)}px`;
  popover.classList.add("is-visible");

  popover.querySelector('[data-action="close"]').addEventListener("click", closeCommentPopover);
  popover.querySelector('[data-action="jump"]').addEventListener("click", () => scrollToHighlight(annotation.id));
  popover.querySelector('[data-action="copy"]').addEventListener("click", () => copyAnnotation(annotation.id));
  popover.querySelector('[data-action="delete"]').addEventListener("click", async () => {
    await removeAnnotation(annotation.id);
    closeCommentPopover();
  });

  const textarea = popover.querySelector("textarea");
  textarea.addEventListener("blur", async () => {
    await saveAnnotations(updateAnnotation(state.annotations, annotation.id, { note: textarea.value, type: "note" }));
  });
  textarea.addEventListener("keydown", async (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") textarea.blur();
    if (event.key === "Escape" && textarea.value.trim() === "") {
      event.preventDefault();
      await removeAnnotation(annotation.id);
      closeCommentPopover();
    }
  });
  textarea.focus();
}

function closeCommentPopover() {
  const popover = document.querySelector("#comment-popover");
  popover?.classList.remove("is-visible");
  state.commentOpenId = null;
}

function closeFloatingCommentOnOutsideClick(event) {
  if (!event.target.closest?.(".search-popover, #search-toggle")) closeSearchPopover();
  if (!event.target.closest?.(".typography-popover, #typography-toggle")) closeTypographyPopover();
  if (!event.target.closest?.(".listen-popover, #article-listen-start, #listen-top")) closeListenPopover();
  if (event.target.closest?.(".assist-popover, .listen-popover, .comment-popover, .comment-marker, .highlight, .popover, .review-modal")) return;
  closeCommentPopover();
  closeAssistPopover();
}

function toggleSearchPopover() {
  const popover = document.querySelector("#search-popover");
  if (popover?.classList.contains("is-visible")) {
    closeSearchPopover();
  } else {
    openSearchPopover();
  }
}

function openSearchPopover() {
  const popover = document.querySelector("#search-popover");
  document.querySelector("#selection-popover")?.classList.remove("is-visible");
  closeFilterPopover();
  closeCommentPopover();
  if (!popover?.classList.contains("is-visible")) pushOverlayHistory("search");
  popover?.classList.add("is-visible");
  requestAnimationFrame(() => document.querySelector("#article-search")?.focus());
}

function closeSearchPopover(options = {}) {
  document.querySelector("#search-popover")?.classList.remove("is-visible");
  if (state.overlayHistory.search && !options.fromHistory) {
    state.suppressOverlayPop = true;
    history.back();
  }
  state.overlayHistory.search = false;
}

function pushOverlayHistory(name) {
  if (state.overlayHistory[name]) return;
  history.pushState({ lectioOverlay: name }, "", window.location.href);
  state.overlayHistory[name] = true;
}

function handleOverlayPopstate() {
  if (state.suppressOverlayPop) {
    state.suppressOverlayPop = false;
    return;
  }
  if (document.querySelector("#search-popover")?.classList.contains("is-visible")) {
    closeSearchPopover({ fromHistory: true });
  }
}

function openFilterPopover() {
  document.querySelector("#selection-popover")?.classList.remove("is-visible");
  closeSearchPopover();
  closeCommentPopover();
  document.querySelector("#filter-popover")?.classList.toggle("is-visible");
}

function closeFilterPopover() {
  document.querySelector("#filter-popover")?.classList.remove("is-visible");
}

function bindFilterControls() {
  document.querySelectorAll("[data-filter-color]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filters.color = button.dataset.filterColor;
      updateFilterControls();
      renderArticleAndMargin();
    });
  });
  document.querySelectorAll("[data-filter-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filters.type = button.dataset.filterType;
      updateFilterControls();
      renderArticleAndMargin();
    });
  });
  updateFilterControls();
}

function updateFilterControls() {
  document.querySelectorAll("[data-filter-color]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filterColor === state.filters.color);
  });
  document.querySelectorAll("[data-filter-type]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filterType === state.filters.type);
  });
  document.querySelector("#filter-toggle")?.classList.toggle("has-filters", state.filters.color !== "all" || state.filters.type !== "all");
}

function findSameAnchor(annotations, anchor) {
  return annotations.find(
    (annotation) =>
      annotation.anchor?.exact === anchor.exact &&
      annotation.anchor?.startOffset === anchor.startOffset &&
      annotation.anchor?.endOffset === anchor.endOffset
  );
}

function bindDrawingControls() {
  const canvas = document.querySelector("#drawing-canvas");
  const toggle = document.querySelector("#draw-toggle");
  const tools = document.querySelector("#drawing-tools");
  const sizeInput = document.querySelector("#draw-size");
  if (!canvas || !toggle || !tools || !sizeInput) return;

  toggle.addEventListener("click", () => setDrawingEnabled(!state.drawing.enabled));
  tools.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      state.drawing.tool = button.dataset.tool;
      updateDrawingControls();
    });
  });
  tools.querySelectorAll("[data-color]").forEach((button) => {
    button.addEventListener("click", () => {
      state.drawing.color = button.dataset.color;
      state.drawing.tool = "pen";
      updateDrawingControls();
    });
  });
  sizeInput.addEventListener("input", () => {
    state.drawing.size = Number(sizeInput.value) || 4;
  });
  document.querySelector("#draw-undo").addEventListener("click", undoDrawing);
  document.querySelector("#draw-redo").addEventListener("click", redoDrawing);
  document.querySelector("#draw-clear").addEventListener("click", clearDrawings);

  canvas.addEventListener("pointerdown", startDrawing);
  canvas.addEventListener("pointermove", continueDrawing);
  canvas.addEventListener("pointerup", finishDrawing);
  canvas.addEventListener("pointercancel", cancelDrawing);
  canvas.addEventListener("dblclick", deleteDrawingAtPoint);
  window.addEventListener("resize", resizeDrawingCanvas);
  updateDrawingControls();
  resizeDrawingCanvas();
}

function setDrawingEnabled(enabled) {
  state.drawing.enabled = enabled;
  if (enabled) {
    window.getSelection()?.removeAllRanges();
    document.querySelector("#selection-popover")?.classList.remove("is-visible");
    closeCommentPopover();
  } else {
    cancelDrawing();
  }
  updateDrawingControls();
}

function updateDrawingControls() {
  document.querySelector(".paper-shell")?.classList.toggle("is-drawing", state.drawing.enabled);
  document.querySelector("#draw-toggle")?.classList.toggle("is-active", state.drawing.enabled);
  document.querySelector("#draw-toggle")?.setAttribute("aria-pressed", String(state.drawing.enabled));
  document.querySelector("#drawing-tools")?.classList.toggle("is-visible", state.drawing.enabled);
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === state.drawing.tool);
  });
  document.querySelectorAll("[data-color]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.color === state.drawing.color);
  });
  const sizeInput = document.querySelector("#draw-size");
  if (sizeInput) sizeInput.value = state.drawing.size;
}

function resizeDrawingCanvas() {
  const canvas = document.querySelector("#drawing-canvas");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  redrawDrawingCanvas();
}

function redrawDrawingCanvas() {
  const canvas = document.querySelector("#drawing-canvas");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(ratio, ratio);
  for (const stroke of state.drawings) drawStroke(context, stroke, rect.width, rect.height);
  if (state.drawing.activeStroke) drawStroke(context, state.drawing.activeStroke, rect.width, rect.height);
  context.restore();
}

function drawStroke(context, stroke, width, height) {
  if (!stroke.points?.length) return;
  context.save();
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.size;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (["line", "arrow", "rect", "ellipse"].includes(stroke.tool)) {
    drawShape(context, stroke, width, height);
    context.restore();
    return;
  }

  context.beginPath();
  stroke.points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    context.lineTo(point.x * width + 0.01, point.y * height + 0.01);
  }
  context.stroke();
  context.restore();
}

function drawShape(context, stroke, width, height) {
  const start = stroke.points[0];
  const end = stroke.points.at(-1) || start;
  const x1 = start.x * width;
  const y1 = start.y * height;
  const x2 = end.x * width;
  const y2 = end.y * height;

  if (stroke.tool === "line" || stroke.tool === "arrow") {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
    if (stroke.tool === "arrow") drawArrowHead(context, x1, y1, x2, y2, stroke.size);
    return;
  }

  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const shapeWidth = Math.abs(x2 - x1);
  const shapeHeight = Math.abs(y2 - y1);
  context.beginPath();
  if (stroke.tool === "rect") {
    context.rect(left, top, shapeWidth, shapeHeight);
  } else {
    context.ellipse(left + shapeWidth / 2, top + shapeHeight / 2, shapeWidth / 2, shapeHeight / 2, 0, 0, Math.PI * 2);
  }
  context.stroke();
}

function drawArrowHead(context, x1, y1, x2, y2, size) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = Math.max(12, size * 4);
  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(x2 - length * Math.cos(angle - Math.PI / 6), y2 - length * Math.sin(angle - Math.PI / 6));
  context.moveTo(x2, y2);
  context.lineTo(x2 - length * Math.cos(angle + Math.PI / 6), y2 - length * Math.sin(angle + Math.PI / 6));
  context.stroke();
}

async function startDrawing(event) {
  if (!state.drawing.enabled) return;
  event.preventDefault();
  const canvas = event.currentTarget;
  if (state.drawing.tool === "eraser" && (await removeDrawingAtPoint(pointFromEvent(event, canvas), canvas))) return;
  canvas.setPointerCapture(event.pointerId);
  state.drawing.activeStroke = {
    id: crypto.randomUUID?.() || `stroke_${Date.now()}`,
    tool: state.drawing.tool,
    color: state.drawing.color,
    size: state.drawing.tool === "eraser" ? state.drawing.size * 3 : state.drawing.size,
    points: [pointFromEvent(event, canvas)]
  };
  redrawDrawingCanvas();
}

function continueDrawing(event) {
  if (!state.drawing.activeStroke) return;
  event.preventDefault();
  const canvas = event.currentTarget;
  const nextPoint = pointFromEvent(event, canvas);
  if (["line", "arrow", "rect", "ellipse"].includes(state.drawing.activeStroke.tool)) {
    state.drawing.activeStroke.points = [state.drawing.activeStroke.points[0], nextPoint];
    redrawDrawingCanvas();
    return;
  }
  const previous = state.drawing.activeStroke.points.at(-1);
  if (previous && Math.hypot(nextPoint.x - previous.x, nextPoint.y - previous.y) < 0.0018) return;
  state.drawing.activeStroke.points.push(nextPoint);
  redrawDrawingCanvas();
}

async function finishDrawing(event) {
  if (!state.drawing.activeStroke) return;
  event.preventDefault();
  state.drawings = [...state.drawings, state.drawing.activeStroke];
  state.drawing.activeStroke = null;
  state.drawing.redoStack = [];
  redrawDrawingCanvas();
  await saveDrawings();
}

function cancelDrawing() {
  state.drawing.activeStroke = null;
  redrawDrawingCanvas();
}

function pointFromEvent(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  };
}

async function deleteDrawingAtPoint(event) {
  if (!state.drawing.enabled) return;
  event.preventDefault();
  await removeDrawingAtPoint(pointFromEvent(event, event.currentTarget), event.currentTarget);
}

async function removeDrawingAtPoint(point, canvas) {
  const index = findDrawingAtPoint(point, canvas);
  if (index === -1) return false;
  const removed = state.drawings[index];
  state.drawings = state.drawings.filter((_, itemIndex) => itemIndex !== index);
  state.drawing.redoStack = [removed, ...state.drawing.redoStack];
  redrawDrawingCanvas();
  await saveDrawings();
  return true;
}

function findDrawingAtPoint(point, canvas) {
  const rect = canvas.getBoundingClientRect();
  const tolerance = Math.max(10, state.drawing.size * 2.5);
  for (let index = state.drawings.length - 1; index >= 0; index -= 1) {
    if (strokeContainsPoint(state.drawings[index], point, rect.width, rect.height, tolerance)) return index;
  }
  return -1;
}

function strokeContainsPoint(stroke, point, width, height, tolerance) {
  const points = stroke.points || [];
  if (!points.length) return false;
  const target = { x: point.x * width, y: point.y * height };
  const scaled = points.map((item) => ({ x: item.x * width, y: item.y * height }));

  if (["rect", "ellipse"].includes(stroke.tool) && scaled.length > 1) {
    const start = scaled[0];
    const end = scaled.at(-1);
    const left = Math.min(start.x, end.x) - tolerance;
    const right = Math.max(start.x, end.x) + tolerance;
    const top = Math.min(start.y, end.y) - tolerance;
    const bottom = Math.max(start.y, end.y) + tolerance;
    return target.x >= left && target.x <= right && target.y >= top && target.y <= bottom;
  }

  if (scaled.length === 1) return Math.hypot(target.x - scaled[0].x, target.y - scaled[0].y) <= tolerance;
  for (let index = 1; index < scaled.length; index += 1) {
    if (distanceToSegment(target, scaled[index - 1], scaled[index]) <= tolerance) return true;
  }
  return false;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return Math.hypot(point.x - x, point.y - y);
}

async function undoDrawing() {
  if (state.drawings.length === 0) return;
  const removed = state.drawings.at(-1);
  state.drawings = state.drawings.slice(0, -1);
  state.drawing.redoStack = [removed, ...state.drawing.redoStack];
  redrawDrawingCanvas();
  await saveDrawings();
}

async function redoDrawing() {
  if (state.drawing.redoStack.length === 0) return;
  const [restored, ...rest] = state.drawing.redoStack;
  state.drawings = [...state.drawings, restored];
  state.drawing.redoStack = rest;
  redrawDrawingCanvas();
  await saveDrawings();
}

async function clearDrawings() {
  if (state.drawings.length === 0) return;
  state.drawing.redoStack = [...state.drawings].reverse();
  state.drawings = [];
  redrawDrawingCanvas();
  await saveDrawings();
}

async function saveDrawings() {
  await drawingStore.save(state.article.id, state.drawings);
}

function exportPdf() {
  closeSearchPopover();
  closeFilterPopover();
  closeTypographyPopover();
  closeCommentPopover();
  closeAssistPopover();
  closeReviewModal();
  cancelDrawing();
  renderPrintNotes();
  resizeDrawingCanvas();
  document.title = (state.article.title || "Lectio") + " - annotated";
  requestAnimationFrame(() => window.print());
}

function renderPrintNotes() {
  const root = document.querySelector("#print-notes");
  if (!root) return;
  const notes = state.annotations
    .filter((annotation) => annotation.type === "note" || annotation.note?.trim())
    .sort((a, b) => a.anchor.startOffset - b.anchor.startOffset);
  const drawingSummary = state.drawings.length
    ? `<p class="print-drawing-summary">${state.drawings.length} drawing mark${state.drawings.length === 1 ? "" : "s"} appear on the article pages.</p>`
    : "";

  if (!notes.length && !drawingSummary) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = `
    <h2>Notes</h2>
    ${drawingSummary}
    ${notes
      .map(
        (annotation, index) => `
          <article class="print-note">
            <h3>Note ${index + 1}</h3>
            <blockquote>${escapeHtml(shortQuote(annotation.anchor.exact))}</blockquote>
            ${annotation.note?.trim() ? `<p>${escapeHtml(annotation.note.trim())}</p>` : ""}
          </article>
        `
      )
      .join("")}
  `;
}

function handleGlobalKeydown(event) {
  const key = event.key.toLowerCase();
  const typing = isTypingTarget(event.target);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openSearchPopover();
    return;
  }
  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target)) {
    event.preventDefault();
    openSearchPopover();
    return;
  }
  if (key === "d" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing) {
    event.preventDefault();
    setDrawingEnabled(!state.drawing.enabled);
    return;
  }
  if (state.drawing.enabled && !typing && (event.metaKey || event.ctrlKey) && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redoDrawing();
    else undoDrawing();
    return;
  }
  if (state.drawing.enabled && !typing && (event.metaKey || event.ctrlKey) && key === "y") {
    event.preventDefault();
    redoDrawing();
    return;
  }
  if (state.drawing.enabled && !typing && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    undoDrawing();
    return;
  }
  if (state.drawing.enabled && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const toolShortcuts = { p: "pen", e: "eraser", r: "rect", o: "ellipse", a: "arrow", x: "line" };
    if (toolShortcuts[key]) {
      event.preventDefault();
      state.drawing.tool = toolShortcuts[key];
      updateDrawingControls();
      return;
    }
  }
  if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (key === "h") {
      event.preventDefault();
      handleHighlightTool();
      return;
    }
    if (key === "n") {
      event.preventDefault();
      openReviewModal();
      return;
    }
    if (key === "l") {
      event.preventDefault();
      startArticleListening();
      return;
    }
    if (key === "b") {
      event.preventDefault();
      handleBookmarkArticle();
      return;
    }
    if (key === "f") {
      event.preventDefault();
      toggleFocusMode();
      return;
    }
  }
  if (event.key === "Escape") {
    if (document.querySelector("#search-popover")?.classList.contains("is-visible")) {
      event.preventDefault();
      closeSearchPopover();
      return;
    }
    if (document.querySelector("#review-modal")?.classList.contains("is-visible")) {
      event.preventDefault();
      closeReviewModal();
      return;
    }
    if (document.querySelector("#typography-popover")?.classList.contains("is-visible")) {
      event.preventDefault();
      closeTypographyPopover();
      return;
    }
    if (document.querySelector("#listen-popover")?.classList.contains("is-visible")) {
      event.preventDefault();
      closeListenPopover();
      return;
    }
    if (document.querySelector("#assist-popover")?.classList.contains("is-visible")) {
      event.preventDefault();
      closeAssistPopover();
      return;
    }
    if (state.drawing.enabled) {
      event.preventDefault();
      setDrawingEnabled(false);
    }
  }
}

function isTypingTarget(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
}

function openReviewModal() {
  const modal = document.querySelector("#review-modal");
  if (!modal) return;
  const notes = state.annotations.filter((annotation) => annotation.type === "note");
  const highlights = state.annotations.filter((annotation) => annotation.type !== "note");
  modal.innerHTML = `
    <section class="review-sheet" role="dialog" aria-modal="true" aria-label="Review annotations">
      <div class="review-header">
        <div>
          <strong>Review</strong>
          <span>${notes.length} notes, ${highlights.length} highlights, ${state.drawings.length} drawings</span>
        </div>
        <button type="button" data-action="close" title="Close">${xIcon()}</button>
      </div>
      <div class="review-list">
        ${reviewItemsTemplate(notes, highlights)}
      </div>
    </section>
  `;
  modal.classList.add("is-visible");
  modal.querySelector('[data-action="close"]').addEventListener("click", closeReviewModal);
  modal.onmousedown = (event) => {
    if (event.target === modal) closeReviewModal();
  };
  modal.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      closeReviewModal();
      scrollToHighlight(button.dataset.jump);
    });
  });
  modal.querySelector('[data-action="draw"]')?.addEventListener("click", () => {
    closeReviewModal();
    setDrawingEnabled(true);
  });
}

function reviewItemsTemplate(notes, highlights) {
  const items = [...notes, ...highlights]
    .sort((a, b) => a.anchor.startOffset - b.anchor.startOffset)
    .map((annotation) => `
      <article class="review-item">
        <div>
          <span class="review-kind">${annotation.type === "note" ? "Note" : "Highlight"}</span>
          <p>${escapeHtml(shortQuote(annotation.anchor.exact))}</p>
          ${annotation.note?.trim() ? `<small>${escapeHtml(shortQuote(annotation.note.trim()))}</small>` : ""}
        </div>
        <button type="button" data-jump="${annotation.id}" title="Jump to annotation">${pencilIcon()}</button>
      </article>
    `);

  if (state.drawings.length) {
    items.push(`
      <article class="review-item">
        <div>
          <span class="review-kind">Drawing</span>
          <p>${state.drawings.length} mark${state.drawings.length === 1 ? "" : "s"} on this article</p>
        </div>
        <button type="button" data-action="draw" title="Open drawing mode">${drawIcon()}</button>
      </article>
    `);
  }

  return items.length ? items.join("") : `<p class="review-empty">No annotations yet.</p>`;
}

function closeReviewModal() {
  document.querySelector("#review-modal")?.classList.remove("is-visible");
}

function matchesSearch(annotation) {
  const query = state.searchQuery.trim().toLowerCase();
  if (!query) return true;
  return annotation.anchor.exact.toLowerCase().includes(query) || annotation.note.toLowerCase().includes(query);
}

function renderError(message) {
  app.innerHTML = `
    <main class="error-state">
      <div class="brand-block"><span class="brand-mark">${bookIcon()}</span><span class="brand-name">Lectio</span></div>
      <h1>Lectio could not open this article</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value || "#");
}

function shortQuote(text) {
  return text.length > 150 ? `${text.slice(0, 147)}...` : text;
}

function hostFor(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Saved article";
  }
}

function savedAtLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return ` · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function slugify(text) {
  return (text || "lectio")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function noteWash(color) {
  return (
    {
      yellow: "#fff8e6",
      orange: "#fff1df",
      green: "#f1faef",
      blue: "#eff7ff",
      pink: "#fff0f1"
    }[color] || "#fff8e6"
  );
}

function svg(path, options = {}) {
  return `<svg viewBox="0 0 24 24" width="${options.size || 18}" height="${options.size || 18}" fill="none" stroke="currentColor" stroke-width="${options.stroke || 1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function clockIcon() {
  return svg('<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>', { size: 17 });
}

function checkCircleIcon() {
  return svg('<circle cx="12" cy="12" r="8"/><path d="m8.5 12.2 2.2 2.2 4.8-5"/>', { size: 17 });
}

function sunIcon() {
  return svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>', { size: 16 });
}

function moonIcon() {
  return svg('<path d="M20 14.5A7 7 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>', { size: 16 });
}

function bookmarkIcon(filled = false) {
  return filled
    ? svg('<path d="M6 4h12v17l-6-3.5L6 21V4Z" fill="currentColor"/>', { size: 20, stroke: 2 })
    : svg('<path d="M6 4h12v17l-6-3.5L6 21V4Z"/>', { size: 20 });
}

function playIcon() {
  return svg('<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>', { size: 18 });
}

function pauseIcon() {
  return svg('<path d="M8 5v14"/><path d="M16 5v14"/>', { size: 18, stroke: 2.4 });
}

function spinnerIcon() {
  return svg('<path d="M21 12a9 9 0 1 1-4.2-7.6"/>', { size: 18, stroke: 2.4 });
}

function headphonesIcon() {
  return svg('<path d="M4 14a8 8 0 0 1 16 0"/><path d="M4 14v4a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2"/><path d="M20 14v4a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2"/>', { size: 18 });
}

function audioWaveIcon() {
  return svg('<path d="M4 14V10"/><path d="M8 18V6"/><path d="M12 21V3"/><path d="M16 18V6"/><path d="M20 14V10"/>', { size: 20, stroke: 2.1 });
}

function skipBack15Icon() {
  return svg('<path d="M8.2 7.4H4.8V4"/><path d="M5 7.2A8 8 0 1 1 4.6 14"/><text x="12" y="15" fill="currentColor" stroke="none" font-size="7.2" font-weight="800" text-anchor="middle" dominant-baseline="middle">15</text>', { size: 26, stroke: 1.9 });
}

function skipForward15Icon() {
  return svg('<path d="M15.8 7.4h3.4V4"/><path d="M19 7.2A8 8 0 1 0 19.4 14"/><text x="12" y="15" fill="currentColor" stroke="none" font-size="7.2" font-weight="800" text-anchor="middle" dominant-baseline="middle">15</text>', { size: 26, stroke: 1.9 });
}

function moreVerticalIcon() {
  return svg('<path d="M12 5h.01"/><path d="M12 12h.01"/><path d="M12 19h.01"/>', { size: 22, stroke: 3.4 });
}

function focusIcon() {
  return svg('<circle cx="12" cy="12" r="4"/><path d="M4 12h2"/><path d="M18 12h2"/><path d="M12 4v2"/><path d="M12 18v2"/>', { size: 18 });
}

function bookIcon() {
  return svg('<path d="M4 5.5c2.5 0 4.5.7 6 2.1v11.2c-1.5-1.4-3.5-2.1-6-2.1V5.5Z"/><path d="M20 5.5c-2.5 0-4.5.7-6 2.1v11.2c1.5-1.4 3.5-2.1 6-2.1V5.5Z"/><path d="M10 7.6h4"/>', { size: 24, stroke: 1.9 });
}

function externalIcon() {
  return svg('<path d="M14 4h6v6"/><path d="m10 14 10-10"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/>', { size: 16 });
}

function searchIcon() {
  return svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', { size: 17 });
}

function downloadIcon() {
  return svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', { size: 17, stroke: 2 });
}

function drawIcon() {
  return svg('<path d="m4 20 4.2-1 10-10a2.2 2.2 0 0 0-3.1-3.1l-10 10Z"/><path d="m13.5 7.5 3 3"/><path d="M14 20h6"/>', { size: 17 });
}

function filterIcon() {
  return svg('<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>', { size: 17, stroke: 2 });
}

function translateIcon() {
  return svg('<path d="M4 5h8"/><path d="M8 3v2"/><path d="M10 5c-.5 2.8-2.2 5.1-5 7"/><path d="M5.5 8.5c1 1.4 2.3 2.5 4 3.3"/><path d="M13 20l4-9 4 9"/><path d="M14.3 17h5.4"/>', { size: 17 });
}

function sparkIcon() {
  return svg('<path d="m12 3 1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8Z"/><path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8Z"/><path d="m19 14 .7 1.7L21 16l-1.3.3L19 18l-.7-1.7L17 16l1.3-.3Z"/>', { size: 17 });
}

function highlightIcon() {
  return svg('<path d="M5 19h14"/><path d="m7 15 8-8 2 2-8 8H7z"/>', { size: 17 });
}

function listIcon() {
  return svg('<path d="M8 6h12"/><path d="M8 12h12"/><path d="M8 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>', { size: 17, stroke: 2 });
}

function penIcon() {
  return svg('<path d="m4 20 4-.8L18.5 8.7a2 2 0 0 0-2.8-2.8L5.2 16.4z"/><path d="m14.5 7.1 2.4 2.4"/>', { size: 17 });
}

function lineIcon() {
  return svg('<path d="M5 19 19 5"/>', { size: 17, stroke: 2 });
}

function arrowIcon() {
  return svg('<path d="M5 19 19 5"/><path d="M10 5h9v9"/>', { size: 17, stroke: 2 });
}

function rectangleIcon() {
  return svg('<rect x="5" y="6" width="14" height="12" rx="1.5"/>', { size: 17 });
}

function ellipseIcon() {
  return svg('<ellipse cx="12" cy="12" rx="7" ry="5"/>', { size: 17 });
}

function eraserIcon() {
  return svg('<path d="m7 21-4-4 10-10a2.8 2.8 0 0 1 4 4L7 21Z"/><path d="m9 15 4 4"/><path d="M12 21h8"/>', { size: 17 });
}

function brushIcon() {
  return svg('<path d="M4 19c2 1 4 .6 5-1.2.8-1.4-.2-2.8-1.6-2.1C5.8 16.5 6 18 4 19Z"/><path d="M8.5 15.5 19 5"/>', { size: 17 });
}

function undoIcon() {
  return svg('<path d="M9 7 4 12l5 5"/><path d="M5 12h9a5 5 0 0 1 0 10h-2"/>', { size: 17 });
}

function redoIcon() {
  return svg('<path d="m15 7 5 5-5 5"/><path d="M19 12h-9a5 5 0 0 0 0 10h2"/>', { size: 17 });
}

function noteIcon() {
  return svg('<path d="M6 4h12v12H9l-3 3z"/><path d="M9 8h6"/><path d="M9 12h5"/>', { size: 17 });
}

function pencilIcon() {
  return svg('<path d="m4 20 4-.8L18.5 8.7a2 2 0 0 0-2.8-2.8L5.2 16.4z"/><path d="m14.5 7.1 2.4 2.4"/>', { size: 16 });
}

function copyIcon() {
  return svg('<rect x="8" y="8" width="11" height="11" rx="1.5"/><path d="M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1"/>', { size: 16 });
}

function trashIcon() {
  return svg('<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="m10 11 .4 6"/><path d="m14 11-.4 6"/><path d="M6 7l1 14h10l1-14"/>', { size: 16 });
}


function xIcon() {
  return svg('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>', { size: 16, stroke: 2 });
}
