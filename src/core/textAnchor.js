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

  const range = selection.getRangeAt(0);
  if (!articleRoot.contains(range.commonAncestorContainer)) return null;

  const articleText = articleRoot.textContent || "";
  const selectedText = selection.toString();
  const selectionRange = range.cloneRange();
  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(articleRoot);
  beforeRange.setEnd(selectionRange.startContainer, selectionRange.startOffset);

  const startOffset = beforeRange.toString().length;
  const endOffset = startOffset + selectedText.length;
  return createAnchorFromOffsets(articleText, startOffset, endOffset, findBlockIndex(articleRoot, range));
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
