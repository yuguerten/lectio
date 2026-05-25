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
import { createAnnotationStore, createChromeStorageAdapter, createDrawingStore } from "../core/localPersistence.js";
import { renderHighlights, sanitizeArticleHtml } from "./dom.js";

const colorMap = new Map(HIGHLIGHT_COLORS.map((color) => [color.id, color.value]));
const colorLabelMap = new Map(HIGHLIGHT_COLORS.map((color) => [color.id, color.label]));
const DRAWING_COLORS = ["#171717", "#e03131", "#1971c2", "#2f9e44", "#f08c00"];
const state = {
  article: null,
  annotations: [],
  drawings: [],
  filters: { color: "all", type: "all" },
  searchQuery: "",
  activeId: null,
  commentOpenId: null,
  selectionAnchor: null,
  drawing: {
    enabled: false,
    tool: "pen",
    color: DRAWING_COLORS[0],
    size: 4,
    activeStroke: null,
    redoStack: []
  }
};

const storageAdapter = createChromeStorageAdapter();
const store = createAnnotationStore(storageAdapter);
const drawingStore = createDrawingStore(storageAdapter);
const app = document.querySelector("#app");

boot().catch((error) => {
  renderError(error.message);
});

async function boot() {
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
          <button id="review-open" class="review-button" type="button" title="Review annotations">${listIcon()} Review</button>
          <button id="draw-toggle" class="draw-toggle" type="button" aria-pressed="false" title="Draw on page">${drawIcon()} Draw</button>
          <button id="export-md" class="export-button" type="button">${downloadIcon()} Export Markdown</button>
        </div>
      </header>

      <div class="study-layout">
        <section class="paper-shell">
          <article id="article" class="article"></article>
          <canvas id="drawing-canvas" class="drawing-canvas" aria-label="Drawing layer"></canvas>
        </section>
      </div>
      <div id="drawing-tools" class="drawing-tools" aria-label="Drawing tools">
        <button class="icon-tool is-active" type="button" data-tool="pen" title="Pen">${penIcon()}</button>
        <button class="icon-tool" type="button" data-tool="line" title="Line">${lineIcon()}</button>
        <button class="icon-tool" type="button" data-tool="arrow" title="Arrow">${arrowIcon()}</button>
        <button class="icon-tool" type="button" data-tool="rect" title="Rectangle">${rectangleIcon()}</button>
        <button class="icon-tool" type="button" data-tool="ellipse" title="Ellipse">${ellipseIcon()}</button>
        <button class="icon-tool" type="button" data-tool="eraser" title="Eraser">${eraserIcon()}</button>
        <div class="drawing-swatches" aria-label="Drawing color">
          ${DRAWING_COLORS.map((color) => `<button class="drawing-swatch" type="button" data-color="${color}" title="${color}" style="background:${color}"></button>`).join("")}
        </div>
        <label class="size-control" title="Brush size">
          ${brushIcon()}
          <input id="draw-size" type="range" min="2" max="18" value="4" />
        </label>
        <button id="draw-undo" class="icon-tool" type="button" title="Undo">${undoIcon()}</button>
        <button id="draw-redo" class="icon-tool" type="button" title="Redo">${redoIcon()}</button>
        <button id="draw-clear" class="icon-tool" type="button" title="Clear drawing">${trashIcon()}</button>
      </div>
      <div id="review-modal" class="review-modal" aria-live="polite"></div>
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
  document.addEventListener("keydown", handleGlobalKeydown);
  document.querySelector("#export-md").addEventListener("click", exportMarkdown);
  document.querySelector("#review-open").addEventListener("click", openReviewModal);
  document.querySelector("#selection-popover").addEventListener("mousedown", (event) => event.preventDefault());
  document.addEventListener("mousedown", closeFloatingCommentOnOutsideClick);

  renderArticleAndMargin();
  bindSelectionPopover();
  bindDrawingControls();
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
  markActive();
  for (const image of articleRoot.querySelectorAll("img")) {
    image.addEventListener("load", resizeDrawingCanvas, { once: true });
  }
  requestAnimationFrame(resizeDrawingCanvas);
}

function bindSelectionPopover() {
  document.addEventListener("selectionchange", () => {
    if (state.drawing.enabled) return;
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
      <blockquote class="quote">${escapeHtml(shortQuote(annotation.anchor.exact))}</blockquote>
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
  if (event.target.closest?.(".comment-popover, .comment-marker, .highlight, .popover, .review-modal")) return;
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

function startDrawing(event) {
  if (!state.drawing.enabled) return;
  event.preventDefault();
  const canvas = event.currentTarget;
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

function exportMarkdown() {
  const drawingImage = createDrawingExportImage();
  const markdown = generateMarkdownExport(state.article, state.annotations, { drawingImage, drawings: state.drawings });
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(state.article.title)}-annotations.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function handleGlobalKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#article-search")?.focus();
    return;
  }
  if (event.key.toLowerCase() === "d" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target)) {
    event.preventDefault();
    setDrawingEnabled(!state.drawing.enabled);
    return;
  }
  if (event.key === "Escape") {
    if (document.querySelector("#review-modal")?.classList.contains("is-visible")) {
      event.preventDefault();
      closeReviewModal();
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

function createDrawingExportImage() {
  if (state.drawings.length === 0) return "";
  const source = document.querySelector("#drawing-canvas");
  if (!source) return "";
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = source.width;
  exportCanvas.height = source.height;
  const context = exportCanvas.getContext("2d");
  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  context.drawImage(source, 0, 0);
  return exportCanvas.toDataURL("image/png");
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
