import "./styles.css";
import {
  HIGHLIGHT_COLORS,
  createAnnotation,
  deleteAnnotation,
  filterAnnotations,
  updateAnnotation,
  upsertAnnotation
} from "../core/annotations.js";
import { createAnchorFromSelection, resolveAnchor } from "../core/textAnchor.js";
import { createAnnotationStore, createChromeStorageAdapter, createDrawingStore, createRemoteAnnotationStore } from "../core/localPersistence.js";
import { renderHighlights, renderSearchHighlights, sanitizeArticleHtml } from "./dom.js";

const colorMap = new Map(HIGHLIGHT_COLORS.map((color) => [color.id, color.value]));
const colorLabelMap = new Map(HIGHLIGHT_COLORS.map((color) => [color.id, color.label]));
const DRAWING_COLORS = ["#171717", "#e03131", "#1971c2", "#2f9e44", "#f08c00"];
const ASSIST_LANGUAGES = [
  { value: "en", label: "English", flag: "🇬🇧", direction: "ltr" },
  { value: "fr", label: "French", flag: "🇫🇷", direction: "ltr" },
  { value: "es", label: "Spanish", flag: "🇪🇸", direction: "ltr" },
  { value: "de", label: "German", flag: "🇩🇪", direction: "ltr" },
  { value: "ar", label: "Arabic", flag: "🇸🇦", direction: "rtl" },
  { value: "zh-CN", label: "Chinese", flag: "🇨🇳", direction: "ltr" },
  { value: "ja", label: "Japanese", flag: "🇯🇵", direction: "ltr" }
];
const ASSIST_ENDPOINT = resolveAssistEndpoint();
const NOTES_ENDPOINT = resolveBackendEndpoint("/api/notes");
const state = {
  article: null,
  annotations: [],
  drawings: [],
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
  assist: {
    selectedText: "",
    mode: "translate",
    targetLanguage: "en",
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
  suppressOverlayPop: false,
  auth: {
    token: "",
    user: null,
    mode: "login"
  }
};

const storageAdapter = createChromeStorageAdapter();
const localAnnotationStore = createAnnotationStore(storageAdapter);
let store = localAnnotationStore;
const drawingStore = createDrawingStore(storageAdapter);
const app = document.querySelector("#app");

boot().catch((error) => {
  renderError(error.message);
});

async function boot() {
  state.auth.token = await loadAuthToken();
  await refreshCurrentUser();
  configureAnnotationStore();
  state.article = await loadArticleFromSession();
  if (state.article.error) throw new Error(state.article.error);
  const [annotations, drawings] = await Promise.all([store.load(state.article.id), drawingStore.load(state.article.id)]);
  state.annotations = annotations;
  state.drawings = drawings;
  renderWorkspace();
}

async function loadArticleFromSession() {
  const sessionId = new URLSearchParams(window.location.search).get("session");
  if (!sessionId) throw new Error("Missing reader session.");

  const key = `openread:session:${sessionId}`;
  const result = await chrome.storage.session.get(key);
  const article = result[key];
  if (!article) throw new Error("The reader session expired. Reopen the article from the extension button.");
  await chrome.storage.session.remove(key);
  return article;
}

function renderWorkspace() {
  state.filters = { color: "all", type: "all" };
  app.innerHTML = `
    <main class="workspace theme-paper">
      <header class="appbar">
        <div class="reader-meta">
          <div class="brand-block">
            <span class="brand-mark" aria-hidden="true">${bookIcon()}</span>
            <span class="brand-name">OpenRead</span>
          </div>
          <div class="appbar-divider" aria-hidden="true"></div>
          <div class="title-block">
            <a class="source-title" href="${escapeAttribute(state.article.pageUrl || state.article.url)}" target="_blank" rel="noreferrer" title="Open source page">
              <h1>${escapeHtml(state.article.title)}</h1>
            </a>
            <span class="saved-status">${checkCircleIcon()} Saved</span>
          </div>
        </div>
        <div class="top-actions">
          <button id="search-toggle" class="toolbar-button search-toggle" type="button" title="Search article (/)" aria-label="Search article">${searchIcon()}<kbd class="shortcut-badge" aria-hidden="true">/</kbd></button>
          <button id="draw-toggle" class="toolbar-button" type="button" aria-pressed="false" title="Draw on page (D)" aria-label="Draw on page">${drawIcon()}<kbd class="shortcut-badge" aria-hidden="true">D</kbd></button>
          <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle night mode" aria-pressed="false"><span>${sunIcon()}</span><span>${moonIcon()}</span></button>
          <button id="typography-toggle" class="text-button" type="button" title="Typography settings" aria-label="Typography settings">Aa</button>
          <button id="export-pdf" class="toolbar-button export-button" type="button" title="Export PDF" aria-label="Export PDF">${downloadIcon()}</button>
          <button id="bookmark-top" class="bookmark-button" type="button" title="Bookmark article (B)" aria-label="Bookmark article">${bookmarkIcon()}<kbd class="shortcut-badge" aria-hidden="true">B</kbd></button>
          <button id="account-toggle" class="toolbar-button account-toggle" type="button" title="Account" aria-label="Account">${userIcon()}</button>
        </div>
        <div class="top-progress" aria-hidden="true"><span id="top-progress-bar"></span></div>
      </header>
      <aside class="reader-sidebar" aria-label="On this page">
        <div class="toc-panel">
          <p class="toc-heading">On this page</p>
          <nav id="toc-list" class="toc-list"></nav>
        </div>
      </aside>

      <div id="search-popover" class="search-popover" aria-label="Article search">
        <label class="search-box">
          ${searchIcon()}
          <input id="article-search" type="search" placeholder="Search article" autocomplete="off" />
          <span id="search-count" class="search-count" aria-live="polite"></span>
          <kbd>/</kbd>
        </label>
      </div>
      <div id="auth-popover" class="auth-popover" aria-label="Account" role="dialog"></div>
      <div id="typography-popover" class="typography-popover" aria-label="Reading settings" role="dialog">
        <section class="type-panel">
          <header class="settings-header">
            <div class="settings-title"><span class="brand-mark" aria-hidden="true">${bookIcon()}</span><h2>Reading settings</h2></div>
            <button id="type-close" class="settings-close" type="button" aria-label="Close reading settings">${xIcon()}</button>
          </header>
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
          <article id="article" class="article" tabindex="-1"></article>
          <canvas id="drawing-canvas" class="drawing-canvas" aria-label="Drawing layer"></canvas>
        </section>
        <section id="print-notes" class="print-notes" aria-hidden="true"></section>
      </div>

      <nav class="reader-tools" aria-label="Reader tools">
        <button id="highlight-tool" class="reader-tool is-primary" type="button" title="Highlight selected text (H)">${highlightIcon()}<span>Highlight</span><kbd class="shortcut-badge reader-shortcut" aria-hidden="true">H</kbd></button>
        <button id="review-open" class="reader-tool" type="button" title="Review notes (N)">${noteIcon()}<span>Notes</span><kbd class="shortcut-badge reader-shortcut" aria-hidden="true">N</kbd></button>
        <button id="listen-toggle" class="reader-tool" type="button" title="Listen (L)" aria-pressed="false">${headphonesIcon()}<span>Listen</span><kbd class="shortcut-badge reader-shortcut" aria-hidden="true">L</kbd></button>
        <button id="bookmark-tool" class="reader-tool" type="button" title="Bookmark article (B)">${bookmarkIcon()}<span>Bookmark</span><kbd class="shortcut-badge reader-shortcut" aria-hidden="true">B</kbd></button>
        <button id="focus-toggle" class="reader-tool" type="button" title="Focus mode" aria-pressed="false">${focusIcon()}<span>Focus</span></button>
      </nav>

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
          ${brushIcon()}
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
  document.querySelector("#account-toggle").addEventListener("click", openAuthPopover);
  document.querySelector("#typography-toggle").addEventListener("click", openTypographyPopover);
  document.querySelector("#type-close").addEventListener("click", closeTypographyPopover);
  document.querySelector("#theme-toggle").addEventListener("click", toggleTheme);
  document.querySelector("#focus-toggle").addEventListener("click", toggleFocusMode);
  document.querySelector("#listen-toggle").addEventListener("click", toggleListenMode);
  document.querySelector("#highlight-tool").addEventListener("click", handleHighlightTool);
  document.querySelector("#bookmark-tool").addEventListener("click", () => showReaderToast("Article saved to OpenRead"));
  document.querySelector("#bookmark-top").addEventListener("click", () => showReaderToast("Article saved to OpenRead"));
  bindTypographyControls();
  renderAuthPopover();
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
  document.querySelector("#review-open").addEventListener("click", openReviewModal);
  document.querySelector("#selection-popover").addEventListener("mousedown", (event) => event.preventDefault());
  document.addEventListener("mousedown", closeFloatingCommentOnOutsideClick);

  renderArticleAndMargin();
  bindSelectionPopover();
  bindDrawingControls();
}

function renderArticleAndMargin(options = {}) {
  const articleRoot = document.querySelector("#article");
  articleRoot.innerHTML = sanitizeArticleHtml(state.article.html);
  prepareArticleHeadings(articleRoot);
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
  const primaryHeadings = [...articleRoot.querySelectorAll("h2, h3")];
  const fallbackHeadings = primaryHeadings.length ? primaryHeadings : [...articleRoot.querySelectorAll("h1, h2")];
  const seen = new Set();
  state.toc = filterArticleTocHeadings(fallbackHeadings, seen).slice(0, 12).map((heading, index) => {
    if (!heading.id) heading.id = `openread-section-${index + 1}`;
    return {
      id: heading.id,
      text: (heading.textContent || `Section ${index + 1}`).trim(),
      level: heading.tagName.toLowerCase(),
      index
    };
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

function markArticleMetadata(articleRoot) {
  articleRoot.querySelectorAll("p").forEach((paragraph) => {
    const text = (paragraph.textContent || "").trim();
    paragraph.classList.toggle("article-meta", /^Author:/i.test(text));
  });
}

function renderTableOfContents() {
  const tocList = document.querySelector("#toc-list");
  if (!tocList) return;
  if (!state.toc.length) {
    tocList.innerHTML = `<span class="toc-empty">Article</span>`;
    return;
  }
  tocList.innerHTML = state.toc
    .map(
      (item) =>
        `<a href="#${escapeAttribute(item.id)}" class="toc-link ${item.level === "h3" ? "is-nested" : ""}" data-section-id="${escapeAttribute(item.id)}"><span aria-hidden="true"></span>${escapeHtml(item.text)}</a>`
    )
    .join("");
  tocList.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById(link.dataset.sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
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
  state.toc.forEach((item, index) => {
    const heading = document.getElementById(item.id);
    if (heading && heading.getBoundingClientRect().top <= 150) activeIndex = index;
  });
  document.querySelectorAll(".toc-link").forEach((link, index) => link.classList.toggle("is-active", index === activeIndex));
}


function configureAnnotationStore() {
  store = state.auth.token
    ? createRemoteAnnotationStore({ endpoint: NOTES_ENDPOINT, getToken: () => state.auth.token })
    : localAnnotationStore;
}

async function loadAuthToken() {
  if (globalThis.chrome?.storage?.local) {
    const result = await chrome.storage.local.get("openread:authToken");
    return result["openread:authToken"] || "";
  }
  return localStorage.getItem("openread:authToken") || "";
}

async function saveAuthToken(token) {
  if (globalThis.chrome?.storage?.local) {
    if (token) await chrome.storage.local.set({ "openread:authToken": token });
    else await chrome.storage.local.remove("openread:authToken");
    return;
  }
  if (token) localStorage.setItem("openread:authToken", token);
  else localStorage.removeItem("openread:authToken");
}

async function refreshCurrentUser() {
  if (!state.auth.token) {
    state.auth.user = null;
    return;
  }
  try {
    const payload = await apiRequest("/api/me", { token: state.auth.token });
    state.auth.user = payload.user;
  } catch {
    state.auth.token = "";
    state.auth.user = null;
    await saveAuthToken("");
  }
}

function openAuthPopover() {
  closeSearchPopover();
  closeFilterPopover();
  closeTypographyPopover();
  closeCommentPopover();
  renderAuthPopover();
  document.querySelector("#auth-popover")?.classList.toggle("is-visible");
}

function closeAuthPopover() {
  document.querySelector("#auth-popover")?.classList.remove("is-visible");
}

function renderAuthPopover(message = "") {
  const popover = document.querySelector("#auth-popover");
  if (!popover) return;
  if (state.auth.user) {
    popover.innerHTML = `
      <section class="auth-panel">
        <strong>${escapeHtml(state.auth.user.name || state.auth.user.email)}</strong>
        <span>${escapeHtml(state.auth.user.email)}</span>
        <button id="auth-logout" class="auth-submit" type="button">Log out</button>
      </section>
    `;
    popover.querySelector("#auth-logout").addEventListener("click", handleLogout);
    return;
  }

  const isRegister = state.auth.mode === "register";
  popover.innerHTML = `
    <form class="auth-panel" id="auth-form">
      <strong>${isRegister ? "Create account" : "Log in"}</strong>
      ${message ? `<p class="auth-message">${escapeHtml(message)}</p>` : ""}
      ${isRegister ? `<label><span>Name</span><input name="name" autocomplete="name" /></label>` : ""}
      <label><span>Email</span><input name="email" type="email" autocomplete="email" required /></label>
      <label><span>Password</span><input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="8" required /></label>
      <button class="auth-submit" type="submit">${isRegister ? "Create account" : "Log in"}</button>
      <button class="auth-link" type="button" id="auth-mode-toggle">${isRegister ? "Use existing account" : "Create account"}</button>
    </form>
  `;
  popover.querySelector("#auth-form").addEventListener("submit", handleAuthSubmit);
  popover.querySelector("#auth-mode-toggle").addEventListener("click", () => {
    state.auth.mode = isRegister ? "login" : "register";
    renderAuthPopover();
  });
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const path = state.auth.mode === "register" ? "/api/auth/register" : "/api/auth/login";
  try {
    const payload = await apiRequest(path, {
      method: "POST",
      body: {
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password")
      }
    });
    state.auth.token = payload.token;
    state.auth.user = payload.user;
    await saveAuthToken(payload.token);
    configureAnnotationStore();
    state.annotations = state.article ? await store.load(state.article.id) : [];
    renderAuthPopover();
    closeAuthPopover();
    renderArticleAndMargin();
    showReaderToast("Signed in. Notes are syncing.");
  } catch (error) {
    renderAuthPopover(error.message);
  }
}

async function handleLogout() {
  try {
    await apiRequest("/api/auth/logout", { method: "POST", token: state.auth.token });
  } catch {
    // Local logout should still clear a stale token.
  }
  state.auth.token = "";
  state.auth.user = null;
  await saveAuthToken("");
  configureAnnotationStore();
  state.annotations = state.article ? await store.load(state.article.id) : [];
  renderAuthPopover();
  closeAuthPopover();
  renderArticleAndMargin();
  showReaderToast("Signed out. Notes are local.");
}

async function apiRequest(path, options = {}) {
  const endpoint = resolveBackendEndpoint(path);
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(endpoint, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}`);
  return payload;
}

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
    workspace.classList.toggle("theme-night", state.theme === "night");
    workspace.classList.toggle("theme-paper", state.theme !== "night");
    workspace.classList.toggle("is-focus-mode", state.focusMode);
  }
  if (article) {
    article.style.setProperty("--article-size", `${state.typography.size}px`);
    article.style.setProperty("--article-line", String(state.typography.lineHeight));
    article.style.setProperty("--article-width", `${state.typography.width}px`);
  }
  updateTypographyLabels();
  document.querySelector("#theme-toggle")?.setAttribute("aria-pressed", String(state.theme === "night"));
  document.querySelector("#focus-toggle")?.setAttribute("aria-pressed", String(state.focusMode));
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
  state.theme = state.theme === "night" ? "paper" : "night";
  applyReaderPreferences();
}

function toggleFocusMode() {
  state.focusMode = !state.focusMode;
  applyReaderPreferences();
  updateReadingProgress();
}

function toggleListenMode() {
  const articleText = document.querySelector("#article")?.textContent?.trim();
  if (!articleText || !window.speechSynthesis) {
    showReaderToast("Listen is unavailable in this browser");
    return;
  }
  if (state.listening) {
    window.speechSynthesis.cancel();
    state.listening = false;
  } else {
    const utterance = new SpeechSynthesisUtterance(articleText.slice(0, 12000));
    utterance.rate = 0.94;
    utterance.onend = () => {
      state.listening = false;
      document.querySelector("#listen-toggle")?.classList.remove("is-active");
      document.querySelector("#listen-toggle")?.setAttribute("aria-pressed", "false");
    };
    window.speechSynthesis.speak(utterance);
    state.listening = true;
  }
  document.querySelector("#listen-toggle")?.classList.toggle("is-active", state.listening);
  document.querySelector("#listen-toggle")?.setAttribute("aria-pressed", String(state.listening));
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

function estimateReadingMinutes() {
  const words = (state.article?.text || state.article?.html || "").replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}


function safeCreateAnchorFromSelection(articleRoot, selection) {
  try {
    return createAnchorFromSelection(articleRoot, selection);
  } catch (error) {
    console.warn("OpenRead selection anchor failed", error);
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
  return resolveBackendEndpoint(import.meta.env.VITE_OPENREAD_ASSIST_ENDPOINT || "/api/assist");
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
  popover.querySelector("[data-action='copy-result']")?.addEventListener("click", () => copyText(content, "Result copied"));
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
      ${content && !options.loading && !options.error ? assistResultActionsTemplate() : ""}
    </div>
  `;
}
function explainAssistTemplate(content, options = {}) {
  return `
    <div class="assist-body">
      ${assistResultTemplate(content, { ...options, mode: "explain", loading: options.loading || !content })}
      ${content && !options.loading && !options.error ? assistResultActionsTemplate() : ""}
    </div>
  `;
}

function assistResultTemplate(content, options = {}) {
  const mode = options.mode || state.assist.mode;
  const direction = assistResultDirection(mode);
  if (options.loading) return assistSkeletonTemplate(mode, direction);
  if (!content) return "";
  return `<div class="assist-result ${options.error ? "is-error" : ""}" dir="${direction}">${escapeHtml(content)}</div>`;
}

function assistSkeletonTemplate(mode, direction = "ltr") {
  const widths = mode === "translate" ? ["72%", "91%", "44%"] : ["88%", "96%", "82%", "93%", "74%", "52%"];
  return `
    <div class="assist-result assist-skeleton" dir="${direction}" role="status" aria-live="polite" aria-label="${mode === "translate" ? "Translating" : "Explaining"}">
      ${widths.map((width) => `<span style="--skeleton-width:${width}"></span>`).join("")}
    </div>
  `;
}

function assistResultActionsTemplate() {
  return `
    <div class="assist-actions">
      <button type="button" data-action="copy-result">${copyIcon()}<span>Copy result</span></button>
    </div>
  `;
}

async function requestAssist(mode) {
  const requestId = ++state.assist.requestId;
  try {
    renderAssistPopover(mode === "translate" ? "Translating..." : "Explaining...", { loading: true });
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
    renderAssistPopover(payload.text || "");
  } catch (error) {
    if (requestId !== state.assist.requestId) return;
    renderAssistPopover(error.message || "Assist request failed", { error: true });
    showReaderToast(error.message || "Assist request failed");
  }
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
    const hasLongCodeShape = text.length > 48 && /[{};=<>]|\b(function|const|let|var|class|import|return|SELECT|FROM)\b/.test(text);
    const hasTerminalShape = isTerminalSnippet(text);
    if ((hasLongCodeShape || hasTerminalShape) && text.split(/\s+/).length < 96) codeCandidates.push(paragraph);
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

function isTerminalSnippet(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 8) return false;
  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const joined = lines.join(" ");
  const flagCount = (joined.match(/(?:^|\s)-{1,2}[a-z][\w-]*(?:[=\s][^\s\\]+)?/gi) || []).length;
  const hasPrompt = lines.some((line) => /^(?:[$#>]\s+|\w+@[-\w.]+:[^$#>]+[$#]\s+)/.test(line));
  const hasContinuation = lines.length > 1 && lines.slice(0, -1).some((line) => /\\$/.test(line));
  const startsWithCommand = /^\s*(?:[\w./-]+(?:\.exe)?)(?:\s|$)/.test(trimmed) && flagCount >= 2;
  const startsWithFlags = /^\s*-{1,2}[a-z][\w-]*(?:\s|=)/i.test(trimmed) && flagCount >= 2;
  const hasShellOperators = /\s(?:&&|\|\||\||2>|>)\s/.test(joined);
  const hasEnvAssignment = /(?:^|\s)[A-Z_][A-Z0-9_]*=[^\s]+\s+\w/.test(joined);
  return hasPrompt || hasContinuation || startsWithCommand || startsWithFlags || (flagCount >= 3 && (hasShellOperators || hasEnvAssignment));
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
      ${HIGHLIGHT_COLORS.slice(0, 4)
        .map(
          (color) =>
            `<button class="swatch" type="button" title="${color.label}" data-color="${color.id}" style="--swatch-color:${color.value}"></button>`
        )
        .join("")}
      <span class="popover-divider" aria-hidden="true"></span>
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
    const popoverWidth = Math.min(520, window.innerWidth - 28);
    popover.style.left = `${clamp(rect.left + rect.width / 2 - popoverWidth / 2, 14, window.innerWidth - popoverWidth - 14)}px`;
    popover.style.top = `${Math.max(72, rect.top - 58)}px`;
    popover.style.width = `${popoverWidth}px`;
    popover.classList.add("is-visible");
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
  if (!event.target.closest?.(".auth-popover, #account-toggle")) closeAuthPopover();
  if (event.target.closest?.(".assist-popover, .comment-popover, .comment-marker, .highlight, .popover, .review-modal")) return;
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
  history.pushState({ openreadOverlay: name }, "", window.location.href);
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
  document.title = (state.article.title || "OpenRead") + " - annotated";
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
      toggleListenMode();
      return;
    }
    if (key === "b") {
      event.preventDefault();
      showReaderToast("Article saved to OpenRead");
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
      <div class="brand-block"><span class="brand-mark">${bookIcon()}</span><span class="brand-name">OpenRead</span></div>
      <h1>OpenRead could not open this article</h1>
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

function slugify(text) {
  return (text || "openread")
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

function bookmarkIcon() {
  return svg('<path d="M6 4h12v17l-6-3.5L6 21V4Z"/>', { size: 20 });
}

function headphonesIcon() {
  return svg('<path d="M4 14a8 8 0 0 1 16 0"/><path d="M4 14v4a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2"/><path d="M20 14v4a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2"/>', { size: 18 });
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


function userIcon() {
  return svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', { size: 18 });
}

function xIcon() {
  return svg('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>', { size: 16, stroke: 2 });
}
