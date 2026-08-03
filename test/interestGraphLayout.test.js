import test from "node:test";
import assert from "node:assert/strict";
import { createInterestLayout } from "../src/core/interestGraphLayout.js";

test("lays out a sparse folder and two topics as a usable cluster", () => {
  const graph = {
    folders: [{ id: "folder:ai", type: "folder", label: "AI", count: 2, articleIds: ["a", "b"] }],
    topics: [
      { id: "topic:research", type: "topic", label: "Research", count: 1, articleIds: ["a"] },
      { id: "topic:tech", type: "topic", label: "Tech", count: 1, articleIds: ["b"] }
    ],
    edges: [
      { source: "folder:ai", target: "topic:research", type: "topic", count: 1 },
      { source: "folder:ai", target: "topic:tech", type: "topic", count: 1 }
    ]
  };

  const layout = createInterestLayout(graph);
  const folder = layout.positions.get("folder:ai");
  const research = layout.positions.get("topic:research");
  const tech = layout.positions.get("topic:tech");

  assert.equal(layout.nodes.length, 3);
  assert.equal(layout.edges.length, 2);
  assert.ok(Math.hypot(folder.x - research.x, folder.y - research.y) > 80);
  assert.ok(Math.hypot(folder.x - tech.x, folder.y - tech.y) > 80);
  assert.ok(Math.abs(research.x - tech.x) > 40);
  assert.ok(Math.abs(research.y - tech.y) > 40);
  const triangleArea = Math.abs(
    (research.x - folder.x) * (tech.y - folder.y) -
    (research.y - folder.y) * (tech.x - folder.x)
  ) / 2;
  assert.ok(triangleArea > 4000);
});

test("keeps every visible node within the graph viewport", () => {
  const graph = {
    folders: Array.from({ length: 5 }, (_, index) => ({
      id: `folder:${index}`,
      type: "folder",
      label: `Folder ${index}`,
      count: index + 1,
      articleIds: [`a${index}`]
    })),
    topics: Array.from({ length: 12 }, (_, index) => ({
      id: `topic:${index}`,
      type: "topic",
      label: `Topic ${index}`,
      count: 1,
      articleIds: [`a${index % 5}`]
    })),
    edges: Array.from({ length: 12 }, (_, index) => ({
      source: `folder:${index % 5}`,
      target: `topic:${index}`,
      type: "topic",
      count: 1
    }))
  };

  const layout = createInterestLayout(graph);
  for (const node of layout.nodes) {
    const point = layout.positions.get(node.id);
    assert.ok(point.x >= 0 && point.x <= layout.width);
    assert.ok(point.y >= 0 && point.y <= layout.height);
  }
});
