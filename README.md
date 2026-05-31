# OpenRead

OpenRead is a Manifest V3 browser extension that opens technical articles in a focused study reader with local highlights, notes, annotation filtering, and Markdown export.

## Development

```sh
npm install
npm test
npm run build
```

Create `.env` for the server-side OpenAI assist endpoint:

```sh
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.2
VITE_OPENREAD_ASSIST_ENDPOINT=/api/assist
```

For a deployed extension, set `VITE_OPENREAD_ASSIST_ENDPOINT` to your deployed `/api/assist` URL and configure `OPENAI_API_KEY` on the backend host. Do not expose the OpenAI key with a `VITE_` prefix.

Load the generated `dist/` directory as an unpacked extension in Chromium-based browsers.

## Current Slice

- Extension action opens an extension-owned reader tab.
- Article extraction is wrapped behind `extractArticleFromDocument` and uses Mozilla Readability.
- Reader workspace renders extracted article HTML, text-selection anchored highlights, margin notes, local persistence, filters, and Markdown export.
- Core URL, anchoring, annotation, storage, and export modules have Node tests.

## OpenAI Assist Backend

`api/assist.js` is a server-side endpoint for selected-text Translate and Explain. It expects `OPENAI_API_KEY` on the backend and calls OpenAI's Responses API.

Test your key/model with:

```sh
npm run assist:test
```

For local extension testing, run the backend and build/load the extension:

```sh
npm run build
npm run serve
```

When `VITE_OPENREAD_ASSIST_ENDPOINT=/api/assist`, extension pages call `http://127.0.0.1:8787/api/assist` during local testing.

For a packaged browser extension, build with the deployed API URL instead:

```sh
VITE_OPENREAD_ASSIST_ENDPOINT=https://your-domain.com/api/assist npm run build
```

Then load `dist/` as the unpacked extension.
