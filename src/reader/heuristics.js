export function isImplicitHeadingText(text, normalized, titleVariants) {
  if (!normalized || BLOCKED_TOC_HEADINGS.has(normalized) || titleVariants.has(normalized)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 12 || text.length > 92) return false;
  if (/[.!?:;,]$/.test(text)) return false;
  const letterCount = (text.match(/[A-Za-z]/g) || []).length;
  if (letterCount < 8) return false;
  const startsLikeHeading = /^[A-Z0-9]/.test(text) || text === text.toUpperCase();
  return startsLikeHeading;
}

export function isStandaloneCodeParagraph(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 36) return false;
  if (looksLikeProse(trimmed, words)) return false;
  const hasCodePunctuation = /[{};=<>]/.test(trimmed);
  const hasCodeKeyword = /\b(function|const|let|var|class|import|return|SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/.test(trimmed);
  return (hasCodePunctuation && hasCodeKeyword) || isTerminalSnippet(trimmed);
}

function looksLikeProse(text, words = text.trim().split(/\s+/).filter(Boolean)) {
  if (words.length >= 18 && /[.!?]/.test(text)) return true;
  if (/^[A-Z][a-z]+\s+/.test(text) && /[.!?]$/.test(text)) return true;
  const sentenceBreaks = (text.match(/[.!?]\s+[A-Z]/g) || []).length;
  return sentenceBreaks >= 1 && words.length >= 12;
}

export function isTerminalSnippet(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 8) return false;
  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const joined = lines.join(" ");
  const flagCount = (joined.match(/(?:^|\s)-{1,2}[a-z][\w-]*(?:[=\s][^\s\\]+)?/gi) || []).length;
  const hasPrompt = lines.some((line) => /^(?:[$#>]\s+|\w+@[-\w.]+:[^$#>]+[$#]\s+)/.test(line));
  const hasContinuation = lines.length > 1 && lines.slice(0, -1).some((line) => /\\$/.test(line));
  const startsWithCommand = /^\s*(?:[\w./-]+(?:\.exe)?)(?:\s|$)/.test(trimmed) && flagCount >= 2;
  const startsWithFlags = /^\s*-{1,2}[a-z][\w-]*(?:\s|=)/i.test(trimmed) && flagCount >= 2;
  const hasShellOperators = /\s(?:&&|\|\||\||2>|>)\s/.test(joined);
  const hasEnvAssignment = /(?:^|\s)[A-Z_][A-Z0-9_]*=[^\s]+\s+\w/.test(joined);
  if (looksLikeProse(trimmed)) return false;
  return hasPrompt || hasContinuation || ((startsWithCommand || startsWithFlags) && (hasShellOperators || hasEnvAssignment || lines.length > 1));
}

const BLOCKED_TOC_HEADINGS = new Set([
  "comments",
  "discussion",
  "references",
  "related",
  "recommended",
  "share",
  "subscribe",
  "newsletter",
  "table of contents"
]);
