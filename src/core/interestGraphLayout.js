export function createInterestLayout(graph, options = {}) {
  const width = options.width || 760;
  const height = options.height || 600;
  const folders = (graph?.folders || []).slice(0, options.maxFolders || 14);
  const topics = (graph?.topics || []).slice(0, options.maxTopics || 28);
  const sparse = folders.length + topics.length <= 4;
  const nodes = [...folders, ...topics].map((node) => ({
    ...node,
    radius: node.type === "folder"
      ? Math.min(sparse ? 44 : 38, (sparse ? 24 : 20) + Math.sqrt(node.count) * (sparse ? 6 : 5))
      : Math.min(sparse ? 22 : 18, (sparse ? 11 : 9) + Math.sqrt(node.count) * (sparse ? 4 : 3))
  }));
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = (graph?.edges || []).filter(
    (edge) => edge.type === "topic" && visibleIds.has(edge.source) && visibleIds.has(edge.target)
  );
  const positions = seedPositions(nodes, width, height);

  if (nodes.length > 1) {
    settleLayout(nodes, edges, positions, width, height, options.iterations || 240);
  }

  return {
    nodes,
    edges,
    positions,
    width,
    height,
    omitted: (graph?.folders?.length || 0) + (graph?.topics?.length || 0) - nodes.length
  };
}

function seedPositions(nodes, width, height) {
  const positions = new Map();
  const centerX = width / 2;
  const centerY = height / 2;
  const folders = nodes.filter((node) => node.type === "folder");
  const topics = nodes.filter((node) => node.type === "topic");

  folders.forEach((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, folders.length);
    const radius = folders.length === 1 ? 0 : Math.min(150, 54 + folders.length * 10);
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      vx: 0,
      vy: 0
    });
  });

  topics.forEach((node, index) => {
    const sparseAngle = topics.length === 1
      ? -Math.PI / 2
      : -Math.PI / 5 + (Math.PI * 2 * index) / 3;
    const angle = topics.length <= 3
      ? sparseAngle
      : Math.PI / 4 + (Math.PI * 2 * index) / topics.length;
    const radius = Math.min(width, height) * (topics.length <= 3 ? 0.37 : 0.39);
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      vx: 0,
      vy: 0
    });
  });

  if (nodes.length === 1) {
    positions.set(nodes[0].id, { x: centerX, y: centerY, vx: 0, vy: 0 });
  }
  return positions;
}

function settleLayout(nodes, edges, positions, width, height, iterations) {
  const centerX = width / 2;
  const centerY = height / 2;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const alpha = Math.max(0.08, 1 - iteration / iterations);

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex];
        const right = nodes[rightIndex];
        const leftPoint = positions.get(left.id);
        const rightPoint = positions.get(right.id);
        let dx = rightPoint.x - leftPoint.x;
        let dy = rightPoint.y - leftPoint.y;
        if (Math.abs(dx) + Math.abs(dy) < 0.01) {
          const angle = seededAngle(left.id, right.id);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
        }
        const distance = Math.max(1, Math.hypot(dx, dy));
        const minimum = left.radius + right.radius + (left.type === right.type ? 54 : 40);
        const repulsion = (distance < minimum ? (minimum - distance) * 0.08 : 1350 / (distance * distance)) * alpha;
        const unitX = dx / distance;
        const unitY = dy / distance;
        leftPoint.vx -= unitX * repulsion;
        leftPoint.vy -= unitY * repulsion;
        rightPoint.vx += unitX * repulsion;
        rightPoint.vy += unitY * repulsion;
      }
    }

    for (const edge of edges) {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      const desired = (nodes.length <= 4 ? 232 : 138) + (sourceNode.radius + targetNode.radius) * 0.45;
      const spring = (distance - desired) * 0.013 * alpha;
      const unitX = dx / distance;
      const unitY = dy / distance;
      source.vx += unitX * spring;
      source.vy += unitY * spring;
      target.vx -= unitX * spring;
      target.vy -= unitY * spring;
    }

    for (const node of nodes) {
      const point = positions.get(node.id);
      const gravity = node.type === "folder" ? 0.012 : 0.006;
      point.vx += (centerX - point.x) * gravity * alpha;
      point.vy += (centerY - point.y) * gravity * alpha;
      point.vx *= 0.78;
      point.vy *= 0.78;
      point.x = clamp(point.x + point.vx, node.radius + 54, width - node.radius - 54);
      point.y = clamp(point.y + point.vy, node.radius + 36, height - node.radius - 42);
    }
  }
}

function seededAngle(left, right) {
  const text = `${left}:${right}`;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return (hash / 0xffffffff) * Math.PI * 2;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
