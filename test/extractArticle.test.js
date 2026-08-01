import test from "node:test";
import assert from "node:assert/strict";
import { detectInteractivePlots, removeAccessBarrierElements } from "../src/core/extractArticle.js";

test("removes anti-adblock dialogs from the extraction clone only", () => {
  const removed = [];
  const warning = { textContent: "Please disable your ad blocker to continue reading.", remove: () => removed.push("warning") };
  const ordinaryDialog = { textContent: "Choose a newsletter topic.", remove: () => removed.push("ordinary") };
  const root = { querySelectorAll: () => [warning, ordinaryDialog] };

  removeAccessBarrierElements(root);

  assert.deepEqual(removed, ["warning"]);
});

test("detects Plotly containers with nearby captions", () => {
  const plot = createNode({ id: "frontier-gap", classNames: ["js-plotly-plot"] });
  plot.nextElementSibling = createNode({ tagName: "p", text: "Interactive plot of the frontier model gap." });

  const plots = detectInteractivePlots(createDocument([plot]));

  assert.equal(plots.length, 1);
  assert.equal(plots[0].type, "plotly");
  assert.equal(plots[0].caption, "Interactive plot of the frontier model gap.");
  assert.match(plots[0].html, /js-plotly-plot/);
});

test("detects plotty containers from data attributes", () => {
  const plot = createNode({ attrs: { "data-plotty": "true" } });

  const plots = detectInteractivePlots(createDocument([plot]));

  assert.equal(plots.length, 1);
  assert.equal(plots[0].type, "plotty");
  assert.match(plots[0].html, /data-plotty="true"/);
});

test("detects iframe charts from interactive plot captions", () => {
  const iframe = createNode({ tagName: "iframe", attrs: { src: "https://example.com/frontier-chart" } });
  iframe.nextElementSibling = createNode({ tagName: "p", text: "Interactive plot of the Artificial Analysis Intelligence Index for open and closed frontier models." });

  const plots = detectInteractivePlots(createDocument([iframe, iframe.nextElementSibling]));

  assert.equal(plots.length, 1);
  assert.equal(plots[0].type, "interactive");
  assert.match(plots[0].caption, /Artificial Analysis Intelligence Index/);
  assert.match(plots[0].html, /<iframe/);
  assert.match(plots[0].html, /frontier-chart/);
});

test("detects stripped interactive plots from caption text alone", () => {
  const caption = createNode({ tagName: "p", text: "Interactive plot of the Artificial Analysis Intelligence Index for open and closed frontier models." });

  const plots = detectInteractivePlots(createDocument([caption]));

  assert.equal(plots.length, 1);
  assert.equal(plots[0].type, "caption");
});

function createDocument(nodes) {
  return {
    createElement(tagName) {
      return createNode({ tagName });
    },
    querySelectorAll(selector) {
      return nodes.filter((node) => selector.split(",").some((part) => nodeMatchesSelector(node, part.trim())));
    }
  };
}

function nodeMatchesSelector(node, selector) {
  if (selector.startsWith(".")) return node.classList.contains(selector.slice(1));
  if (selector.startsWith("[")) return Boolean(node.getAttribute(selector.slice(1, -1)));
  return node.tagName.toLowerCase() === selector.toLowerCase();
}

function createNode({ tagName = "div", id = "", classNames = [], attrs = {}, text = "" } = {}) {
  const node = {
    tagName: tagName.toUpperCase(),
    id,
    className: classNames.join(" "),
    textContent: text,
    nextElementSibling: null,
    previousElementSibling: null,
    parentElement: null,
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    classList: {
      contains(name) {
        return classNames.includes(name);
      },
      add(name) {
        if (!classNames.includes(name)) classNames.push(name);
        node.className = classNames.join(" ");
      }
    },
    getAttribute(name) {
      return attrs[name] || "";
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
      node.attributes = Object.entries(attrs).map(([attrName, attrValue]) => ({ name: attrName, value: attrValue }));
    },
    removeAttribute(name) {
      delete attrs[name];
      node.attributes = Object.entries(attrs).map(([attrName, attrValue]) => ({ name: attrName, value: attrValue }));
    },
    closest(selector) {
      const selectors = selector.split(",").map((item) => item.trim());
      return selectors.some((item) => nodeMatchesSelector(this, item)) ? this : null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    cloneNode() {
      return createNode({ tagName, id, classNames: [...classNames], attrs: { ...attrs }, text });
    },
    remove() {},
    get outerHTML() {
      const properties = {
        src: this.src,
        title: this.title,
        loading: this.loading,
        referrerpolicy: this.referrerPolicy,
        width: this.width,
        height: this.height
      };
      const merged = { ...attrs, ...Object.fromEntries(Object.entries(properties).filter(([, value]) => value)) };
      if (id) merged.id = id;
      if (classNames.length) merged.class = classNames.join(" ");
      const attributeText = Object.entries(merged)
        .map(([name, value]) => ` ${name}="${String(value).replace(/"/g, "&quot;")}"`)
        .join("");
      return `<${tagName}${attributeText}>${text}</${tagName}>`;
    }
  };
  return node;
}
