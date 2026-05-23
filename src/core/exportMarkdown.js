export function generateMarkdownExport(article, annotations) {
  const sorted = [...annotations].sort((a, b) => a.anchor.startOffset - b.anchor.startOffset);
  const lines = [`# ${article.title || "Untitled article"}`, ""];

  if (article.url) {
    lines.push(`Source: ${article.url}`, "");
  }

  for (const annotation of sorted) {
    const color = annotation.color ? ` (${annotation.color})` : "";
    lines.push(`## ${annotation.type === "note" ? "Note" : "Highlight"}${color}`);
    lines.push("");
    lines.push(blockquote(annotation.anchor.exact));
    if (annotation.note?.trim()) {
      lines.push("");
      lines.push(annotation.note.trim());
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function blockquote(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}
