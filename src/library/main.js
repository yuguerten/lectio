import "../shared/palette.css";
import "./styles.css";
import { filterLibraryEntries, getLibraryFolders, getLibraryStats, getLibraryTopics } from "../core/library.js";
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
const state = {
  entries: [],
  query: "",
  view: "all",
  folder: "",
  topic: "",
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
              <button id="clear-library-filters" class="quiet-button" type="button">Clear filters</button>
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
  document.querySelector("#library-list").addEventListener("click", handleCatalogClick);
  document.querySelector("#library-list").addEventListener("change", handleCatalogChange);
  document.querySelector("#library-list").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("[data-folder], [data-topics]")) event.target.blur();
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
  const title = state.topic ? `Topic: ${state.topic}` : state.folder || VIEW_LABELS[state.view];
  document.querySelector("#catalog-title").textContent = title;
  document.querySelector("#catalog-index").textContent = `${String(entries.length).padStart(2, "0")} ${entries.length === 1 ? "entry" : "entries"}`;
  document.querySelector("#clear-library-filters").hidden = !state.query && state.view === "all" && !state.folder && !state.topic;
  const list = document.querySelector("#library-list");
  if (!entries.length) {
    list.innerHTML = emptyLibraryTemplate();
    return;
  }
  const folders = getLibraryFolders(state.entries);
  list.innerHTML = `${entries.map(entryTemplate).join("")}<datalist id="folder-options">${folders.map((folder) => `<option value="${escapeAttribute(folder)}"></option>`).join("")}</datalist>`;
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
