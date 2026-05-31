import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const MAX_TEXT_LENGTH = 6000;

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

  if (!process.env.OPENAI_API_KEY) {
    response.status(500).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  try {
    const body = parseBody(request.body);
    const mode = body.mode === "translate" ? "translate" : body.mode === "explain" ? "explain" : "";
    const text = String(body.text || "").trim().slice(0, MAX_TEXT_LENGTH);
    const targetLanguage = String(body.targetLanguage || "English").trim().slice(0, 48) || "English";

    if (!mode) {
      response.status(400).json({ error: "Invalid assist mode" });
      return;
    }

    if (!text) {
      response.status(400).json({ error: "Text is required" });
      return;
    }

    const result = await client.responses.create({
      model: MODEL,
      instructions: instructionsFor(mode, targetLanguage),
      input: text
    });

    response.status(200).json({
      mode,
      text: result.output_text?.trim() || ""
    });
  } catch (error) {
    console.error("OpenRead assist failed", error);
    const status = error.status || 500;
    const message = error.code === "insufficient_quota"
      ? "OpenAI quota exceeded. Check billing, credits, and project limits for this API key."
      : error.message || "Assist request failed";
    response.status(status >= 400 && status < 600 ? status : 500).json({
      error: message,
      code: error.code || error.type || "assist_error"
    });
  }
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function instructionsFor(mode, targetLanguage) {
  if (mode === "translate") {
    return `Translate the user's selected text into ${targetLanguage}. Return only the translated text. Preserve code, URLs, product names, and technical terms when translation would make them less accurate.`;
  }

  return "Explain the user's selected text clearly and briefly. Define important terms, preserve technical accuracy, and include a tiny example only if it helps. Keep the answer concise.";
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", process.env.OPENREAD_ALLOWED_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
