# OpenRead

OpenRead is a Chromium Manifest V3 extension that turns articles into a focused study reader. It extracts the page with Mozilla Readability, opens it in an extension-owned reader tab, and gives you tools for reading, annotating, searching, drawing, listening, and exporting.

The project also includes a small Node backend for optional account sync and OpenRouter-powered AI features.

## What You Get

- Clean reader view for technical articles and long-form pages.
- Highlights and margin notes anchored to selected text.
- Local annotation and drawing persistence through browser storage.
- Optional account login with file-backed note sync.
- Article search with keyboard shortcut support.
- Typography controls for text size, line height, and reading width.
- Light/dark reader theme.
- Drawing layer with pen, line, arrow, rectangle, ellipse, eraser, undo, redo, and color controls.
- Markdown export for notes and article context.
- Print/PDF export from the reader.
- Optional selected-text AI translate/explain through OpenRouter.
- Optional text-to-speech audio through OpenRouter.
- Public landing, pricing, privacy, and terms pages built with Vite.

## Requirements

- Node.js 20 or newer recommended.
- npm.
- A Chromium-based browser such as Chrome, Brave, Edge, or Arc.
- Optional: an OpenRouter API key for translate, explain, and speech.

## Quick Start

Install dependencies, run tests, and build the extension:

```sh
npm install
npm test
npm run build
```

Load the extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select the generated `dist/` folder.
5. Open an article page and click the OpenRead extension button.

## Local Backend

The backend serves built files from `dist/`, handles optional auth/note sync, and proxies OpenRouter requests for AI features.

Build first, then start the server:

```sh
npm run build
npm run serve
```

By default the server runs at:

```text
http://127.0.0.1:8787
```

Available local routes include:

- `/` for the landing page.
- `/pricing`, `/privacy`, and `/terms`.
- `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, and `/api/me`.
- `/api/notes` for synced notes.
- `/api/assist` for selected-text translate/explain.
- `/api/speech` for article audio.

The file-backed backend stores account and note data in `data/openread.json` by default. Set `OPENREAD_DATA_FILE` if you want to use a different path.

## Environment

Copy the example file if you want the optional backend features:

```sh
cp .env.example .env
```

Then edit `.env` with your own values:

```sh
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=deepseek/deepseek-v4-flash
OPENROUTER_TTS_MODEL=hexgrad/kokoro-82m
OPENROUTER_TTS_VOICE=af_nova
OPENREAD_ALLOWED_ORIGIN=*
OPENREAD_DATA_FILE=data/openread.json
VITE_OPENREAD_ASSIST_ENDPOINT=/api/assist
VITE_OPENREAD_SPEECH_ENDPOINT=/api/speech
```

Do not expose `OPENROUTER_API_KEY` through a `VITE_` variable. `VITE_` variables are bundled into browser code.

Test your OpenRouter setup with:

```sh
npm run assist:test
```

## Extension Configuration

For local extension testing with the bundled backend, keep:

```sh
VITE_OPENREAD_ASSIST_ENDPOINT=/api/assist
VITE_OPENREAD_SPEECH_ENDPOINT=/api/speech
```

When loaded as an unpacked extension, relative API paths are resolved to the local backend at `http://127.0.0.1:8787`.

For a public build, point the extension at your deployed backend:

```sh
VITE_OPENREAD_ASSIST_ENDPOINT=https://your-domain.com/api/assist \
VITE_OPENREAD_SPEECH_ENDPOINT=https://your-domain.com/api/speech \
npm run build
```

Then load or package the generated `dist/` directory.

## Scripts

```sh
npm run build        # Build landing pages, reader, and extension assets into dist/
npm run serve        # Serve dist/ and local API routes on 127.0.0.1:8787
npm test             # Run the Node test suite
npm run assist:test  # Test the OpenRouter assist endpoint configuration
```

## Project Structure

```text
api/                 Node API handlers for auth, notes, assist, and speech
public/              Manifest V3 extension manifest
src/core/            Article extraction, annotations, anchors, storage, export
src/extension/       Extension background service worker and content script
src/landing/         Public website JavaScript and CSS
src/reader/          Reader UI, DOM rendering, heuristics, and styles
test/                Node tests for core behavior and backend routes
server.js            Local Node server for dist/ and API routes
vite.config.js       Multi-entry Vite build for pages and extension assets
```

## Current Limits

- OpenRead is currently built for Chromium-based browsers.
- The backend storage is a simple JSON file, suitable for local use and demos, not production multi-user hosting.
- The extension asks for broad host access so it can extract articles from many sites.
- Some pages cannot be extracted because of site restrictions, login walls, dynamic rendering, or browser extension limitations.
- AI translate, explain, and speech require a server-side OpenRouter API key.

## License

No license has been added yet. Add one before publishing if you want others to know how they can use, modify, and redistribute the project.
