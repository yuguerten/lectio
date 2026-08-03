import "../shared/palette.css";
import "./styles.css";
import { buildInterestGraph, filterLibraryEntries, getLibraryFolders, getLibraryStats, getLibraryTopics } from "../core/library.js";
import { createInterestLayout } from "../core/interestGraphLayout.js";
import { createBookmarkStore, createChromeStorageAdapter } from "../core/localPersistence.js";

const VIEW_LABELS = {
  all: "All articles",
  recent: "Recently read",
  unread: "Unread",
  completed: "Completed",
  archived: "Archived"
};

const app = document.querySelector("#app");
const store = createBookmarkStore(createChromeStorageAdapter());
let activeInterestMap = null;
const state = {
  entries: [],
  query: "",
  view: "all",
  folder: "",
  topic: "",
  layout: "list",
  mapSelectionId: "",
  pendingDeleteId: ""
};

boot().catch((error) => renderFatalError(error.message));

async function boot() {
  state.entries = await store.list();
  renderShell();
  bindShell();
  renderLibrary();
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes["lectio:bookmarks"]) refreshEntries();
  });
}

function renderShell() {
  app.innerHTML = `
    <div class="library-shell">
      <header class="library-bar">
        <a class="library-brand" href="library.html" aria-label="Lectio reading library">
          <span class="brand-mark" aria-hidden="true">${bookIcon()}</span>
          <span>Lectio</span>
        </a>
        <span class="bar-location">Reading library</span>
        <span class="bar-storage-status">Saved locally</span>
      </header>

      <main class="library-main">
        <div class="library-workspace">
          <aside class="library-rail" aria-label="Library filters">
            <label class="library-search">
              <span aria-hidden="true">${searchIcon()}</span>
              <span class="sr-only">Search saved articles</span>
              <input id="library-search" type="search" placeholder="Search library" autocomplete="off" />
              <kbd>/</kbd>
            </label>
            <nav id="library-views" class="library-views" aria-label="Reading state"></nav>
            <section class="topic-section" aria-labelledby="topic-heading">
              <h2 id="topic-heading">Topics</h2>
              <div id="library-topics" class="topic-list"></div>
            </section>
            <section class="folder-section" aria-labelledby="folder-heading">
              <h2 id="folder-heading">Folders</h2>
              <div id="library-folders" class="folder-list"></div>
            </section>
          </aside>

          <section class="library-catalog" aria-labelledby="catalog-title">
            <header class="library-intro">
              <p class="library-kicker">Saved locally</p>
              <h1>Reading library</h1>
              <p id="library-summary" class="library-summary"></p>
            </header>
            <header class="catalog-header">
              <div>
                <p id="catalog-index" class="catalog-index"></p>
                <h2 id="catalog-title">All articles</h2>
              </div>
              <div class="catalog-actions">
                <div id="library-layout" class="layout-switch" role="group" aria-label="Library layout">
                  <button type="button" data-layout="list" aria-pressed="true">${listIcon()}<span>List</span></button>
                  <button type="button" data-layout="map" aria-pressed="false">${graphIcon()}<span>Interest map</span></button>
                </div>
                <button id="clear-library-filters" class="quiet-button" type="button">Clear filters</button>
              </div>
            </header>
            <div id="library-list" class="library-list" aria-live="polite"></div>
          </section>
        </div>
      </main>
      <div id="library-toast" class="library-toast" role="status" aria-live="polite"></div>
    </div>
  `;
}

function bindShell() {
  const search = document.querySelector("#library-search");
  search.addEventListener("input", () => {
    state.query = search.value;
    renderCatalog();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      search.value = "";
      state.query = "";
      renderCatalog();
    }
  });
  document.querySelector("#library-views").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    state.view = button.dataset.view;
    renderLibrary();
  });
  document.querySelector("#library-folders").addEventListener("click", (event) => {
    const button = event.target.closest("[data-folder-filter]");
    if (!button) return;
    state.folder = button.dataset.folderFilter;
    renderLibrary();
  });
  document.querySelector("#library-topics").addEventListener("click", (event) => {
    const button = event.target.closest("[data-topic-filter]");
    if (!button) return;
    state.topic = button.dataset.topicFilter;
    renderLibrary();
  });
  document.querySelector("#clear-library-filters").addEventListener("click", () => {
    state.query = "";
    state.view = "all";
    state.folder = "";
    state.topic = "";
    search.value = "";
    renderLibrary();
  });
  document.querySelector("#library-layout").addEventListener("click", (event) => {
    const button = event.target.closest("[data-layout]");
    if (!button || button.dataset.layout === state.layout) return;
    state.layout = button.dataset.layout;
    state.mapSelectionId = "";
    renderCatalog();
  });
  document.querySelector("#library-list").addEventListener("click", handleCatalogClick);
  document.querySelector("#library-list").addEventListener("change", handleCatalogChange);
  document.querySelector("#library-list").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("[data-folder], [data-topics]")) event.target.blur();
    const mapNode = event.target.closest("[data-interest-node]");
    if (mapNode && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      selectInterestNode(mapNode.dataset.interestNode);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !isTypingTarget(event.target)) {
      event.preventDefault();
      search.focus();
    }
  });
}

function renderLibrary() {
  const stats = getLibraryStats(state.entries);
  document.querySelector("#library-summary").textContent = summaryText(stats);
  renderViews(stats);
  renderTopics();
  renderFolders();
  renderCatalog();
}

function renderTopics() {
  const topics = getLibraryTopics(state.entries);
  const root = document.querySelector("#library-topics");
  if (!topics.length) {
    root.innerHTML = `<p class="taxonomy-empty">Add topics such as Politics or Tech from an article’s Organize panel.</p>`;
    return;
  }
  const articleCount = state.entries.filter((entry) => !entry.archived && entry.tags?.length).length;
  root.innerHTML = `
    <button class="topic-row ${state.topic === "" ? "is-active" : ""}" type="button" data-topic-filter="">
      <span>All topics</span><b>${articleCount}</b>
    </button>
    ${topics.map((topic) => `
      <button class="topic-row ${state.topic === topic.label ? "is-active" : ""}" type="button" data-topic-filter="${escapeAttribute(topic.label)}">
        <span>${escapeHtml(topic.label)}</span><b>${topic.count}</b>
      </button>
    `).join("")}
  `;
}

function renderViews(stats) {
  document.querySelector("#library-views").innerHTML = Object.entries(VIEW_LABELS)
    .map(([id, label]) => `
      <button class="view-row ${state.view === id ? "is-active" : ""}" type="button" data-view="${id}" aria-pressed="${state.view === id}">
        <span>${label}</span><b>${stats[id]}</b>
      </button>
    `)
    .join("");
}

function renderFolders() {
  const folders = getLibraryFolders(state.entries.filter((entry) => !entry.archived));
  const root = document.querySelector("#library-folders");
  root.innerHTML = `
    <button class="folder-row ${state.folder === "" ? "is-active" : ""}" type="button" data-folder-filter="">
      <span>Every folder</span>
    </button>
    ${folders
      .map((folder) => `
        <button class="folder-row ${state.folder === folder ? "is-active" : ""}" type="button" data-folder-filter="${escapeAttribute(folder)}">
          <span>${escapeHtml(folder)}</span><b>${state.entries.filter((entry) => !entry.archived && entry.folder === folder).length}</b>
        </button>
      `)
      .join("")}
  `;
}

function renderCatalog() {
  const entries = visibleEntries();
  activeInterestMap = null;
  renderLayoutControls();
  document.querySelector("#clear-library-filters").hidden = !state.query && state.view === "all" && !state.folder && !state.topic;
  const list = document.querySelector("#library-list");
  if (!entries.length) {
    document.querySelector("#catalog-title").textContent = state.layout === "map" ? "Interest map" : state.topic ? `Topic: ${state.topic}` : state.folder || VIEW_LABELS[state.view];
    document.querySelector("#catalog-index").textContent = "00 entries";
    list.innerHTML = emptyLibraryTemplate();
    return;
  }
  if (state.layout === "map") {
    const graph = buildInterestGraph(entries);
    const layout = createInterestLayout(graph);
    document.querySelector("#catalog-title").textContent = "Interest map";
    document.querySelector("#catalog-index").textContent = `${String(graph.folders.length).padStart(2, "0")} folders · ${String(graph.topics.length).padStart(2, "0")} topics`;
    list.innerHTML = interestMapTemplate(graph, entries, layout);
    mountInterestMap(graph, entries, layout);
    return;
  }
  const title = state.topic ? `Topic: ${state.topic}` : state.folder || VIEW_LABELS[state.view];
  document.querySelector("#catalog-title").textContent = title;
  document.querySelector("#catalog-index").textContent = `${String(entries.length).padStart(2, "0")} ${entries.length === 1 ? "entry" : "entries"}`;
  const folders = getLibraryFolders(state.entries);
  list.innerHTML = `${entries.map(entryTemplate).join("")}<datalist id="folder-options">${folders.map((folder) => `<option value="${escapeAttribute(folder)}"></option>`).join("")}</datalist>`;
}

function renderLayoutControls() {
  document.querySelectorAll("[data-layout]").forEach((button) => {
    const active = button.dataset.layout === state.layout;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function interestMapTemplate(graph, entries, layout) {
  const selected = layout.nodes.find((node) => node.id === state.mapSelectionId) || overviewSelection(entries);
  return `
    <div class="interest-map">
      <section class="interest-map-stage" aria-label="Interactive folder and topic graph">
        <div class="interest-map-toolbar">
          <div class="interest-map-legend" aria-label="Map legend">
            <span><i class="is-folder"></i>Folders</span>
            <span><i class="is-topic"></i>Topics</span>
          </div>
          <div class="interest-map-controls" aria-label="Map controls">
            <button type="button" data-map-zoom="out" aria-label="Zoom out" title="Zoom out">${minusIcon()}</button>
            <button type="button" data-map-zoom="fit" aria-label="Fit graph" title="Fit graph">${fitIcon()}</button>
            <button type="button" data-map-zoom="in" aria-label="Zoom in" title="Zoom in">${plusIcon()}</button>
          </div>
        </div>
        <svg class="interest-map-canvas" viewBox="0 0 760 600" role="img" aria-label="Folders connected to their saved article topics">
          <g class="interest-map-viewport">
            <g class="interest-map-edges" aria-hidden="true">
              ${layout.edges.map((edge, index) => {
                const source = layout.positions.get(edge.source);
                const target = layout.positions.get(edge.target);
                return `<path class="is-topic" data-edge-index="${index}" data-source="${escapeAttribute(edge.source)}" data-target="${escapeAttribute(edge.target)}" d="${edgePath(source, target, index)}" />`;
              }).join("")}
            </g>
            <g class="interest-map-nodes">
              ${layout.nodes.map((node) => {
                const point = layout.positions.get(node.id);
                return `
                  <g class="interest-node is-${node.type}"
                    transform="translate(${point.x} ${point.y})"
                    role="button"
                    tabindex="0"
                    data-interest-node="${escapeAttribute(node.id)}"
                    aria-label="${escapeAttribute(`${node.type} ${node.label}, ${node.count} ${node.count === 1 ? "article" : "articles"}`)}">
                    <circle r="${node.radius}" />
                    <text class="interest-node-count" text-anchor="middle" dominant-baseline="central">${node.count}</text>
                    <text class="interest-node-label" y="${node.radius + 17}" text-anchor="middle">${escapeHtml(shortText(node.label, node.type === "topic" ? 16 : 20))}</text>
                  </g>
                `;
              }).join("")}
            </g>
          </g>
        </svg>
        ${layout.omitted ? `<p class="interest-map-omitted">Showing ${layout.nodes.length} strongest nodes · ${layout.omitted} more remain available in the filters.</p>` : ""}
      </section>
      <aside id="interest-inspector" class="interest-inspector" aria-live="polite">${interestInspectorTemplate(selected, entries)}</aside>
    </div>
  `;
}

function interestInspectorTemplate(selected, entries) {
  const selectedIds = new Set(selected.articleIds);
  const selectedArticles = entries.filter((entry) => selectedIds.has(entry.id));
  const articleLimit = selected.type === "overview" ? 6 : 10;
  const selectedTopics = getLibraryTopics(selectedArticles).slice(0, 6);
  return `
    <p class="inspector-kind">${selected.type === "overview" ? "Library" : selected.type}</p>
    <h3>${escapeHtml(selected.label)}</h3>
    <p class="inspector-count">${selected.count} saved ${selected.count === 1 ? "article" : "articles"}</p>
    ${selectedTopics.length ? `
      <div class="inspector-topics" aria-label="Related topics">
        ${selectedTopics.map((topic) => `<span>${escapeHtml(topic.label)} <b>${topic.count}</b></span>`).join("")}
      </div>
    ` : ""}
    <ol class="interest-article-list">
      ${selectedArticles.slice(0, articleLimit).map((entry) => `
        <li data-entry-id="${escapeAttribute(entry.id)}">
          <button type="button" data-open="${escapeAttribute(entry.id)}">${escapeHtml(entry.title || "Untitled article")}</button>
          <p><span>${escapeHtml(entry.siteName || hostFor(entry.pageUrl || entry.url) || "Saved article")}</span><small>${statusLabelFor(entry.status)} · ${entry.progress}%</small></p>
        </li>
      `).join("")}
    </ol>
    ${selectedArticles.length > articleLimit ? `<p class="inspector-more">+${selectedArticles.length - articleLimit} more in this selection</p>` : ""}
  `;
}

function overviewSelection(entries) {
  return {
    id: "",
    type: "overview",
    label: "All articles",
    count: entries.length,
    articleIds: entries.map((entry) => entry.id)
  };
}

function mountInterestMap(graph, entries, layout) {
  const root = document.querySelector(".interest-map");
  const svg = root?.querySelector(".interest-map-canvas");
  const viewport = root?.querySelector(".interest-map-viewport");
  if (!root || !svg || !viewport) return;

  activeInterestMap = {
    graph,
    entries,
    layout,
    root,
    svg,
    viewport,
    transform: { x: 0, y: 0, scale: 1 },
    suppressClick: false
  };

  root.querySelectorAll("[data-interest-node]").forEach((node) => {
    node.addEventListener("pointerdown", beginInterestNodeDrag);
  });
  root.querySelectorAll("[data-map-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.mapZoom === "fit") resetInterestMapView();
      else zoomInterestMap(button.dataset.mapZoom === "in" ? 1.2 : 1 / 1.2);
    });
  });
  svg.addEventListener("wheel", handleInterestMapWheel, { passive: false });
  svg.addEventListener("pointerdown", beginInterestMapPan);
  selectInterestNode(layout.nodes.some((node) => node.id === state.mapSelectionId) ? state.mapSelectionId : "");
}

function selectInterestNode(nodeId) {
  const map = activeInterestMap;
  if (!map) return;
  const selected = map.layout.nodes.find((node) => node.id === nodeId) || overviewSelection(map.entries);
  state.mapSelectionId = selected.id;
  const inspector = map.root.querySelector("#interest-inspector");
  if (inspector) inspector.innerHTML = interestInspectorTemplate(selected, map.entries);

  const related = new Set([selected.id]);
  if (selected.id) {
    map.layout.edges
      .filter((edge) => edge.source === selected.id || edge.target === selected.id)
      .forEach((edge) => {
        related.add(edge.source);
        related.add(edge.target);
      });
  }

  map.root.querySelectorAll("[data-interest-node]").forEach((element) => {
    const id = element.dataset.interestNode;
    element.classList.toggle("is-selected", id === selected.id);
    element.classList.toggle("is-dimmed", Boolean(selected.id) && !related.has(id));
  });
  map.root.querySelectorAll("[data-source][data-target]").forEach((edge) => {
    const active = Boolean(selected.id) && (edge.dataset.source === selected.id || edge.dataset.target === selected.id);
    edge.classList.toggle("is-active", active);
  });
}

function beginInterestNodeDrag(event) {
  if (event.button !== 0 || !activeInterestMap) return;
  event.preventDefault();
  event.stopPropagation();
  const map = activeInterestMap;
  const nodeId = event.currentTarget.dataset.interestNode;
  const node = map.layout.nodes.find((item) => item.id === nodeId);
  const point = map.layout.positions.get(nodeId);
  if (!node || !point) return;
  const start = { x: event.clientX, y: event.clientY };
  let moved = false;
  event.currentTarget.classList.add("is-dragging");
  map.svg.setPointerCapture(event.pointerId);

  const move = (moveEvent) => {
    if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > 3) moved = true;
    const next = screenPointInElement(map.viewport, moveEvent);
    if (!next) return;
    point.x = Math.min(map.layout.width - node.radius - 20, Math.max(node.radius + 20, next.x));
    point.y = Math.min(map.layout.height - node.radius - 24, Math.max(node.radius + 20, next.y));
    updateInterestMapGeometry();
  };
  const end = () => {
    event.currentTarget.classList.remove("is-dragging");
    map.svg.removeEventListener("pointermove", move);
    map.svg.removeEventListener("pointerup", end);
    map.svg.removeEventListener("pointercancel", end);
    if (moved) {
      map.suppressClick = true;
      setTimeout(() => {
        if (activeInterestMap === map) map.suppressClick = false;
      }, 0);
    }
  };
  map.svg.addEventListener("pointermove", move);
  map.svg.addEventListener("pointerup", end);
  map.svg.addEventListener("pointercancel", end);
}

function beginInterestMapPan(event) {
  const map = activeInterestMap;
  if (!map || event.button !== 0 || event.target.closest("[data-interest-node]")) return;
  event.preventDefault();
  const start = { clientX: event.clientX, clientY: event.clientY, x: map.transform.x, y: map.transform.y };
  const bounds = map.svg.getBoundingClientRect();
  let moved = false;
  map.svg.classList.add("is-panning");
  map.svg.setPointerCapture(event.pointerId);

  const move = (moveEvent) => {
    const dx = (moveEvent.clientX - start.clientX) * (map.layout.width / Math.max(1, bounds.width));
    const dy = (moveEvent.clientY - start.clientY) * (map.layout.height / Math.max(1, bounds.height));
    if (Math.hypot(dx, dy) > 2) moved = true;
    map.transform.x = start.x + dx;
    map.transform.y = start.y + dy;
    applyInterestMapTransform();
  };
  const end = () => {
    map.svg.classList.remove("is-panning");
    map.svg.removeEventListener("pointermove", move);
    map.svg.removeEventListener("pointerup", end);
    map.svg.removeEventListener("pointercancel", end);
    if (!moved) selectInterestNode("");
  };
  map.svg.addEventListener("pointermove", move);
  map.svg.addEventListener("pointerup", end);
  map.svg.addEventListener("pointercancel", end);
}

function handleInterestMapWheel(event) {
  if (!activeInterestMap) return;
  event.preventDefault();
  const anchor = screenPointInElement(activeInterestMap.svg, event) || { x: 380, y: 300 };
  zoomInterestMap(event.deltaY < 0 ? 1.12 : 1 / 1.12, anchor);
}

function zoomInterestMap(factor, anchor = { x: 380, y: 300 }) {
  const map = activeInterestMap;
  if (!map) return;
  const previous = map.transform.scale;
  const next = Math.min(2.4, Math.max(0.65, previous * factor));
  map.transform.x = anchor.x - (anchor.x - map.transform.x) * (next / previous);
  map.transform.y = anchor.y - (anchor.y - map.transform.y) * (next / previous);
  map.transform.scale = next;
  applyInterestMapTransform();
}

function resetInterestMapView() {
  if (!activeInterestMap) return;
  activeInterestMap.transform = { x: 0, y: 0, scale: 1 };
  applyInterestMapTransform();
}

function applyInterestMapTransform() {
  const map = activeInterestMap;
  if (!map) return;
  const { x, y, scale } = map.transform;
  map.viewport.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
}

function updateInterestMapGeometry() {
  const map = activeInterestMap;
  if (!map) return;
  map.root.querySelectorAll("[data-interest-node]").forEach((element) => {
    const point = map.layout.positions.get(element.dataset.interestNode);
    if (point) element.setAttribute("transform", `translate(${point.x} ${point.y})`);
  });
  map.root.querySelectorAll("[data-edge-index]").forEach((element) => {
    const source = map.layout.positions.get(element.dataset.source);
    const target = map.layout.positions.get(element.dataset.target);
    if (source && target) element.setAttribute("d", edgePath(source, target, Number(element.dataset.edgeIndex)));
  });
}

function screenPointInElement(element, event) {
  const matrix = element?.getScreenCTM?.();
  const svg = element?.ownerSVGElement || element;
  if (!matrix || !svg?.createSVGPoint) return null;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(matrix.inverse());
}

function edgePath(source, target, index) {
  const midpointX = (source.x + target.x) / 2;
  const midpointY = (source.y + target.y) / 2;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const bend = ((index % 5) - 2) * 5;
  const controlX = midpointX - (dy / length) * bend;
  const controlY = midpointY + (dx / length) * bend;
  return `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`;
}

function entryTemplate(entry, index) {
  const source = entry.siteName || hostFor(entry.pageUrl || entry.url);
  const statusLabel = entry.status === "completed" ? "Completed" : entry.status === "reading" ? "Reading" : "Unread";
  const deletePending = state.pendingDeleteId === entry.id;
  return `
    <article class="library-entry" data-entry-id="${escapeAttribute(entry.id)}">
      <div class="entry-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</div>
      <div class="entry-body">
        <button class="entry-title" type="button" data-open="${escapeAttribute(entry.id)}">${escapeHtml(entry.title || "Untitled article")}</button>
        <p class="entry-provenance">
          <span>${escapeHtml(source || "Saved article")}</span>
          ${entry.byline ? `<span>${escapeHtml(entry.byline)}</span>` : ""}
          <time datetime="${escapeAttribute(entry.savedAt || "")}">${escapeHtml(dateLabel(entry.savedAt))}</time>
        </p>
        ${entry.excerpt ? `<p class="entry-excerpt">${escapeHtml(shortText(entry.excerpt, 190))}</p>` : ""}
        <div class="entry-taxonomy">
          ${entry.folder ? `<span class="folder-chip">${folderIcon()}${escapeHtml(entry.folder)}</span>` : ""}
          ${(entry.tags || []).map((topic) => `<button type="button" data-topic="${escapeAttribute(topic)}">${escapeHtml(topic)}</button>`).join("")}
        </div>
        <div class="entry-progress" style="--entry-progress:${entry.progress}%">
          <span aria-hidden="true"><i></i></span>
          <small>${statusLabel} · ${entry.progress}%</small>
        </div>
        <details class="entry-organize">
          <summary>Organize</summary>
          <div class="organize-panel">
            <label>
              <span>Folder</span>
              <input type="text" data-folder value="${escapeAttribute(entry.folder)}" list="folder-options" placeholder="Unfiled" maxlength="60" />
            </label>
            <label>
              <span>Topics</span>
              <input type="text" data-topics value="${escapeAttribute((entry.tags || []).join(", "))}" placeholder="Politics, Tech, Research" />
            </label>
            <fieldset class="status-control">
              <legend>Reading state</legend>
              ${["unread", "reading", "completed"].map((status) => `<button type="button" data-status="${status}" class="${entry.status === status ? "is-active" : ""}" aria-pressed="${entry.status === status}">${statusLabelFor(status)}</button>`).join("")}
            </fieldset>
            <div class="entry-actions">
              <button type="button" data-archive="${entry.archived ? "false" : "true"}">${entry.archived ? restoreIcon() : archiveIcon()}<span>${entry.archived ? "Restore" : "Archive"}</span></button>
              <button type="button" class="delete-action ${deletePending ? "is-confirming" : ""}" data-delete>${trashIcon()}<span>${deletePending ? "Confirm delete" : "Delete"}</span></button>
            </div>
          </div>
        </details>
      </div>
      <button class="entry-open" type="button" data-open="${escapeAttribute(entry.id)}" aria-label="Open ${escapeAttribute(entry.title || "article")}">${arrowIcon()}</button>
    </article>
  `;
}

async function handleCatalogClick(event) {
  const emptyClear = event.target.closest("[data-empty-clear]");
  if (emptyClear) {
    state.query = "";
    state.view = "all";
    state.folder = "";
    state.topic = "";
    document.querySelector("#library-search").value = "";
    renderLibrary();
    return;
  }
  const mapNode = event.target.closest("[data-interest-node]");
  if (mapNode) {
    if (!activeInterestMap?.suppressClick) selectInterestNode(mapNode.dataset.interestNode);
    return;
  }
  const entryRoot = event.target.closest("[data-entry-id]");
  const articleId = entryRoot?.dataset.entryId;
  if (!articleId) return;
  const open = event.target.closest("[data-open]");
  if (open) return openArticle(articleId);

  const topic = event.target.closest("[data-topic]");
  if (topic) {
    state.topic = topic.dataset.topic;
    renderLibrary();
    return;
  }

  const status = event.target.closest("[data-status]");
  if (status) return updateEntry(articleId, { status: status.dataset.status, progress: status.dataset.status === "completed" ? 100 : status.dataset.status === "unread" ? 0 : Math.max(1, findEntry(articleId)?.progress || 1) }, "Reading state updated");

  const archive = event.target.closest("[data-archive]");
  if (archive) return updateEntry(articleId, { archived: archive.dataset.archive === "true" }, archive.dataset.archive === "true" ? "Article archived" : "Article restored");

  const remove = event.target.closest("[data-delete]");
  if (remove) return handleDelete(articleId);
}

async function handleCatalogChange(event) {
  const entryRoot = event.target.closest("[data-entry-id]");
  const articleId = entryRoot?.dataset.entryId;
  if (!articleId) return;
  if (event.target.matches("[data-folder]")) await updateEntry(articleId, { folder: event.target.value }, "Folder updated");
  if (event.target.matches("[data-topics]")) await updateEntry(articleId, { tags: event.target.value }, "Topics updated");
}

async function updateEntry(articleId, patch, message) {
  try {
    await store.update(articleId, patch);
    await refreshEntries();
    showToast(message);
  } catch (error) {
    showToast(error.message || "Lectio could not update this article", true);
  }
}

async function handleDelete(articleId) {
  if (state.pendingDeleteId !== articleId) {
    state.pendingDeleteId = articleId;
    renderCatalog();
    clearTimeout(handleDelete.timeout);
    handleDelete.timeout = setTimeout(() => {
      state.pendingDeleteId = "";
      renderCatalog();
    }, 4000);
    return;
  }
  clearTimeout(handleDelete.timeout);
  await store.delete(articleId);
  state.pendingDeleteId = "";
  await refreshEntries();
  showToast("Article deleted from this browser");
}

async function openArticle(articleId) {
  try {
    await store.markOpened(articleId);
    const response = await chrome.runtime.sendMessage({ type: "LECTIO_OPEN_BOOKMARK", articleId });
    if (response?.ok === false) throw new Error(response.error || "Lectio could not open this article.");
    await refreshEntries();
  } catch (error) {
    showToast(error.message || "Lectio could not open this article", true);
  }
}

async function refreshEntries() {
  state.entries = await store.list();
  renderLibrary();
}

function visibleEntries() {
  return filterLibraryEntries(state.entries, state);
}

function findEntry(articleId) {
  return state.entries.find((entry) => entry.id === articleId);
}

function emptyLibraryTemplate() {
  const hasFilters = state.query || state.view !== "all" || state.folder || state.topic;
  return `
    <div class="library-empty">
      <span aria-hidden="true">${hasFilters ? searchIcon() : bookIcon()}</span>
      <h3>${hasFilters ? "Nothing matches this shelf." : "Your library is ready."}</h3>
      <p>${hasFilters ? "Try another search, folder, or reading state." : "Open an article with Lectio, then bookmark it to keep it here."}</p>
      ${hasFilters ? `<button type="button" data-empty-clear>Show all articles</button>` : ""}
    </div>
  `;
}

function summaryText(stats) {
  if (!stats.all && !stats.archived) return "Saved articles will appear here with their reading state and notes intact.";
  return `${stats.all} saved · ${stats.unread} unread · ${stats.completed} completed${stats.archived ? ` · ${stats.archived} archived` : ""}`;
}

function statusLabelFor(status) {
  return status === "completed" ? "Completed" : status === "reading" ? "Reading" : "Unread";
}

function dateLabel(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "Saved locally";
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function hostFor(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function shortText(value, length) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1).trim()}…` : text;
}

function isTypingTarget(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
}

function showToast(message, error = false) {
  const toast = document.querySelector("#library-toast");
  toast.textContent = message;
  toast.classList.toggle("is-error", error);
  toast.classList.add("is-visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function renderFatalError(message) {
  app.innerHTML = `<main class="library-fatal"><span>${bookIcon()}</span><h1>Lectio could not open your library</h1><p>${escapeHtml(message)}</p></main>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function icon(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function bookIcon() { return icon('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"/>'); }
function searchIcon() { return icon('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'); }
function folderIcon() { return icon('<path d="M3.5 6.5h6l2 2h9v10h-17z"/>'); }
function archiveIcon() { return icon('<path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/>'); }
function restoreIcon() { return icon('<path d="M4 7h16v13H4zM3 4h18v3H3z"/><path d="m9 14 3-3 3 3M12 11v6"/>'); }
function trashIcon() { return icon('<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>'); }
function arrowIcon() { return icon('<path d="M5 12h14m-5-5 5 5-5 5"/>'); }
function listIcon() { return icon('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".8" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r=".8" fill="currentColor" stroke="none"/>'); }
function graphIcon() { return icon('<circle cx="6" cy="7" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="15" cy="18" r="2"/><path d="m8 7 8-2m1 2-2 9M7 9l7 7"/>'); }
function minusIcon() { return icon('<path d="M6 12h12"/>'); }
function plusIcon() { return icon('<path d="M6 12h12M12 6v12"/>'); }
function fitIcon() { return icon('<path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4"/>'); }
