const DEFAULT_TITLE = "Lectio article";

export function formatLectioExportDate(date = new Date()) {
  const value = validDate(date);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  })
    .format(value)
    .toUpperCase();
}

export function createLectioPdfFilename(title, date = new Date()) {
  const value = validDate(date);
  const dateStamp = [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
  const slug = String(title || DEFAULT_TITLE)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);

  return `lectio-${slug || "article"}-${dateStamp}.pdf`;
}

export function createPdfPageSlices(totalHeight, pageHeight, breakpoints = [], minimumFillRatio = 0.68) {
  if (!(totalHeight > 0) || !(pageHeight > 0)) return [];
  const safeBreaks = [...new Set(breakpoints)]
    .filter((point) => Number.isFinite(point) && point > 0 && point < totalHeight)
    .sort((a, b) => a - b);
  const slices = [];
  let start = 0;

  while (start < totalHeight) {
    const idealEnd = Math.min(totalHeight, start + pageHeight);
    let end = idealEnd;
    if (idealEnd < totalHeight) {
      const minimumEnd = start + pageHeight * minimumFillRatio;
      const candidates = safeBreaks.filter((point) => point >= minimumEnd && point <= idealEnd);
      if (candidates.length) end = candidates.at(-1);
    }
    if (end <= start) end = Math.min(totalHeight, start + pageHeight);
    slices.push({ start: Math.round(start), end: Math.round(end) });
    start = end;
  }

  return slices;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
