import { OpenRouter } from "@openrouter/sdk";

process.loadEnvFile?.(".env");

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error("OPENROUTER_API_KEY is empty. Add your key to .env first.");
  process.exit(1);
}

const client = new OpenRouter({ apiKey });
const model = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";
const stream = await client.chat.send({
  chatRequest: {
    model,
    messages: [
      {
        role: "user",
        content: "Reply with exactly: lectio-ok"
      }
    ],
    stream: true
  }
});

let response = "";
let reasoningTokens = null;

for await (const chunk of stream) {
  const content = chunk.choices?.[0]?.delta?.content;
  if (content) response += content;
  if (chunk.usage) {
    reasoningTokens = chunk.usage.reasoningTokens ?? chunk.usage.reasoning_tokens ?? null;
  }
}

console.log(response.trim() || "[empty response]");
if (reasoningTokens !== null) console.log("Reasoning tokens:", reasoningTokens);
