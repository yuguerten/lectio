import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const DEFAULT_DATA_FILE = normalize(join(process.cwd(), "data", "openread.json"));
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function createBackendService(options = {}) {
  const dataFile = options.dataFile || process.env.OPENREAD_DATA_FILE || DEFAULT_DATA_FILE;

  return {
    dataFile,
    async register({ email, password, name }) {
      const normalizedEmail = normalizeEmail(email);
      validatePassword(password);
      const data = await readData(dataFile);
      if (data.users.some((user) => user.email === normalizedEmail)) {
        throw httpError(409, "An account already exists for this email.");
      }

      const now = new Date().toISOString();
      const user = {
        id: randomUUID(),
        email: normalizedEmail,
        name: sanitizeName(name) || normalizedEmail.split("@")[0],
        passwordHash: await hashPassword(password),
        createdAt: now,
        updatedAt: now
      };
      data.users.push(user);
      const session = createSession(user.id);
      data.sessions.push(session);
      await writeData(dataFile, data);
      return { user: publicUser(user), token: session.token };
    },

    async login({ email, password }) {
      const normalizedEmail = normalizeEmail(email);
      if (!password) throw httpError(400, "Password is required.");
      const data = await readData(dataFile);
      const user = data.users.find((item) => item.email === normalizedEmail);
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        throw httpError(401, "Invalid email or password.");
      }

      const session = createSession(user.id);
      data.sessions = pruneSessions(data.sessions).filter((item) => item.userId !== user.id || new Date(item.expiresAt).getTime() > Date.now());
      data.sessions.push(session);
      await writeData(dataFile, data);
      return { user: publicUser(user), token: session.token };
    },

    async logout(token) {
      requireToken(token);
      const data = await readData(dataFile);
      data.sessions = data.sessions.filter((session) => session.token !== token);
      await writeData(dataFile, data);
    },

    async getUserByToken(token) {
      const session = await resolveSession(dataFile, token);
      return session.user;
    },

    async listNotes(token, filters = {}) {
      const { data, user } = await resolveSession(dataFile, token, { includeData: true });
      return data.notes
        .filter((note) => note.userId === user.id)
        .filter((note) => !filters.articleId || note.articleId === filters.articleId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(publicNote);
    },

    async createNote(token, input) {
      const { data, user } = await resolveSession(dataFile, token, { includeData: true });
      const now = new Date().toISOString();
      const noteText = String(input?.note || "");
      const note = {
        id: randomUUID(),
        userId: user.id,
        articleId: requireString(input?.articleId, "articleId"),
        type: input?.type === "highlight" && !noteText.trim() ? "highlight" : "note",
        color: sanitizeColor(input?.color),
        anchor: sanitizeAnchor(input?.anchor),
        note: noteText,
        createdAt: now,
        updatedAt: now
      };
      data.notes.push(note);
      await writeData(dataFile, data);
      return publicNote(note);
    },

    async replaceNotes(token, articleId, notes) {
      const { data, user } = await resolveSession(dataFile, token, { includeData: true });
      const cleanArticleId = requireString(articleId, "articleId");
      if (!Array.isArray(notes)) throw httpError(400, "notes must be an array.");
      const now = new Date().toISOString();
      const existingById = new Map(data.notes.filter((note) => note.userId === user.id && note.articleId === cleanArticleId).map((note) => [note.id, note]));
      const replacement = notes.map((input) => {
        const id = input?.id || randomUUID();
        const existing = existingById.get(id);
        const noteText = String(input?.note || "");
        return {
          id,
          userId: user.id,
          articleId: cleanArticleId,
          type: input?.type === "highlight" && !noteText.trim() ? "highlight" : "note",
          color: sanitizeColor(input?.color),
          anchor: sanitizeAnchor(input?.anchor),
          note: noteText,
          createdAt: existing?.createdAt || input?.createdAt || now,
          updatedAt: existing ? now : input?.updatedAt || now
        };
      });
      data.notes = data.notes.filter((note) => !(note.userId === user.id && note.articleId === cleanArticleId));
      data.notes.push(...replacement);
      await writeData(dataFile, data);
      return replacement.map(publicNote);
    },

    async getNote(token, noteId) {
      const { data, user } = await resolveSession(dataFile, token, { includeData: true });
      const note = findOwnedNote(data, user.id, noteId);
      return publicNote(note);
    },

    async updateNote(token, noteId, patch) {
      const { data, user } = await resolveSession(dataFile, token, { includeData: true });
      const note = findOwnedNote(data, user.id, noteId);
      if (patch.articleId !== undefined) note.articleId = requireString(patch.articleId, "articleId");
      if (patch.color !== undefined) note.color = sanitizeColor(patch.color);
      if (patch.anchor !== undefined) note.anchor = sanitizeAnchor(patch.anchor);
      if (patch.note !== undefined) note.note = String(patch.note || "");
      if (patch.type !== undefined) note.type = patch.type === "highlight" && !note.note.trim() ? "highlight" : "note";
      if (patch.note !== undefined && patch.type === undefined) note.type = note.note.trim() ? "note" : note.type;
      note.updatedAt = new Date().toISOString();
      await writeData(dataFile, data);
      return publicNote(note);
    },

    async deleteNote(token, noteId) {
      const { data, user } = await resolveSession(dataFile, token, { includeData: true });
      findOwnedNote(data, user.id, noteId);
      data.notes = data.notes.filter((note) => !(note.userId === user.id && note.id === noteId));
      await writeData(dataFile, data);
    }
  };
}

export async function handleBackendApi(request, response, options = {}) {
  const service = options.service || createBackendService(options);
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const method = request.method || "GET";

  try {
    if (method === "POST" && url.pathname === "/api/auth/register") {
      return sendJson(response, 201, await service.register(await readJsonBody(request)));
    }
    if (method === "POST" && url.pathname === "/api/auth/login") {
      return sendJson(response, 200, await service.login(await readJsonBody(request)));
    }
    if (method === "POST" && url.pathname === "/api/auth/logout") {
      await service.logout(readBearerToken(request));
      return sendEmpty(response, 204);
    }
    if (method === "GET" && url.pathname === "/api/me") {
      return sendJson(response, 200, { user: await service.getUserByToken(readBearerToken(request)) });
    }
    if (url.pathname === "/api/notes" && method === "GET") {
      return sendJson(response, 200, { notes: await service.listNotes(readBearerToken(request), { articleId: url.searchParams.get("articleId") || "" }) });
    }
    if (url.pathname === "/api/notes" && method === "POST") {
      return sendJson(response, 201, { note: await service.createNote(readBearerToken(request), await readJsonBody(request)) });
    }
    if (url.pathname === "/api/notes" && method === "PUT") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, { notes: await service.replaceNotes(readBearerToken(request), url.searchParams.get("articleId"), body.notes) });
    }

    const noteMatch = url.pathname.match(/^\/api\/notes\/([^/]+)$/);
    if (noteMatch && method === "GET") {
      return sendJson(response, 200, { note: await service.getNote(readBearerToken(request), decodeURIComponent(noteMatch[1])) });
    }
    if (noteMatch && method === "PATCH") {
      return sendJson(response, 200, { note: await service.updateNote(readBearerToken(request), decodeURIComponent(noteMatch[1]), await readJsonBody(request)) });
    }
    if (noteMatch && method === "DELETE") {
      await service.deleteNote(readBearerToken(request), decodeURIComponent(noteMatch[1]));
      return sendEmpty(response, 204);
    }

    return sendJson(response, 404, { error: "API route not found." });
  } catch (error) {
    return sendJson(response, error.statusCode || 500, { error: error.expose === false ? "Internal server error." : error.message });
  }
}

function createSession(userId) {
  const now = Date.now();
  return {
    token: randomBytes(32).toString("base64url"),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString()
  };
}

async function resolveSession(dataFile, token, options = {}) {
  requireToken(token);
  const data = await readData(dataFile);
  data.sessions = pruneSessions(data.sessions);
  const session = data.sessions.find((item) => item.token === token);
  if (!session) throw httpError(401, "Session is missing or expired.");
  const user = data.users.find((item) => item.id === session.userId);
  if (!user) throw httpError(401, "Session user no longer exists.");
  if (options.includeData) return { data, user, session };
  return { user: publicUser(user), session };
}

function pruneSessions(sessions) {
  const now = Date.now();
  return sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
}

async function readData(dataFile) {
  try {
    const parsed = JSON.parse(await readFile(dataFile, "utf8"));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : []
    };
  } catch (error) {
    if (error.code === "ENOENT") return { users: [], sessions: [], notes: [] };
    throw error;
  }
}

async function writeData(dataFile, data) {
  await mkdir(dirname(dataFile), { recursive: true });
  const tempFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tempFile, dataFile);
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString("base64url")}`;
}

async function verifyPassword(password, storedHash) {
  const [scheme, salt, hash] = String(storedHash || "").split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt, updatedAt: user.updatedAt };
}

function publicNote(note) {
  return {
    id: note.id,
    articleId: note.articleId,
    type: note.type,
    color: note.color,
    anchor: note.anchor,
    note: note.note,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt
  };
}

function findOwnedNote(data, userId, noteId) {
  const note = data.notes.find((item) => item.userId === userId && item.id === noteId);
  if (!note) throw httpError(404, "Note not found.");
  return note;
}

function normalizeEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw httpError(400, "A valid email is required.");
  return normalized;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) throw httpError(400, "Password must be at least 8 characters.");
}

function sanitizeName(name) {
  return String(name || "").trim().slice(0, 120);
}

function sanitizeColor(color) {
  const value = String(color || "yellow").trim();
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(value)) throw httpError(400, "Color must be a simple color id.");
  return value;
}

function sanitizeAnchor(anchor) {
  if (!anchor || typeof anchor !== "object") throw httpError(400, "Note anchor is required.");
  const exact = requireString(anchor.exact, "anchor.exact");
  return {
    exact,
    prefix: String(anchor.prefix || ""),
    suffix: String(anchor.suffix || ""),
    startOffset: requireNumber(anchor.startOffset, "anchor.startOffset"),
    endOffset: requireNumber(anchor.endOffset, "anchor.endOffset"),
    blockIndex: Number.isFinite(Number(anchor.blockIndex)) ? Number(anchor.blockIndex) : 0
  };
}

function requireString(value, field) {
  const text = String(value || "").trim();
  if (!text) throw httpError(400, `${field} is required.`);
  return text;
}

function requireNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw httpError(400, `${field} must be a number.`);
  return number;
}

function requireToken(token) {
  if (!token) throw httpError(401, "Bearer token is required.");
}

function readBearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (!match) throw httpError(401, "Bearer token is required.");
  return match[1].trim();
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendEmpty(response, statusCode) {
  response.statusCode = statusCode;
  response.end();
}

function httpError(statusCode, message, options = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = options.expose !== false;
  return error;
}
