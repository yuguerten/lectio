import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";
import assistHandler from "./api/assist.js";
import { handleBackendApi } from "./api/backend.js";

process.loadEnvFile?.(".env");

const PORT = Number(process.env.PORT || 8787);
const DIST_DIR = normalize(join(process.cwd(), "dist"));

const server = createServer(async (request, response) => {
  if (request.url?.startsWith("/api/assist")) {
    await handleAssist(request, response);
    return;
  }

  if (request.url?.startsWith("/api/")) {
    await handleBackendApi(request, response);
    return;
  }

  await serveStatic(request, response);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the existing server or run with PORT=${PORT + 1} npm run serve.`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`OpenRead backend running at http://127.0.0.1:${PORT}`);
});

async function handleAssist(request, response) {
  request.body = await readJsonBody(request);
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (payload) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(payload));
  };
  await assistHandler(request, response);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const candidates = pathname.includes(".") ? [pathname] : [pathname, `${pathname}.html`];

  for (const candidate of candidates) {
    const filePath = normalize(join(DIST_DIR, candidate));

    if (!filePath.startsWith(DIST_DIR)) {
      response.statusCode = 403;
      response.end("Forbidden");
      return;
    }

    try {
      const data = await readFile(filePath);
      response.setHeader("Content-Type", contentType(filePath));
      response.end(data);
      return;
    } catch {
      // Try the next clean URL candidate before returning 404.
    }
  }

  response.statusCode = 404;
  response.end("Not found");
}

function contentType(filePath) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[extname(filePath)] || "application/octet-stream"
  );
}
