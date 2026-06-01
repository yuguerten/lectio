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

  removeUnwantedArticleAsides(template.content);

  return template.innerHTML;
}

const UNWANTED_ARTICLE_TEXT = [
  "i’ve recieved feedback that some of the previous posts were too high level",
  "i've recieved feedback that some of the previous posts were too high level",
  "if you’re a tech worker, or a linux enthusiast",
  "if you're a tech worker, or a linux enthusiast",
  "graph layout.",
  "i’ve tried my best to keep this easy to understand",
  "i've tried my best to keep this easy to understand",
  "this part is just plain hard to make explain in a single blog post"
];

function removeUnwantedArticleAsides(root) {
  for (const element of [...root.querySelectorAll("p, h1, h2, h3, h4, h5, h6, blockquote")]) {
    const normalized = (element.textContent || "").trim().toLowerCase();
    if (UNWANTED_ARTICLE_TEXT.some((phrase) => normalized.includes(phrase))) {
      element.remove();
    }
  }
}

export function renderHighlights(articleRoot, annotations, onActivate) {
  for (const annotation of annotations) {
    wrapTextRange(articleRoot, annotation, onActivate);
  }
}

export function renderSearchHighlights(articleRoot, query) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return 0;

  let matchCount = 0;
  const needle = normalizedQuery.toLowerCase();
  const walker = document.createTreeWalker(articleRoot, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("button, textarea, input, select, .comment-marker")) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue.toLowerCase().includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes = [];
  let node = walker.nextNode();

  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }

  for (const textNode of nodes) {
    const text = textNode.nodeValue;
    const lowerText = text.toLowerCase();
    const ranges = [];
    let start = lowerText.indexOf(needle);
    while (start !== -1) {
      ranges.push([start, start + normalizedQuery.length]);
      start = lowerText.indexOf(needle, start + Math.max(1, normalizedQuery.length));
    }

    for (const [rangeStart, rangeEnd] of ranges.reverse()) {
      const range = document.createRange();
      range.setStart(textNode, rangeStart);
      range.setEnd(textNode, rangeEnd);
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      range.surroundContents(mark);
    }
    matchCount += ranges.length;
  }

  [...articleRoot.querySelectorAll(".search-hit")].forEach((mark, index) => {
    mark.dataset.searchIndex = String(index);
  });
  return matchCount;
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
  let lastSpan = null;

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
    span.title = annotation.type === "note" ? "Open comment" : "Add comment";
    span.addEventListener("click", (event) => {
      event.stopPropagation();
      onActivate(annotation.id, span);
    });

    range.surroundContents(span);
    lastSpan = span;
  }

  if (annotation.type === "note" && lastSpan?.parentNode) {
    const marker = document.createElement("button");
    marker.className = "comment-marker";
    marker.type = "button";
    marker.dataset.annotationId = annotation.id;
    marker.title = "Open comment";
    marker.setAttribute("aria-label", "Open comment");
    marker.innerHTML = commentIcon();
    marker.addEventListener("mousedown", (event) => event.preventDefault());
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      onActivate(annotation.id, marker);
    });
    lastSpan.after(marker);
  }
}

function commentIcon() {
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-5 4V7a2 2 0 0 1 2-2Z"/></svg>';
}
