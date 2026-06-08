import test from "node:test";
import assert from "node:assert/strict";
import { createAnnotationStore, createDrawingStore, createMemoryStorageAdapter, createSmartOutlineStore } from "../src/core/localPersistence.js";

test("saves, loads, and deletes annotations through an adapter", async () => {
  const store = createAnnotationStore(createMemoryStorageAdapter());
  const annotations = [{ id: "a1" }];

  await store.save("https://example.com/post", annotations);
  assert.deepEqual(await store.load("https://example.com/post"), annotations);

  await store.delete("https://example.com/post");
  assert.deepEqual(await store.load("https://example.com/post"), []);
});


test("saves, loads, and deletes drawing strokes through an adapter", async () => {
  const store = createDrawingStore(createMemoryStorageAdapter());
  const strokes = [{ id: "s1", tool: "pen", color: "#171717", size: 4, points: [{ x: 0.2, y: 0.3 }] }];

  await store.save("https://example.com/post", strokes);
  assert.deepEqual(await store.load("https://example.com/post"), strokes);

  await store.delete("https://example.com/post");
  assert.deepEqual(await store.load("https://example.com/post"), []);
});


test("saves and invalidates smart outlines by signature", async () => {
  const store = createSmartOutlineStore(createMemoryStorageAdapter());
  const outline = { signature: "abc", sections: [{ id: "p1", text: "Intro" }] };

  await store.save("https://example.com/post", outline);
  assert.deepEqual(await store.load("https://example.com/post", "abc"), outline);
  assert.equal(await store.load("https://example.com/post", "changed"), null);

  await store.delete("https://example.com/post");
  assert.equal(await store.load("https://example.com/post", "abc"), null);
});
