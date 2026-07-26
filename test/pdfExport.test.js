import test from "node:test";
import assert from "node:assert/strict";
import { createLectioPdfFilename, createPdfPageSlices, formatLectioExportDate } from "../src/reader/pdfExport.js";

test("formats the Lectio export date as a compact masthead date", () => {
  assert.equal(formatLectioExportDate(new Date(2026, 6, 24)), "24 JULY 2026");
});

test("creates a filesystem-safe dated Lectio PDF filename", () => {
  const filename = createLectioPdfFilename("BGP: ORIGIN / Path Selection?", new Date(2026, 6, 24));
  assert.equal(filename, "lectio-bgp-origin-path-selection-2026-07-24.pdf");
});

test("falls back to a useful filename when the title has no latin filename characters", () => {
  assert.equal(createLectioPdfFilename("東京", new Date(2026, 0, 2)), "lectio-article-2026-01-02.pdf");
});

test("splits a rendered article at the nearest safe block boundary", () => {
  assert.deepEqual(createPdfPageSlices(2400, 1000, [820, 1700, 2290]), [
    { start: 0, end: 820 },
    { start: 820, end: 1700 },
    { start: 1700, end: 2400 }
  ]);
});

test("uses a full page when a breakpoint would leave too much whitespace", () => {
  assert.deepEqual(createPdfPageSlices(1500, 1000, [400]), [
    { start: 0, end: 1000 }, { start: 1000, end: 1500 }
  ]);
});
