import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackendService } from "../api/backend.js";

const anchor = {
  exact: "important text",
  prefix: "Some ",
  suffix: " here.",
  startOffset: 5,
  endOffset: 19,
  blockIndex: 0
};

async function createService() {
  const dir = await mkdtemp(join(tmpdir(), "openread-backend-"));
  return createBackendService({ dataFile: join(dir, "db.json") });
}

test("registers and logs in users without exposing password hashes", async () => {
  const service = await createService();

  const registered = await service.register({ email: "Reader@Example.com", password: "password123", name: "Reader" });
  assert.equal(registered.user.email, "reader@example.com");
  assert.equal(registered.user.name, "Reader");
  assert.ok(registered.token);
  assert.equal("passwordHash" in registered.user, false);

  await assert.rejects(
    service.register({ email: "reader@example.com", password: "password123" }),
    /already exists/
  );

  const loggedIn = await service.login({ email: "reader@example.com", password: "password123" });
  assert.equal(loggedIn.user.id, registered.user.id);
  assert.ok(loggedIn.token);
});

test("requires valid auth before notes CRUD", async () => {
  const service = await createService();

  await assert.rejects(service.listNotes(""), /Bearer token/);
  await assert.rejects(service.listNotes("bad-token"), /Session is missing/);
});

test("creates, lists, updates, and deletes notes for the current user", async () => {
  const service = await createService();
  const { token } = await service.register({ email: "note@example.com", password: "password123" });

  const created = await service.createNote(token, {
    articleId: "https://example.com/article",
    anchor,
    color: "green",
    note: "Remember this"
  });

  assert.equal(created.type, "note");
  assert.equal(created.note, "Remember this");

  const listed = await service.listNotes(token, { articleId: "https://example.com/article" });
  assert.deepEqual(listed.map((note) => note.id), [created.id]);

  const updated = await service.updateNote(token, created.id, { note: "Updated note", color: "blue" });
  assert.equal(updated.note, "Updated note");
  assert.equal(updated.color, "blue");
  assert.notEqual(updated.updatedAt, created.updatedAt);

  assert.equal((await service.getNote(token, created.id)).note, "Updated note");

  await service.deleteNote(token, created.id);
  assert.deepEqual(await service.listNotes(token), []);
});

test("keeps notes scoped to their owner", async () => {
  const service = await createService();
  const first = await service.register({ email: "first@example.com", password: "password123" });
  const second = await service.register({ email: "second@example.com", password: "password123" });

  const note = await service.createNote(first.token, {
    articleId: "article-1",
    anchor,
    note: "Private"
  });

  assert.deepEqual(await service.listNotes(second.token), []);
  await assert.rejects(service.getNote(second.token, note.id), /Note not found/);
});
