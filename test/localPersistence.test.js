import test from "node:test";
import assert from "node:assert/strict";
import { createAnnotationStore, createMemoryStorageAdapter } from "../src/core/localPersistence.js";

test("saves, loads, and deletes annotations through an adapter", async () => {
  const store = createAnnotationStore(createMemoryStorageAdapter());
  const annotations = [{ id: "a1" }];

  await store.save("https://example.com/post", annotations);
  assert.deepEqual(await store.load("https://example.com/post"), annotations);

  await store.delete("https://example.com/post");
  assert.deepEqual(await store.load("https://example.com/post"), []);
});
