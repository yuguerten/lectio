import { OpenRouter } from "@openrouter/sdk";

const MAX_TEXT_LENGTH = 6000;
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

    const client = new OpenRouter({ apiKey });
    const result = await runOpenRouterAssist(client, {
      mode,
      text,
      targetLanguage
    });

    response.status(200).json({
      mode,
      text: normalizeAssistText(result.text),
      reasoningTokens: result.reasoningTokens
    });
  } catch (error) {
    console.error("OpenRead assist failed", error);
    const status = error.status || 500;
    const message = error.code === "insufficient_quota"
      ? "OpenRouter quota exceeded. Check billing, credits, and project limits for this API key."
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
    return `Translate the user's selected text into ${targetLanguage}. Return only the translated text. Use plain text only. Do not use Markdown, bold markers, headings, bullets, or commentary. Preserve code, URLs, product names, and technical terms when translation would make them less accurate.`;
  }

  return "Explain the user's selected text in natural plain language. Use one or two short paragraphs. Do not use Markdown, bold markers, headings, bullets, or meta commentary. Define important terms only when needed, preserve technical accuracy, and keep the answer concise.";
}

function normalizeAssistText(text) {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function runOpenRouterAssist(client, { mode, text, targetLanguage }) {
  const stream = await client.chat.send({
    chatRequest: {
      model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content: instructionsFor(mode, targetLanguage)
        },
        {
          role: "user",
          content: text
        }
      ],
      stream: true
    }
  });

  let textResponse = "";
  let reasoningTokens = null;

  for await (const chunk of stream) {
    const content = chunk.choices?.[0]?.delta?.content;
    if (content) textResponse += content;
    if (chunk.usage) {
      reasoningTokens = chunk.usage.reasoningTokens ?? chunk.usage.reasoning_tokens ?? null;
    }
  }

  return {
    text: textResponse,
    reasoningTokens
  };
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", process.env.OPENREAD_ALLOWED_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
