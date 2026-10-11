import { expect, it } from "vitest";
import { graphLayout } from "../../src/components/workflows/layout";
it("lays branching DAG in stable topological layers with isolated nodes", () => {
  const plan = {
    nodes: [
      { id: "c", label: "C" },
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "d", label: "D" },
    ],
    edges: [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ],
  };
  expect(graphLayout(plan)).toEqual([
    { id: "c", position: { x: 560, y: 0 } },
    { id: "a", position: { x: 0, y: 0 } },
    { id: "b", position: { x: 280, y: 0 } },
    { id: "d", position: { x: 0, y: 130 } },
  ]);
  expect(graphLayout(plan)).toEqual(graphLayout(plan));
});
it("renders every node at the maximum bounded DAG with nonoverlapping layers", () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    label: `Node ${i}`,
  })).reverse();
  const edges = [
    ...Array.from({ length: 99 }, (_, i) => ({
      source: String(i),
      target: String(i + 1),
    })),
    ...Array.from({ length: 98 }, (_, i) => ({
      source: String(i),
      target: String(i + 2),
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      source: String(i),
      target: String(i + 3),
    })),
  ];
  const result = graphLayout({ nodes, edges }),
    positions = new Map(result.map((n) => [n.id, n.position]));
  expect(result.map((n) => n.id)).toEqual(nodes.map((n) => n.id));
  expect(
    new Set(result.map((n) => `${n.position.x},${n.position.y}`)).size,
  ).toBe(100);
  for (const edge of edges)
    expect(positions.get(edge.target)!.x).toBeGreaterThan(
      positions.get(edge.source)!.x,
    );
});
