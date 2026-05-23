import "./styles.css";
import {
  HIGHLIGHT_COLORS,
  createAnnotation,
  deleteAnnotation,
  filterAnnotations,
  updateAnnotation,
  upsertAnnotation
} from "../core/annotations.js";
import { generateMarkdownExport } from "../core/exportMarkdown.js";
import { createAnchorFromSelection, resolveAnchor } from "../core/textAnchor.js";
import { createAnnotationStore, createChromeStorageAdapter } from "../core/localPersistence.js";
import { renderHighlights, sanitizeArticleHtml } from "./dom.js";

const colorMap = new Map(HIGHLIGHT_COLORS.map((color) => [color.id, color.value]));
const colorLabelMap = new Map(HIGHLIGHT_COLORS.map((color) => [color.id, color.label]));
const state = {
  article: null,
  annotations: [],
  filters: { color: "all", type: "all" },
  searchQuery: "",
  activeId: null,
  commentOpenId: null,
  selectionAnchor: null
};

const store = createAnnotationStore(createChromeStorageAdapter());
const app = document.querySelector("#app");

boot().catch((error) => {
  renderError(error.message);
});

async function boot() {
  state.article = await loadArticleFromSession();
  if (state.article.error) throw new Error(state.article.error);
  state.annotations = await store.load(state.article.id);
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
  app.innerHTML = `
    <main class="workspace">
      <header class="appbar">
        <div class="brand-block">
          <span class="brand-mark" aria-hidden="true">${bookIcon()}</span>
          <span class="brand-name">OpenRead</span>
        </div>
        <div class="title-block">
          <h1>${escapeHtml(state.article.title)}</h1>
          <span class="saved-dot" aria-hidden="true"></span>
          <span class="saved-label">Saved</span>
        </div>
        <div class="top-actions">
          <a class="source-button" href="${escapeAttribute(state.article.pageUrl || state.article.url)}" target="_blank" rel="noreferrer">
            Source page ${externalIcon()}
          </a>
          <label class="search-box">
            ${searchIcon()}
            <input id="article-search" type="search" placeholder="Search in article..." autocomplete="off" />
            <kbd>Enter</kbd>
          </label>
          <select id="color-filter" aria-label="Filter by color">
            <option value="all">All colors</option>
            ${HIGHLIGHT_COLORS.map((color) => `<option value="${color.id}">${color.label}</option>`).join("")}
          </select>
          <select id="type-filter" aria-label="Filter by type">
            <option value="all">All types</option>
            <option value="notes">Notes</option>
            <option value="highlights">Highlights</option>
          </select>
          <button id="export-md" class="export-button" type="button">${downloadIcon()} Export Markdown</button>
        </div>
      </header>

      <aside class="left-rail" aria-label="Workspace tools">
        <button class="rail-button" type="button" title="Menu">${menuIcon()}</button>
        <button class="rail-button is-active" type="button" title="Reader">${documentIcon()}</button>
        <button class="rail-button" type="button" title="Recent notes">${clockIcon()}</button>
        <div class="rail-spacer"></div>
        <div class="avatar" aria-hidden="true">OR</div>
        <button class="rail-button" type="button" title="Settings">${settingsIcon()}</button>
      </aside>

      <div class="study-layout">
        <section class="paper-shell">
          <article id="article" class="article"></article>
        </section>
        <aside class="notes-panel" aria-label="Annotation notes">
          <div class="notes-header">
            <strong id="notes-count">0 notes</strong>
            <div class="notes-header-actions">
              <button id="clear-filters" type="button">Clear filters</button>
              <button class="icon-button" type="button" title="Note filters">${slidersIcon()}</button>
            </div>
          </div>
          <div id="margin" class="margin"></div>
          <div class="new-note-bar">
            <button id="new-note" type="button">${plusIcon()} New note <kbd>N</kbd></button>
          </div>
        </aside>
      </div>
      <div id="selection-popover" class="popover" role="toolbar" aria-label="Selection actions"></div>
      <div id="comment-popover" class="comment-popover" aria-live="polite"></div>
    </main>
  `;

  document.querySelector("#color-filter").value = state.filters.color;
  document.querySelector("#type-filter").value = state.filters.type;
  document.querySelector("#article-search").value = state.searchQuery;

  document.querySelector("#color-filter").addEventListener("change", (event) => {
    state.filters.color = event.target.value;
    renderArticleAndMargin();
  });
  document.querySelector("#type-filter").addEventListener("change", (event) => {
    state.filters.type = event.target.value;
    renderArticleAndMargin();
  });
  document.querySelector("#article-search").addEventListener("input", (event) => {
    state.searchQuery = event.target.value;
    renderArticleAndMargin();
    event.target.focus();
  });
  document.querySelector("#article-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.value.trim()) {
      window.find?.(event.target.value.trim(), false, false, true);
    }
  });
  document.querySelector("#clear-filters").addEventListener("click", () => {
    state.filters = { color: "all", type: "all" };
    state.searchQuery = "";
    renderWorkspace();
  });
  document.querySelector("#new-note").addEventListener("click", () => {
    document.querySelector("#article")?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  document.addEventListener("keydown", focusSearchShortcut);
  document.querySelector("#export-md").addEventListener("click", exportMarkdown);
  document.querySelector("#selection-popover").addEventListener("mousedown", (event) => event.preventDefault());
  document.addEventListener("mousedown", closeFloatingCommentOnOutsideClick);

  renderArticleAndMargin();
  bindSelectionPopover();
}

function renderArticleAndMargin() {
  const articleRoot = document.querySelector("#article");
  articleRoot.innerHTML = sanitizeArticleHtml(state.article.html);
  const articleText = articleRoot.textContent || "";
  const visible = filterAnnotations(state.annotations, state.filters)
    .filter(matchesSearch)
    .map((annotation) => ({
      ...annotation,
      resolved: resolveAnchor(articleText, annotation.anchor),
      colorValue: colorMap.get(annotation.color) || colorMap.get("yellow")
    }))
    .filter((annotation) => annotation.resolved);

  renderHighlights(articleRoot, visible, activateAnnotation);
  renderMargin(visible.filter((annotation) => annotation.type === "note"));
  markActive();
}

function renderMargin(notes) {
  const margin = document.querySelector("#margin");
  document.querySelector("#notes-count").textContent = `${notes.length} ${notes.length === 1 ? "note" : "notes"}`;

  if (notes.length === 0) {
    margin.innerHTML = `<p class="empty">Select text in the article and choose Add note. Notes will stack here without covering the page.</p>`;
    return;
  }

  margin.innerHTML = notes
    .map((annotation) => noteCardTemplate(annotation))
    .join("");

  for (const card of margin.querySelectorAll(".note-card")) {
    const id = card.dataset.noteId;
    card.addEventListener("click", () => activateAnnotation(id));
    card.querySelector('[data-action="jump"]').addEventListener("click", (event) => {
      event.stopPropagation();
      scrollToHighlight(id);
    });
    card.querySelector('[data-action="copy"]').addEventListener("click", async (event) => {
      event.stopPropagation();
      await copyAnnotation(id);
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", async (event) => {
      event.stopPropagation();
      await removeAnnotation(id);
    });

    const textarea = card.querySelector("textarea");
    textarea.addEventListener("click", (event) => event.stopPropagation());
    textarea.addEventListener("blur", async () => {
      await saveAnnotations(updateAnnotation(state.annotations, id, { note: textarea.value }));
      renderArticleAndMargin();
    });
    textarea.addEventListener("keydown", async (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        textarea.blur();
      }
      if (event.key === "Escape" && textarea.value.trim() === "") {
        event.preventDefault();
        await removeAnnotation(id);
      }
    });
  }
}

function noteCardTemplate(annotation) {
  const color = annotation.color || "yellow";
  const colorValue = colorMap.get(color) || colorMap.get("yellow");
  return `
    <section class="note-card" data-note-id="${annotation.id}" style="--note-color: ${colorValue}; --note-wash: ${noteWash(color)}" tabindex="0">
      <div class="connector-dot" aria-hidden="true"></div>
      <div class="note-card-header">
        <span class="note-color"><span aria-hidden="true"></span>${escapeHtml(colorLabelMap.get(color) || color)}</span>
        <time>${relativeTime(annotation.updatedAt || annotation.createdAt)}</time>
      </div>
      <blockquote class="quote">${escapeHtml(shortQuote(annotation.anchor.exact))}</blockquote>
      <textarea class="note-editor" data-action="edit" placeholder="Write a note...">${escapeHtml(annotation.note.trim())}</textarea>
      ${annotation.handwriting ? `<img class="ink-preview" src="${escapeAttribute(annotation.handwriting)}" alt="Handwritten note preview" />` : ""}
      <div class="note-actions">
        <button type="button" data-action="jump" title="Jump to highlight">${pencilIcon()}</button>
        <button type="button" data-action="copy" title="Copy note">${copyIcon()}</button>
        <button type="button" data-action="delete" title="Delete note">${trashIcon()}</button>
      </div>
    </section>
  `;
}

function bindSelectionPopover() {
  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    const articleRoot = document.querySelector("#article");
    const anchor = createAnchorFromSelection(articleRoot, selection);
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
            `<button class="swatch" type="button" title="${color.label}" data-color="${color.id}" style="background:${color.value}"></button>`
        )
        .join("")}
      <span class="popover-divider" aria-hidden="true"></span>
      <button class="note-action" type="button" data-note="true">${noteIcon()} Add note</button>
    `;

    for (const button of popover.querySelectorAll("[data-color]")) {
      button.addEventListener("click", () => addAnnotation(button.dataset.color, false));
    }
    popover.querySelector("[data-note]").addEventListener("click", () => addAnnotation("yellow", true));

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    popover.style.left = `${Math.max(16, rect.left + rect.width / 2 - 165)}px`;
    popover.style.top = `${Math.max(72, rect.top - 58)}px`;
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
  document.querySelectorAll(".highlight, .note-card").forEach((element) => element.classList.remove("is-focused"));
  if (!state.activeId) return;
  document.querySelectorAll(`[data-annotation-id="${state.activeId}"]`).forEach((element) => {
    element.classList.add("is-focused");
  });
  document.querySelector(`[data-note-id="${state.activeId}"]`)?.classList.add("is-focused");
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
  document.querySelector(`[data-note-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
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
      <blockquote class="quote">${escapeHtml(shortQuote(annotation.anchor.exact))}</blockquote>
      <textarea class="note-editor floating-editor" data-action="edit" placeholder="Write a comment...">${escapeHtml(annotation.note.trim())}</textarea>
      <div class="handwriting-block">
        <div class="handwriting-header">
          <strong>Handwriting</strong>
          <button type="button" data-action="clear-ink">Clear ink</button>
        </div>
        <canvas class="ink-canvas" width="620" height="220" aria-label="Handwriting canvas"></canvas>
      </div>
      <div class="note-actions pdf-actions">
        <button type="button" data-action="jump" title="Jump to highlight">${pencilIcon()}</button>
        <button type="button" data-action="copy" title="Copy comment">${copyIcon()}</button>
        <button type="button" data-action="delete" title="Delete comment">${trashIcon()}</button>
      </div>
    </section>
  `;

  const rect = target?.getBoundingClientRect?.() || { left: window.innerWidth / 2, top: 140, width: 0, bottom: 160 };
  const left = Math.min(window.innerWidth - 390, Math.max(96, rect.left + rect.width + 16));
  const top = Math.min(window.innerHeight - 460, Math.max(88, rect.bottom + 8));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.classList.add("is-visible");

  popover.querySelector('[data-action="close"]').addEventListener("click", closeCommentPopover);
  popover.querySelector('[data-action="jump"]').addEventListener("click", () => scrollToHighlight(annotation.id));
  popover.querySelector('[data-action="copy"]').addEventListener("click", () => copyAnnotation(annotation.id));
  popover.querySelector('[data-action="delete"]').addEventListener("click", () => removeAnnotation(annotation.id));
  popover.querySelector('[data-action="clear-ink"]').addEventListener("click", () => clearHandwriting(annotation.id));

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

  bindHandwritingCanvas(popover.querySelector("canvas"), annotation);
  textarea.focus();
}

function bindHandwritingCanvas(canvas, annotation) {
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const displayWidth = canvas.clientWidth || 310;
  const displayHeight = canvas.clientHeight || 160;
  canvas.width = Math.round(displayWidth * ratio);
  canvas.height = Math.round(displayHeight * ratio);
  context.scale(ratio, ratio);
  context.lineWidth = 2.2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#1f1f1f";

  if (annotation.handwriting) {
    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0, displayWidth, displayHeight);
    image.src = annotation.handwriting;
  }

  let drawing = false;
  let moved = false;
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    moved = false;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
    moved = true;
  });
  canvas.addEventListener("pointerup", async () => {
    if (!drawing) return;
    drawing = false;
    if (moved) await saveHandwriting(annotation.id, canvas.toDataURL("image/png"));
  });
  canvas.addEventListener("pointercancel", () => {
    drawing = false;
  });
}

async function saveHandwriting(id, dataUrl) {
  await saveAnnotations(updateAnnotation(state.annotations, id, { handwriting: dataUrl, type: "note" }));
  renderArticleAndMargin();
}

async function clearHandwriting(id) {
  await saveAnnotations(updateAnnotation(state.annotations, id, { handwriting: "", type: "note" }));
  renderArticleAndMargin();
  const annotation = state.annotations.find((item) => item.id === id);
  if (annotation) renderCommentPopover(annotation, document.querySelector(`[data-annotation-id="${id}"]`));
}

function closeCommentPopover() {
  const popover = document.querySelector("#comment-popover");
  popover?.classList.remove("is-visible");
  state.commentOpenId = null;
}

function closeFloatingCommentOnOutsideClick(event) {
  if (event.target.closest?.(".comment-popover, .comment-marker, .highlight, .popover")) return;
  closeCommentPopover();
}

function findSameAnchor(annotations, anchor) {
  return annotations.find(
    (annotation) =>
      annotation.anchor?.exact === anchor.exact &&
      annotation.anchor?.startOffset === anchor.startOffset &&
      annotation.anchor?.endOffset === anchor.endOffset
  );
}

function exportMarkdown() {
  const markdown = generateMarkdownExport(state.article, state.annotations);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(state.article.title)}-annotations.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function focusSearchShortcut(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#article-search")?.focus();
  }
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

function relativeTime(value) {
  if (!value) return "Just now";
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 60_000) return "Just now";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
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

function menuIcon() {
  return svg('<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/>', { size: 19 });
}

function documentIcon() {
  return svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/>', { size: 19 });
}

function clockIcon() {
  return svg('<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>', { size: 19 });
}

function settingsIcon() {
  return svg('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z"/>', { size: 19, stroke: 1.5 });
}

function slidersIcon() {
  return svg('<path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/>', { size: 18 });
}

function plusIcon() {
  return svg('<path d="M12 5v14"/><path d="M5 12h14"/>', { size: 17, stroke: 2 });
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
