export function sanitizeArticleHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;

  for (const element of [...template.content.querySelectorAll("script, style, iframe, object, embed")]) {
    element.remove();
  }

  for (const element of [...template.content.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if ((name === "href" || name === "src") && /^javascript:/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return template.innerHTML;
}

export function renderHighlights(articleRoot, annotations, onActivate) {
  for (const annotation of annotations) {
    wrapTextRange(articleRoot, annotation, onActivate);
  }
}

function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let offset = 0;
  let node = walker.nextNode();

  while (node) {
    const start = offset;
    const end = start + node.nodeValue.length;
    nodes.push({ node, start, end });
    offset = end;
    node = walker.nextNode();
  }

  return nodes;
}

function wrapTextRange(articleRoot, annotation, onActivate) {
  const textNodes = collectTextNodes(articleRoot);
  const startOffset = annotation.resolved?.startOffset ?? annotation.anchor.startOffset;
  const endOffset = annotation.resolved?.endOffset ?? annotation.anchor.endOffset;

  for (const item of textNodes) {
    if (item.end <= startOffset || item.start >= endOffset || !item.node.parentNode) continue;

    const localStart = Math.max(0, startOffset - item.start);
    const localEnd = Math.min(item.node.nodeValue.length, endOffset - item.start);
    const range = document.createRange();
    range.setStart(item.node, localStart);
    range.setEnd(item.node, localEnd);

    const span = document.createElement("span");
    span.className = "highlight";
    span.dataset.annotationId = annotation.id;
    span.style.backgroundColor = annotation.colorValue;
    span.title = annotation.note ? "Open note" : "Add note";
    span.addEventListener("click", (event) => {
      event.stopPropagation();
      onActivate(annotation.id);
    });

    range.surroundContents(span);
  }
}
