import test from "node:test";
import assert from "node:assert/strict";
import {
  applyReadingProgress,
  buildInterestGraph,
  filterLibraryEntries,
  getLibraryFolders,
  getLibraryStats,
  getLibraryTopics,
  normalizeLibraryEntry,
  normalizeLibraryTags
} from "../src/core/library.js";

const entries = [
  {
    id: "a",
    title: "Routing Fundamentals",
    siteName: "Network Notes",
    tags: ["BGP", "Networks"],
    folder: "Work",
    progress: 0,
    status: "unread",
    savedAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: "2026-01-03T00:00:00.000Z"
  },
  {
    id: "b",
    title: "Writing by Hand",
    byline: "Neal Stephenson",
    tags: ["Research"],
    folder: "Ideas",
    progress: 100,
    status: "completed",
    savedAt: "2026-01-02T00:00:00.000Z",
    lastReadAt: "2026-01-04T00:00:00.000Z"
  },
  {
    id: "c",
    title: "Old reference",
    archived: true,
    savedAt: "2025-01-01T00:00:00.000Z"
  }
];

test("normalizes legacy bookmarks into unread library entries", () => {
  const entry = normalizeLibraryEntry({ id: "legacy", title: "Legacy", savedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(entry.status, "unread");
  assert.equal(entry.progress, 0);
  assert.equal(entry.archived, false);
  assert.deepEqual(entry.tags, []);
  assert.equal(entry.lastOpenedAt, entry.savedAt);
});

test("normalizes and de-duplicates comma separated tags", () => {
  assert.deepEqual(normalizeLibraryTags(" Research, BGP, research,  long form "), ["Research", "BGP", "long form"]);
});

test("applies reading progress and completes at 95 percent", () => {
  assert.equal(applyReadingProgress(entries[0], 44).status, "reading");
  assert.equal(applyReadingProgress(entries[0], 96).status, "completed");
  assert.equal(applyReadingProgress({ ...entries[1], progress: 22 }, 22).status, "completed");
});

test("filters the library by view, folder, and searchable metadata", () => {
  assert.deepEqual(filterLibraryEntries(entries, { view: "unread" }).map((entry) => entry.id), ["a"]);
  assert.deepEqual(filterLibraryEntries(entries, { view: "completed" }).map((entry) => entry.id), ["b"]);
  assert.deepEqual(filterLibraryEntries(entries, { view: "archived" }).map((entry) => entry.id), ["c"]);
  assert.deepEqual(filterLibraryEntries(entries, { folder: "Work", query: "bgp" }).map((entry) => entry.id), ["a"]);
  assert.deepEqual(filterLibraryEntries(entries, { topic: "research" }).map((entry) => entry.id), ["b"]);
  assert.deepEqual(filterLibraryEntries(entries, { query: "stephenson" }).map((entry) => entry.id), ["b"]);
});

test("reports folders and state counts", () => {
  assert.deepEqual(getLibraryFolders(entries), ["Ideas", "Work"]);
  assert.deepEqual(getLibraryTopics(entries), [
    { label: "BGP", count: 1 },
    { label: "Networks", count: 1 },
    { label: "Research", count: 1 }
  ]);
  assert.deepEqual(getLibraryStats(entries), { all: 2, recent: 2, unread: 1, completed: 1, archived: 1 });
});

test("builds a folder and topic interest graph from active articles", () => {
  const graph = buildInterestGraph([
    ...entries,
    {
      id: "d",
      title: "Route policy",
      folder: "Work",
      tags: ["BGP", "Policy"],
      savedAt: "2026-01-05T00:00:00.000Z"
    },
    {
      id: "e",
      title: "Loose note",
      tags: ["Ideas"],
      savedAt: "2026-01-06T00:00:00.000Z"
    }
  ]);

  assert.equal(graph.root.count, 4);
  assert.deepEqual(graph.folders.map(({ label, count }) => ({ label, count })), [
    { label: "Work", count: 2 },
    { label: "Ideas", count: 1 },
    { label: "Unfiled", count: 1 }
  ]);
  assert.deepEqual(graph.topics.map(({ label, count }) => ({ label, count })), [
    { label: "BGP", count: 2 },
    { label: "Ideas", count: 1 },
    { label: "Networks", count: 1 },
    { label: "Policy", count: 1 },
    { label: "Research", count: 1 }
  ]);
  assert.equal(graph.edges.filter((edge) => edge.type === "folder").length, 3);
  assert.equal(graph.edges.find((edge) => edge.type === "topic" && edge.count === 2)?.count, 2);
});
