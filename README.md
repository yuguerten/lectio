# OpenRead

OpenRead is a Manifest V3 browser extension that opens technical articles in a focused study reader with local highlights, notes, annotation filtering, and Markdown export.

## Development

```sh
npm install
npm test
npm run build
```

Load the generated `dist/` directory as an unpacked extension in Chromium-based browsers.

## Current Slice

- Extension action opens an extension-owned reader tab.
- Article extraction is wrapped behind `extractArticleFromDocument` and uses Mozilla Readability.
- Reader workspace renders extracted article HTML, text-selection anchored highlights, margin notes, local persistence, filters, and Markdown export.
- Core URL, anchoring, annotation, storage, and export modules have Node tests.
