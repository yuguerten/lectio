import test from "node:test";
import assert from "node:assert/strict";
import { enhanceArticleTables, sanitizeArticleHtml } from "../src/reader/dom.js";

function installDomShim() {
  class Node {
    constructor(tagName = "") {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.attributes = [];
      this._text = "";
    }
    set innerHTML(html) {
      this.children = parseSimpleHtml(html, this);
    }
    get innerHTML() {
      return this.children.map((child) => child.outerHTML).join("");
    }
    get textContent() {
      return this._text || this.children.map((child) => child.textContent).join("");
    }
    get outerHTML() {
      return `<${this.tagName.toLowerCase()}>${escapeHtml(this.textContent)}</${this.tagName.toLowerCase()}>`;
    }
    querySelectorAll(selector) {
      const tags = selector.split(",").map((item) => item.trim().toUpperCase());
      const matches = [];
      const visit = (node) => {
        for (const child of node.children) {
          if (tags.includes("*") || tags.includes(child.tagName)) matches.push(child);
          visit(child);
        }
      };
      visit(this);
      return matches;
    }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    }
    removeAttribute(name) {
      this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
    }
  }

  global.document = {
    createElement(tagName) {
      if (tagName === "template") return { content: new Node("template"), set innerHTML(html) { this.content.innerHTML = html; }, get innerHTML() { return this.content.innerHTML; } };
      return new Node(tagName);
    }
  };
}

function parseSimpleHtml(html, parent) {
  const nodes = [];
  const pattern = /<(p|h2)>((?:.|\n)*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const node = new parent.constructor(match[1]);
    node.parentNode = parent;
    node._text = match[2].replace(/<[^>]+>/g, "");
    nodes.push(node);
  }
  return nodes;
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

test("removes unwanted article asides from sanitized reader HTML", () => {
  installDomShim();
  const html = sanitizeArticleHtml(`
    <p>I’ve recieved feedback that some of the previous posts were too high level, I’ll try to make things clear.</p>
    <p>Keep this useful paragraph.</p>
    <h2>Graph layout.</h2>
    <p>I’ve tried my best to keep this easy to understand, but this part is just plain hard to make explain in a single blog post.</p>
    <p>Thanks for reading zach's tech blog! Subscribe for free to receive new posts and support my work.</p>
    <form><input placeholder="Type your email"><button>Subscribe</button></form>
    <div>Thanks for reading zach's tech blog! Subscribe for free to receive new posts and support my work.</div>
  `);

  assert.match(html, /Keep this useful paragraph/);
  assert.doesNotMatch(html, /recieved feedback/);
  assert.doesNotMatch(html, /Graph layout/);
  assert.doesNotMatch(html, /plain hard/);
  assert.doesNotMatch(html, /Subscribe/);
  assert.doesNotMatch(html, /Type your email/);
});

test("wraps semantic tables in a labelled keyboard-scrollable region", () => {
  const inserted = [];
  const caption = { textContent: "Observed ORIGIN at direct peer" };
  const parentNode = {
    insertBefore(node, reference) {
      inserted.push({ node, reference });
    }
  };
  const table = {
    parentNode,
    querySelector(selector) {
      return selector === "caption" ? caption : null;
    },
    closest() {
      return null;
    }
  };
  const articleRoot = { querySelectorAll: () => [table] };
  global.document = {
    createElement() {
      return {
        attributes: new Map(),
        setAttribute(name, value) {
          this.attributes.set(name, value);
        },
        append(child) {
          this.child = child;
        }
      };
    }
  };

  enhanceArticleTables(articleRoot);

  const wrapper = inserted[0].node;
  assert.equal(inserted[0].reference, table);
  assert.equal(wrapper.className, "article-table-scroll");
  assert.equal(wrapper.attributes.get("role"), "region");
  assert.equal(wrapper.attributes.get("tabindex"), "0");
  assert.equal(wrapper.attributes.get("aria-label"), "Observed ORIGIN at direct peer");
  assert.equal(wrapper.child, table);
});
