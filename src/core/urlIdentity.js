const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^igshid$/i,
  /^ref$/i,
  /^ref_src$/i
];

export function normalizeArticleUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))) {
      url.searchParams.delete(key);
    }
  }

  const normalizedPath = url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "/";
  url.pathname = normalizedPath;

  const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of params) {
    url.searchParams.append(key, value);
  }

  return url.toString();
}

export function deriveArticleIdentity({ pageUrl, canonicalUrl }) {
  const sourceUrl = canonicalUrl || pageUrl;
  if (!sourceUrl) {
    throw new Error("Cannot derive article identity without a URL.");
  }

  return normalizeArticleUrl(sourceUrl);
}

export function findCanonicalUrl(documentLike) {
  const canonical = documentLike.querySelector?.('link[rel~="canonical"]');
  const href = canonical?.getAttribute("href");
  if (!href) return null;

  try {
    return new URL(href, documentLike.location?.href).toString();
  } catch {
    return null;
  }
}
