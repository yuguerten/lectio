export function sanitizeArticleHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;

  for (const element of [...template.content.querySelectorAll("script, style, object, embed, form")]) {
    element.remove();
  }

  for (const iframe of [...template.content.querySelectorAll("iframe")]) {
    if (isAllowedInteractiveIframe(iframe)) {
      sanitizeInteractiveIframe(iframe);
    } else {
      iframe.remove();
    }
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

export function enhanceArticleTables(articleRoot) {
  if (!articleRoot) return;

  for (const table of articleRoot.querySelectorAll("table")) {
    if (!table.parentNode || table.closest(".article-table-scroll")) continue;
    const caption = (table.querySelector("caption")?.textContent || "").replace(/\s+/g, " ").trim();
    const label = caption || table.getAttribute?.("aria-label") || "Scrollable data table";
    const wrapper = document.createElement("div");
    wrapper.className = "article-table-scroll";
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("tabindex", "0");
    wrapper.setAttribute("aria-label", label);
    table.parentNode.insertBefore(wrapper, table);
    wrapper.append(table);
  }
}

function isAllowedInteractiveIframe(iframe) {
  const src = iframe.getAttribute("src") || "";
  return Boolean(iframe.closest(".lectio-interactive-plot") && iframe.hasAttribute("data-lectio-interactive-iframe") && /^https?:\/\//i.test(src));
}

function sanitizeInteractiveIframe(iframe) {
  const allowed = new Set(["allow", "class", "data-lectio-interactive-iframe", "height", "loading", "referrerpolicy", "sandbox", "src", "title", "width"]);
  for (const attribute of [...iframe.attributes]) {
    if (!allowed.has(attribute.name.toLowerCase())) iframe.removeAttribute(attribute.name);
  }
  iframe.setAttribute("loading", "lazy");
  iframe.setAttribute("referrerpolicy", iframe.getAttribute("referrerpolicy") || "no-referrer-when-downgrade");
  iframe.setAttribute("sandbox", iframe.getAttribute("sandbox") || "allow-scripts allow-same-origin allow-popups allow-forms");
}

const UNWANTED_ARTICLE_TEXT = [
  "i’ve recieved feedback that some of the previous posts were too high level",
  "i've recieved feedback that some of the previous posts were too high level",
  "if you’re a tech worker, or a linux enthusiast",
  "if you're a tech worker, or a linux enthusiast",
  "graph layout.",
  "i’ve tried my best to keep this easy to understand",
  "i've tried my best to keep this easy to understand",
  "this part is just plain hard to make explain in a single blog post",
  "thanks for reading",
  "subscribe for free to receive new posts"
];

function removeUnwantedArticleAsides(root) {
  for (const element of [...root.querySelectorAll("p, h1, h2, h3, h4, h5, h6, blockquote, div, section")]) {
    const normalized = (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized || normalized.length > 260) continue;
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

const LISTEN_SKIP_SELECTOR = "button, textarea, input, select, .comment-marker, .listen-popover, .lectio-interactive-plot, script, style";

export function getListenText(articleRoot) {
  return collectListenTextNodes(articleRoot).map((node) => node.nodeValue).join("");
}

export function wrapListenSegments(articleRoot, segments) {
  if (!articleRoot) return false;
  if (!Array.isArray(segments) || segments.length === 0) {
    unwrapListenSegments(articleRoot);
    return true;
  }
  unwrapListenSegments(articleRoot);

  const textNodes = collectListenTextNodes(articleRoot);
  let nodeStart = 0;
  let segmentIndex = 0;

  for (const textNode of textNodes) {
    const nodeText = textNode.nodeValue || "";
    const nodeEnd = nodeStart + nodeText.length;
    const wraps = [];

    while (segmentIndex < segments.length && segments[segmentIndex].charEnd <= nodeStart) {
      segmentIndex += 1;
    }

    for (let i = segmentIndex; i < segments.length; i += 1) {
      const segment = segments[i];
      if (segment.charStart >= nodeEnd) break;
      const start = Math.max(segment.charStart - nodeStart, 0);
      const end = Math.min(segment.charEnd - nodeStart, nodeText.length);
      if (end > start) wraps.push({ start, end, index: i });
    }

    for (let i = wraps.length - 1; i >= 0; i -= 1) {
      const wrap = wraps[i];
      const range = document.createRange();
      range.setStart(textNode, wrap.start);
      range.setEnd(textNode, wrap.end);
      const span = document.createElement("span");
      span.className = "listen-segment";
      span.dataset.segmentIndex = String(wrap.index);
      range.surroundContents(span);
    }

    nodeStart = nodeEnd;
  }

  return articleRoot.querySelectorAll(".listen-segment").length > 0;
}

export function unwrapListenSegments(articleRoot) {
  if (!articleRoot) return;
  const spans = [...articleRoot.querySelectorAll(".listen-segment")];
  for (const span of spans) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parent.normalize?.();
  }
}

let activeListenSegmentIndex = -1;
let lastScrolledSegmentIndex = -1;

export function setActiveListenSegment(index, options = {}) {
  const { scroll = true, scrollMargin = 120 } = options;
  if (typeof index !== "number" || index < 0) {
    clearActiveListenSegment();
    return;
  }
  const nextSegments = [...document.querySelectorAll(`.listen-segment[data-segment-index="${index}"]`)];
  if (nextSegments.length === 0) {
    clearActiveListenSegment();
    return;
  }
  const alreadyActive = index === activeListenSegmentIndex && nextSegments.every((element) => element.classList.contains("is-speaking"));
  if (!alreadyActive) {
    document.querySelectorAll(".listen-segment.is-speaking").forEach((element) => element.classList.remove("is-speaking"));
    nextSegments.forEach((element) => element.classList.add("is-speaking"));
    activeListenSegmentIndex = index;
  }
  if (scroll && index !== lastScrolledSegmentIndex && !isSegmentNearReadableViewport(nextSegments, scrollMargin)) {
    scrollSegmentIntoReadableViewport(nextSegments, scrollMargin);
    lastScrolledSegmentIndex = index;
  }
}

export function clearActiveListenSegment() {
  document.querySelectorAll(".listen-segment.is-speaking").forEach((element) => element.classList.remove("is-speaking"));
  activeListenSegmentIndex = -1;
}

export function resetListenScrollTracking() {
  lastScrolledSegmentIndex = -1;
}

function collectListenTextNodes(articleRoot) {
  if (!articleRoot) return [];
  const blockSelector = "p, li, h1, h2, h3, h4, h5, h6, pre, td, th";
  const candidates = [...articleRoot.querySelectorAll(blockSelector)].filter((element) => !element.closest(LISTEN_SKIP_SELECTOR));
  const blocks = candidates.length ? candidates : [articleRoot];
  const nodes = [];
  const seenBlocks = new Set();

  for (const block of blocks) {
    const normalized = normalizeListenBlockText(block.textContent || "");
    if (!normalized || seenBlocks.has(normalized)) continue;
    seenBlocks.add(normalized);
    nodes.push(...collectListenTextNodesInBlock(block));
  }

  return nodes;
}

function collectListenTextNodesInBlock(block) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(LISTEN_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function normalizeListenBlockText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isSegmentNearReadableViewport(elements, margin) {
  const rect = getSegmentRect(elements);
  if (!rect) return true;
  const { top, bottom } = getReadableViewportBounds(margin);
  return rect.top >= top && rect.bottom <= bottom;
}

function scrollSegmentIntoReadableViewport(elements, margin) {
  const rect = getSegmentRect(elements);
  if (!rect) return;
  const { top, bottom } = getReadableViewportBounds(margin);
  if (rect.bottom > bottom) {
    window.scrollBy({ top: rect.bottom - bottom, behavior: "smooth" });
    return;
  }
  if (rect.top < top) {
    window.scrollBy({ top: rect.top - top, behavior: "smooth" });
  }
}

function getSegmentRect(elements) {
  const rects = elements.map((element) => element.getBoundingClientRect?.()).filter(Boolean);
  if (rects.length === 0) return null;
  return rects.reduce(
    (acc, rect) => ({
      top: Math.min(acc.top, rect.top),
      right: Math.max(acc.right, rect.right),
      bottom: Math.max(acc.bottom, rect.bottom),
      left: Math.min(acc.left, rect.left)
    }),
    { top: Infinity, right: -Infinity, bottom: -Infinity, left: Infinity }
  );
}

function getReadableViewportBounds(margin) {
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const player = document.querySelector(".listen-popover.is-visible");
  const playerRect = player?.getBoundingClientRect?.();
  const dockSpace = playerRect && playerRect.height > 0 ? viewportHeight - playerRect.top + 20 : 0;
  return {
    top: margin,
    bottom: Math.max(margin + 80, viewportHeight - dockSpace - margin)
  };
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
