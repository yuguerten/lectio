import OpenAI from "openai";

process.loadEnvFile?.(".env");

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is empty. Add your key to .env first.");
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || "gpt-5.2";
const response = await client.responses.create({
  model,
  input: "Reply with exactly: openread-ok"
});

console.log(response.output_text?.trim() || "[empty response]");
