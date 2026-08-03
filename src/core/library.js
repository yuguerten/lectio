export const LIBRARY_VIEWS = ["all", "recent", "unread", "completed", "archived"];

export function normalizeLibraryEntry(entry = {}) {
  const progress = clampProgress(entry.progress);
  return {
    ...entry,
    tags: normalizeLibraryTags(entry.tags),
    folder: normalizeFolder(entry.folder),
    archived: Boolean(entry.archived),
    progress,
    status: normalizeReadingStatus(entry.status, progress),
    lastOpenedAt: validDateString(entry.lastOpenedAt) || validDateString(entry.savedAt) || "",
    lastReadAt: validDateString(entry.lastReadAt) || ""
  };
}

export function normalizeLibraryTags(tags) {
  const values = Array.isArray(tags) ? tags : String(tags || "").split(",");
  const seen = new Set();
  return values
    .map((tag) => String(tag || "").replace(/\s+/g, " ").trim())
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

export function normalizeFolder(folder) {
  return String(folder || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

export function clampProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return 0;
  return Math.round(Math.min(100, Math.max(0, progress)));
}

export function normalizeReadingStatus(status, progress = 0) {
  if (status === "completed") return "completed";
  if (status === "unread" && clampProgress(progress) === 0) return "unread";
  if (status === "reading") return clampProgress(progress) >= 95 ? "completed" : "reading";
  if (clampProgress(progress) >= 95) return "completed";
  if (clampProgress(progress) > 0) return "reading";
  return "unread";
}

export function applyReadingProgress(entry, progress, readAt = new Date().toISOString()) {
  const normalized = normalizeLibraryEntry(entry);
  const nextProgress = clampProgress(progress);
  return {
    ...normalized,
    progress: nextProgress,
    status: normalized.status === "completed" || nextProgress >= 95 ? "completed" : nextProgress > 0 ? "reading" : "unread",
    lastReadAt: validDateString(readAt) || normalized.lastReadAt
  };
}

export function filterLibraryEntries(entries, filters = {}) {
  const view = LIBRARY_VIEWS.includes(filters.view) ? filters.view : "all";
  const query = normalizeSearch(filters.query);
  const folder = normalizeFolder(filters.folder);
  const topic = normalizeTopic(filters.topic);

  return (entries || [])
    .map(normalizeLibraryEntry)
    .filter((entry) => (view === "archived" ? entry.archived : !entry.archived))
    .filter((entry) => {
      if (view === "unread") return entry.status === "unread";
      if (view === "completed") return entry.status === "completed";
      if (view === "recent") return Boolean(entry.lastOpenedAt || entry.lastReadAt);
      return true;
    })
    .filter((entry) => !folder || entry.folder === folder)
    .filter((entry) => !topic || entry.tags.some((tag) => normalizeTopic(tag) === topic))
    .filter((entry) => !query || searchableText(entry).includes(query))
    .sort((left, right) => entrySortTime(right, view) - entrySortTime(left, view));
}

export function getLibraryTopics(entries) {
  const counts = new Map();
  for (const entry of (entries || []).map(normalizeLibraryEntry).filter((item) => !item.archived)) {
    for (const topic of entry.tags) {
      const key = normalizeTopic(topic);
      if (!key) continue;
      const current = counts.get(key);
      counts.set(key, { label: current?.label || topic, count: (current?.count || 0) + 1 });
    }
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
}

export function getLibraryFolders(entries) {
  return [...new Set((entries || []).map(normalizeLibraryEntry).map((entry) => entry.folder).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

export function getLibraryStats(entries) {
  const active = (entries || []).map(normalizeLibraryEntry).filter((entry) => !entry.archived);
  return {
    all: active.length,
    recent: active.filter((entry) => entry.lastOpenedAt || entry.lastReadAt).length,
    unread: active.filter((entry) => entry.status === "unread").length,
    completed: active.filter((entry) => entry.status === "completed").length,
    archived: (entries || []).map(normalizeLibraryEntry).filter((entry) => entry.archived).length
  };
}

export function buildInterestGraph(entries) {
  const active = (entries || []).map(normalizeLibraryEntry).filter((entry) => !entry.archived);
  const folderRecords = new Map();
  const topicRecords = new Map();
  const connections = new Map();

  for (const entry of active) {
    const folderLabel = entry.folder || "Unfiled";
    const folderKey = normalizeSearch(folderLabel);
    const folder = folderRecords.get(folderKey) || { key: folderKey, label: folderLabel, articleIds: [] };
    folder.articleIds.push(entry.id);
    folderRecords.set(folderKey, folder);

    for (const topicLabel of entry.tags) {
      const topicKey = normalizeTopic(topicLabel);
      if (!topicKey) continue;
      const topic = topicRecords.get(topicKey) || { key: topicKey, label: topicLabel, articleIds: [] };
      topic.articleIds.push(entry.id);
      topicRecords.set(topicKey, topic);
      const connectionKey = `${folderKey}\u0000${topicKey}`;
      connections.set(connectionKey, (connections.get(connectionKey) || 0) + 1);
    }
  }

  const byWeightThenLabel = (left, right) =>
    right.articleIds.length - left.articleIds.length ||
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
  const folders = [...folderRecords.values()].sort(byWeightThenLabel).map((folder) => ({
    id: `folder:${encodeURIComponent(folder.key)}`,
    type: "folder",
    label: folder.label,
    count: folder.articleIds.length,
    articleIds: folder.articleIds
  }));
  const topics = [...topicRecords.values()].sort(byWeightThenLabel).map((topic) => ({
    id: `topic:${encodeURIComponent(topic.key)}`,
    type: "topic",
    label: topic.label,
    count: topic.articleIds.length,
    articleIds: topic.articleIds
  }));
  const folderIds = new Map(folders.map((folder) => [normalizeSearch(folder.label), folder.id]));
  const topicIds = new Map(topics.map((topic) => [normalizeTopic(topic.label), topic.id]));
  const edges = folders.map((folder) => ({
    source: "library",
    target: folder.id,
    type: "folder",
    count: folder.count
  }));

  for (const [key, count] of connections) {
    const [folderKey, topicKey] = key.split("\u0000");
    edges.push({
      source: folderIds.get(folderKey),
      target: topicIds.get(topicKey),
      type: "topic",
      count
    });
  }

  return {
    root: {
      id: "library",
      type: "root",
      label: "Library",
      count: active.length,
      articleIds: active.map((entry) => entry.id)
    },
    folders,
    topics,
    edges
  };
}

function searchableText(entry) {
  return normalizeSearch(
    [entry.title, entry.byline, entry.siteName, entry.excerpt, entry.folder, ...(entry.tags || [])].filter(Boolean).join(" ")
  );
}

function normalizeSearch(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function normalizeTopic(value) {
  return normalizeSearch(value).replace(/^#/, "");
}

function entrySortTime(entry, view) {
  const preferred = view === "recent" ? entry.lastReadAt || entry.lastOpenedAt : entry.savedAt || entry.lastOpenedAt;
  const time = Date.parse(preferred || "");
  return Number.isFinite(time) ? time : 0;
}

function validDateString(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return String(value);
}
