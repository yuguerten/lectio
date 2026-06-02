const MAX_TEXT_LENGTH = 12000;
const DEFAULT_MODEL = "hexgrad/kokoro-82m";
const DEFAULT_VOICE = "af_nova";
const DEFAULT_FORMAT = "mp3";

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
    const input = String(body.text || body.input || "").trim().slice(0, MAX_TEXT_LENGTH);
    const model = sanitizeModel(body.model || process.env.OPENROUTER_TTS_MODEL || DEFAULT_MODEL);
    const voice = sanitizeVoice(body.voice || process.env.OPENROUTER_TTS_VOICE || DEFAULT_VOICE);
    const speed = clampSpeed(Number(body.speed) || 1);

    if (!input) {
      response.status(400).json({ error: "Text is required" });
      return;
    }

    const upstream = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        voice,
        input,
        response_format: DEFAULT_FORMAT,
        speed
      })
    });

    if (!upstream.ok) {
      const message = await readErrorMessage(upstream);
      response.status(upstream.status).json({ error: message || "OpenRouter speech request failed" });
      return;
    }

    const arrayBuffer = await upstream.arrayBuffer();
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");
    response.setHeader("Cache-Control", "no-store");
    const generationId = upstream.headers.get("x-generation-id");
    if (generationId) response.setHeader("X-Generation-Id", generationId);
    response.status(200).end(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error("OpenRead speech failed", error);
    response.status(500).json({ error: error.message || "Speech request failed" });
  }
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function sanitizeModel(value) {
  return String(value || DEFAULT_MODEL).trim().slice(0, 120) || DEFAULT_MODEL;
}

function sanitizeVoice(value) {
  return String(value || DEFAULT_VOICE).trim().slice(0, 80) || DEFAULT_VOICE;
}

function clampSpeed(value) {
  return Math.min(1.5, Math.max(0.5, value));
}

async function readErrorMessage(response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    return payload.error?.message || payload.error || payload.message || text;
  } catch {
    return text;
  }
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", process.env.OPENREAD_ALLOWED_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
