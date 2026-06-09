import test from "node:test";
import assert from "node:assert/strict";
import outlineHandler from "../api/outline.js";

const chunks = [
  { id: "chunk_1", targetId: "p1", text: "This is a long enough first paragraph for the outline API test to accept as usable article content." },
  { id: "chunk_2", targetId: "p2", text: "This is a long enough second paragraph for the outline API test to accept as usable article content." }
];

test("outline API explains OpenRouter 401 as API key configuration", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  const previousConsoleError = console.error;
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
  console.error = () => {};
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    async text() {
      return JSON.stringify({ error: { message: "User not found." } });
    }
  });

  const response = createJsonResponse();
  await outlineHandler({ method: "POST", body: { title: "Article", chunks } }, response);

  assert.equal(response.statusCode, 401);
  assert.match(response.payload.error, /OpenRouter rejected OPENROUTER_API_KEY/);

  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previousKey;
  globalThis.fetch = previousFetch;
  console.error = previousConsoleError;
});

function createJsonResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
    }
  };
}
