const CONTEXT_LENGTH = 48;

export function createAnchorFromOffsets(articleText, startOffset, endOffset, blockIndex = 0) {
  if (startOffset < 0 || endOffset <= startOffset || endOffset > articleText.length) {
    throw new Error("Invalid anchor offsets.");
  }

  return {
    exact: articleText.slice(startOffset, endOffset),
    prefix: articleText.slice(Math.max(0, startOffset - CONTEXT_LENGTH), startOffset),
    suffix: articleText.slice(endOffset, Math.min(articleText.length, endOffset + CONTEXT_LENGTH)),
    startOffset,
    endOffset,
    blockIndex
  };
}

export function createAnchorFromSelection(articleRoot, selection) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = normalizeSelectionRange(articleRoot, selection.getRangeAt(0));
  if (!articleRoot.contains(range.commonAncestorContainer)) return null;

  const articleText = articleRoot.textContent || "";
  const selectedText = range.toString();
  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(articleRoot);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const startOffset = beforeRange.toString().length;
  const endOffset = startOffset + selectedText.length;
  return createAnchorFromOffsets(articleText, startOffset, endOffset, findBlockIndex(articleRoot, range));
}

function normalizeSelectionRange(articleRoot, sourceRange) {
  const range = sourceRange.cloneRange();
  trimRangeWhitespace(range);
  trimAccidentalTrailingBlockFragment(articleRoot, range);
  trimRangeWhitespace(range);
  return range;
}

function trimRangeWhitespace(range) {
  trimRangeStartWhitespace(range);
  trimRangeEndWhitespace(range);
}

function trimRangeStartWhitespace(range) {
  while (!range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = range.startContainer.nodeValue || "";
    const nextOffset = text.slice(range.startOffset).search(/\S/);
    if (nextOffset > 0) range.setStart(range.startContainer, range.startOffset + nextOffset);
    break;
  }
}

function trimRangeEndWhitespace(range) {
  while (!range.collapsed && range.endContainer.nodeType === Node.TEXT_NODE) {
    const text = range.endContainer.nodeValue || "";
    const selected = text.slice(0, range.endOffset);
    const trimmedLength = selected.replace(/\s+$/, "").length;
    if (trimmedLength < range.endOffset) range.setEnd(range.endContainer, trimmedLength);
    break;
  }
}

function trimAccidentalTrailingBlockFragment(articleRoot, range) {
  const startBlock = closestTextBlock(articleRoot, range.startContainer);
  const endBlock = closestTextBlock(articleRoot, range.endContainer);
  if (!startBlock || !endBlock || startBlock === endBlock) return;

  const endFragmentRange = range.cloneRange();
  endFragmentRange.selectNodeContents(endBlock);
  endFragmentRange.setEnd(range.endContainer, range.endOffset);
  const endFragment = endFragmentRange.toString().trim();
  if (!endFragment || endFragment.length > 4 || /\s/.test(endFragment)) return;

  range.setEndBefore(endBlock);
}

function closestTextBlock(articleRoot, node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const block = element?.closest?.("p, li, pre, blockquote, h1, h2, h3, h4, h5, h6");
  return block && articleRoot.contains(block) ? block : null;
}

export function resolveAnchor(articleText, anchor) {
  if (!anchor?.exact) return null;

  const direct = articleText.slice(anchor.startOffset, anchor.endOffset);
  if (direct === anchor.exact) {
    return {
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      exact: anchor.exact,
      confidence: "exact-offset"
    };
  }

  const candidates = findAllOccurrences(articleText, anchor.exact);
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((startOffset) => {
      const endOffset = startOffset + anchor.exact.length;
      return {
        startOffset,
        endOffset,
        exact: anchor.exact,
        confidence: scoreContext(articleText, anchor, startOffset, endOffset)
      };
    })
    .sort((a, b) => b.confidence.score - a.confidence.score);

  const best = ranked[0];
  if (best.confidence.score === 0 && candidates.length > 1) return null;

  return {
    startOffset: best.startOffset,
    endOffset: best.endOffset,
    exact: best.exact,
    confidence: best.confidence.label
  };
}

export function findAllOccurrences(text, exact) {
  const starts = [];
  let cursor = text.indexOf(exact);
  while (cursor !== -1) {
    starts.push(cursor);
    cursor = text.indexOf(exact, cursor + Math.max(1, exact.length));
  }
  return starts;
}

function scoreContext(articleText, anchor, startOffset, endOffset) {
  const before = articleText.slice(Math.max(0, startOffset - CONTEXT_LENGTH), startOffset);
  const after = articleText.slice(endOffset, Math.min(articleText.length, endOffset + CONTEXT_LENGTH));
  let score = 0;

  if (anchor.prefix && before.endsWith(anchor.prefix.slice(-Math.min(24, anchor.prefix.length)))) {
    score += 2;
  }
  if (anchor.suffix && after.startsWith(anchor.suffix.slice(0, Math.min(24, anchor.suffix.length)))) {
    score += 2;
  }

  const distance = Math.abs(startOffset - anchor.startOffset);
  if (distance < 12) score += 1;

  return {
    score,
    label: score >= 4 ? "context" : score > 0 ? "fuzzy-context" : "quote-only"
  };
}

function findBlockIndex(articleRoot, range) {
  const blocks = [...articleRoot.querySelectorAll("p, li, pre, blockquote, h1, h2, h3, h4, h5, h6")];
  const block = blocks.find((candidate) => candidate.contains(range.commonAncestorContainer));
  return block ? blocks.indexOf(block) : 0;
}
