const ACCESS_BARRIER_PATTERNS = [
  /(?:disable|turn off|pause|whitelist|allow).{0,80}(?:ad[ -]?block(?:er)?|content blocker)/i,
  /(?:ad[ -]?block(?:er)?|content blocker).{0,80}(?:detected|enabled|not allowed|isn't allowed|is not allowed)/i,
  /support us.{0,80}(?:allowing|enable).{0,40}ads/i
];

export function isAccessBarrierText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > 0 && ACCESS_BARRIER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function scoreArticleCandidate(article) {
  if (!article) return Number.NEGATIVE_INFINITY;
  const text = String(article.text || "").trim();
  if (!text) return Number.NEGATIVE_INFINITY;
  const blockCount = (String(article.html || "").match(/<(?:p|h[1-6]|li|blockquote|pre|table)\b/gi) || []).length;
  const structureBonus = Math.min(300, blockCount * 10);
  const barrierPenalty = isAccessBarrierText(`${article.title || ""} ${article.excerpt || ""} ${text}`) ? Math.min(1400, Math.max(300, text.length * 0.35)) : 0;
  return text.length + structureBonus - barrierPenalty;
}

export function chooseBetterArticleCandidate(current, candidate) {
  if (!candidate) return current || null;
  if (!current) return candidate;
  if (current.id && candidate.id && current.id !== candidate.id) return candidate;
  if ((!current.id || !candidate.id) && current.pageUrl && candidate.pageUrl && current.pageUrl !== candidate.pageUrl) return candidate;
  return scoreArticleCandidate(candidate) > scoreArticleCandidate(current) + 40 ? candidate : current;
}
