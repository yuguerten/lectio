import { buildSmartOutlinePrompt, normalizeSmartOutline, parseSmartOutlineJson } from "../src/core/smartOutline.js";

const MAX_CHUNKS = 36;
const MAX_CHUNK_CHARS = 1200;
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

export default async function handler(request, response) {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    response.status(500).json({ error: "OPENROUTER_API_KEY is not configured" });
    return;
  }

  try {
    const body = parseBody(request.body);
    const chunks = sanitizeChunks(body.chunks);
    if (chunks.length < 2) {
      response.status(400).json({ error: "At least two article chunks are required." });
      return;
    }

    const result = await requestOutline({
      apiKey,
      model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      title: String(body.title || "Untitled article").slice(0, 180),
      url: String(body.url || "").slice(0, 500),
      chunks
    });

    const outline = normalizeSmartOutline(parseSmartOutlineJson(result), chunks);
    if (!outline.sections.length) {
      response.status(502).json({ error: "The model did not return a usable outline." });
      return;
    }

    response.status(200).json(outline);
  } catch (error) {
    console.error("Lectio outline failed", error);
    response.status(error.status || 500).json({ error: error.message || "Outline request failed" });
  }
}

async function requestOutline({ apiKey, model, title, url, chunks }) {
  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You create accurate article outlines. Return only strict JSON."
        },
        {
          role: "user",
          content: buildSmartOutlinePrompt({ title, url, chunks })
        }
      ],
      temperature: 0.2
    })
  });

  const text = await upstream.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!upstream.ok) {
    const message = friendlyOpenRouterError(upstream.status, payload);
    const error = new Error(message);
    error.status = upstream.status;
    throw error;
  }

  return payload.choices?.[0]?.message?.content || payload.output_text || payload.raw || "";
}

function friendlyOpenRouterError(status, payload) {
  const message = payload.error?.message || payload.error || payload.message || "OpenRouter outline request failed";
  if (status === 401) {
    return "OpenRouter rejected OPENROUTER_API_KEY. Create or rotate the key in OpenRouter, update .env, then restart npm run serve.";
  }
  return message;
}

function sanitizeChunks(chunks) {
  if (!Array.isArray(chunks)) return [];
  return chunks.slice(0, MAX_CHUNKS).map((chunk, index) => ({
    id: String(chunk?.id || `chunk_${index + 1}`).trim(),
    targetId: String(chunk?.targetId || "").trim(),
    text: String(chunk?.text || "").replace(/\s+/g, " ").trim().slice(0, MAX_CHUNK_CHARS)
  })).filter((chunk) => /^chunk_\d+$/.test(chunk.id) && chunk.text.length >= 40);
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", process.env.LECTIO_ALLOWED_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
