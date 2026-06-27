import { Readability } from "@mozilla/readability";
import { deriveArticleIdentity, findCanonicalUrl } from "./urlIdentity.js";

export function extractArticleFromDocument(documentLike, pageUrl = documentLike.location?.href) {
  const canonicalUrl = findCanonicalUrl(documentLike);
  const articleId = deriveArticleIdentity({ pageUrl, canonicalUrl });
  const interactivePlots = detectInteractivePlots(documentLike);
  const clone = documentLike.cloneNode(true);
  const readable = new Readability(clone).parse();

  if (!readable?.content || !readable?.textContent?.trim()) {
    throw new Error("Readability could not extract usable article content.");
  }

  return {
    id: articleId,
    title: readable.title || documentLike.title || "Untitled article",
    url: articleId,
    pageUrl,
    canonicalUrl,
    html: withInteractivePlots(readable.content, interactivePlots, { documentLike }),
    text: normalizeExtractedText(readable.textContent),
    excerpt: readable.excerpt || "",
    byline: readable.byline || "",
    siteName: readable.siteName || ""
  };
}

export function normalizeExtractedText(text) {
  return text.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const INTERACTIVE_PLOT_SELECTORS = [
  ".js-plotly-plot",
  ".plotly-graph-div",
  ".plot-container",
  ".svg-container",
  ".main-svg",
  ".modebar",
  "[data-plotly]",
  "[data-plotly-id]",
  "[data-plotly-plot]",
  ".plotty",
  "[data-plotty]",
  "[data-plotty-plot]",
  "iframe",
  "canvas",
  "svg"
];

export function detectInteractivePlots(documentLike) {
  const candidates = [...(documentLike.querySelectorAll?.(INTERACTIVE_PLOT_SELECTORS.join(",")) || [])];
  const plots = [];
  const seen = new Set();
  const seenCaptions = new Set();

  for (const element of candidates) {
    const plotElement = resolveInteractivePlotElement(element);
    const type = detectInteractivePlotType(plotElement) || detectInteractivePlotType(element);
    if (!type) continue;
    const html = serializeInteractivePlot(plotElement, { documentLike, type });
    if (!html) continue;
    const key = plotElement.id || html || normalizePlotText(plotElement.textContent || "") || String(plots.length);
    if (seen.has(key)) continue;
    seen.add(key);

    const caption = findPlotCaption(plotElement) || findPlotCaption(element);
    if (caption) seenCaptions.add(normalizePlotText(caption).toLowerCase());
    plots.push({
      type,
      label: "Interactive chart",
      html,
      size: measureInteractivePlot(plotElement),
      caption,
      title: caption || plotElement.getAttribute?.("aria-label") || plotElement.getAttribute?.("title") || ""
    });
  }

  for (const { caption, element } of findInteractivePlotCaptions(documentLike)) {
    const normalized = normalizePlotText(caption).toLowerCase();
    if (seenCaptions.has(normalized)) continue;
    seenCaptions.add(normalized);
    const captionlessPlot = plots.find((plot) => !plot.caption);
    if (captionlessPlot) {
      captionlessPlot.caption = caption;
      captionlessPlot.title = caption;
      continue;
    }
    const nearbyPlot = findPlotElementNearCaption(element);
    const type = nearbyPlot ? detectInteractivePlotType(nearbyPlot) || "interactive" : "caption";
    const html = nearbyPlot ? serializeInteractivePlot(nearbyPlot, { documentLike, type }) : "";
    plots.push({
      type,
      label: "Interactive chart",
      html,
      size: nearbyPlot ? measureInteractivePlot(nearbyPlot) : null,
      caption,
      title: caption
    });
  }

  return plots;
}

function resolveInteractivePlotElement(element) {
  if (!element?.closest) return element;
  if (/^(iframe|canvas)$/i.test(element.tagName || "")) return element;
  return (
    element.closest(".js-plotly-plot, .plotly-graph-div, [data-plotly], [data-plotly-id], [data-plotly-plot], .plotty, [data-plotty], [data-plotty-plot]") ||
    element.closest("figure") ||
    element
  );
}

function detectInteractivePlotType(element) {
  if (!element || /^(script|style)$/i.test(element.tagName || "")) return false;
  if (element.classList?.contains("plotty") || element.getAttribute?.("data-plotty") || element.getAttribute?.("data-plotty-plot")) return "plotty";
  if (element.classList?.contains("js-plotly-plot") || element.classList?.contains("plotly-graph-div")) return "plotly";
  if (element.classList?.contains("plot-container") || element.classList?.contains("svg-container") || element.classList?.contains("main-svg") || element.classList?.contains("modebar")) return "plotly";
  if (element.getAttribute?.("data-plotly") || element.getAttribute?.("data-plotly-id") || element.getAttribute?.("data-plotly-plot")) return "plotly";
  if (element.querySelector?.(".plot-container, .svg-container, .main-svg, .modebar")) return "plotly";
  if (/^(iframe|canvas|svg)$/i.test(element.tagName || "") && hasInteractivePlotSignal(element)) return "interactive";
  return false;
}

function findPlotCaption(element) {
  const figureCaption = element.closest?.("figure")?.querySelector?.("figcaption");
  const caption = normalizePlotText(figureCaption?.textContent || "");
  if (caption) return caption;

  const block = element.closest?.("figure, p, div, section") || element;
  for (const candidate of [element.nextElementSibling, block.nextElementSibling]) {
    if (!candidate || !/^(figcaption|p|small)$/i.test(candidate.tagName || "")) continue;
    const text = normalizePlotText(candidate.textContent || "");
    if (text && text.length <= 320) return text;
  }

  return "";
}

function findInteractivePlotCaptions(documentLike) {
  const captions = [];
  for (const element of [...(documentLike.querySelectorAll?.("figcaption, p, small") || [])]) {
    const text = normalizePlotText(element.textContent || "");
    if (isInteractivePlotCaption(text)) captions.push({ caption: text, element });
  }
  return captions;
}

function findPlotElementNearCaption(captionElement) {
  if (!captionElement) return null;
  for (const candidate of [captionElement.previousElementSibling, captionElement.parentElement?.previousElementSibling]) {
    if (!candidate) continue;
    const plotElement = resolveInteractivePlotElement(candidate);
    if (detectInteractivePlotType(plotElement) || plotElement.querySelector?.("iframe, canvas, svg, .js-plotly-plot, .plotly-graph-div")) {
      return plotElement;
    }
  }
  return null;
}

function hasInteractivePlotSignal(element) {
  const text = [
    element.id,
    element.className,
    element.getAttribute?.("src"),
    element.getAttribute?.("title"),
    element.getAttribute?.("aria-label"),
    findPlotCaption(element)
  ]
    .map((value) => normalizePlotText(value))
    .filter(Boolean)
    .join(" ");
  return /\b(plotly|plotty|observable|chart|graph|plot)\b/i.test(text) || isInteractivePlotCaption(text);
}

function isInteractivePlotCaption(text) {
  const normalized = normalizePlotText(text);
  return normalized.length > 0 && normalized.length <= 360 && /\binteractive\s+(plot|chart|graph|visuali[sz]ation)\b/i.test(normalized);
}

function withInteractivePlots(html, plots, { documentLike } = {}) {
  if (!plots.length || !documentLike?.createElement) return html;
  const template = documentLike.createElement("template");
  template.innerHTML = html;

  for (const plot of plots) {
    if (!plot.html) continue;
    const embed = createInteractivePlotEmbed(documentLike, plot);
    const target = plot.caption ? findCaptionMatch(template.content, plot.caption) : null;
    if (target) {
      target.before(embed);
    } else {
      template.content.insertBefore(embed, template.content.firstChild);
    }
  }

  return template.innerHTML;
}

function createInteractivePlotEmbed(documentLike, plot) {
  const figure = documentLike.createElement("figure");
  figure.className = "lectio-interactive-plot";
  figure.setAttribute("data-plot-type", plot.type);
  if (plot.size?.width) figure.style.setProperty("--lectio-plot-width", `${plot.size.width}px`);
  if (plot.size?.height) figure.style.setProperty("--lectio-plot-height", `${plot.size.height}px`);

  const frame = documentLike.createElement("div");
  frame.className = "lectio-interactive-plot-frame";
  frame.innerHTML = plot.html;
  figure.append(frame);

  return figure;
}

function findCaptionMatch(root, caption) {
  const needle = normalizePlotText(caption).slice(0, 180).toLowerCase();
  if (!needle) return null;
  return [...root.querySelectorAll("figcaption, p, small")].find((element) => normalizePlotText(element.textContent || "").toLowerCase().includes(needle));
}

function normalizePlotText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function serializeInteractivePlot(element, { documentLike, type } = {}) {
  if (!element) return "";
  if (/^iframe$/i.test(element.tagName || "")) return serializeInteractiveIframe(element, documentLike);
  if (/^canvas$/i.test(element.tagName || "")) return serializeCanvasSnapshot(element, documentLike);

  const clone = element.cloneNode?.(true);
  if (!clone?.outerHTML) return "";
  cleanInteractivePlotClone(clone);
  clone.classList?.add("lectio-preserved-plot");
  clone.setAttribute?.("data-lectio-plot-type", type || "interactive");
  return clone.outerHTML;
}

function serializeInteractiveIframe(iframe, documentLike) {
  const src = safeUrl(iframe.src || iframe.getAttribute?.("src"), documentLike?.location?.href);
  if (!src || !documentLike?.createElement) return "";
  const size = measureInteractivePlot(iframe);
  const clone = documentLike.createElement("iframe");
  clone.src = src;
  clone.title = iframe.getAttribute?.("title") || iframe.getAttribute?.("aria-label") || "Interactive chart";
  clone.loading = "lazy";
  clone.referrerPolicy = "no-referrer-when-downgrade";
  clone.setAttribute("data-lectio-interactive-iframe", "true");
  clone.setAttribute("allow", iframe.getAttribute?.("allow") || "fullscreen");
  clone.setAttribute("sandbox", iframe.getAttribute?.("sandbox") || "allow-scripts allow-same-origin allow-popups allow-forms");
  clone.width = size.width ? String(size.width) : iframe.getAttribute?.("width") || "100%";
  clone.height = size.height ? String(size.height) : iframe.getAttribute?.("height") || "760";
  return clone.outerHTML;
}

function serializeCanvasSnapshot(canvas, documentLike) {
  if (!documentLike?.createElement || typeof canvas.toDataURL !== "function") return "";
  try {
    const image = documentLike.createElement("img");
    image.src = canvas.toDataURL("image/png");
    image.alt = canvas.getAttribute?.("aria-label") || canvas.getAttribute?.("title") || "Interactive chart";
    image.className = "lectio-preserved-plot";
    return image.outerHTML;
  } catch {
    return "";
  }
}

function cleanInteractivePlotClone(root) {
  for (const element of [root, ...(root.querySelectorAll?.("*") || [])]) {
    if (/^(script|style)$/i.test(element.tagName || "")) {
      element.remove();
      continue;
    }
    for (const attribute of [...(element.attributes || [])]) {
      const name = attribute.name.toLowerCase();
      const value = String(attribute.value || "").trim();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if ((name === "href" || name === "src") && /^javascript:/i.test(value)) element.removeAttribute(attribute.name);
    }
  }
}

function safeUrl(value, baseUrl) {
  try {
    const url = new URL(String(value || ""), baseUrl || "https://example.invalid");
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function measureInteractivePlot(element) {
  const rect = element?.getBoundingClientRect?.();
  const width = positiveNumber(rect?.width) || positiveNumber(element?.getAttribute?.("width")) || positiveNumber(element?.style?.width);
  const height = positiveNumber(rect?.height) || positiveNumber(element?.getAttribute?.("height")) || positiveNumber(element?.style?.height);
  return {
    width: width ? Math.round(width) : 0,
    height: height ? Math.round(height) : 0
  };
}

function positiveNumber(value) {
  const number = Number.parseFloat(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
}
