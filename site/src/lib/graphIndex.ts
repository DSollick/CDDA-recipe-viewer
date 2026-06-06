import { GraphEdge, GraphIndex } from '../types';

/**
 * Build adjacency index from a flat edges array.
 * outEdges: given a node id, returns all edges where `from === id`.
 * inEdges:  given a node id, returns all edges where `to === id`.
 */
export function buildGraphIndex(edges: GraphEdge[]): GraphIndex {
  const outEdges = new Map<string, GraphEdge[]>();
  const inEdges = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    if (!outEdges.has(edge.from)) outEdges.set(edge.from, []);
    outEdges.get(edge.from)!.push(edge);

    if (!inEdges.has(edge.to)) inEdges.set(edge.to, []);
    inEdges.get(edge.to)!.push(edge);
  }

  return { outEdges, inEdges };
}

/**
 * Returns only the dependency edges (excludes byproduct_of which goes upward).
 */
export function getDependencyEdges(nodeId: string, index: GraphIndex): GraphEdge[] {
  const all = index.outEdges.get(nodeId) ?? [];
  return all.filter(
    (e) =>
      e.type === 'requires_component' ||
      e.type === 'requires_tool_quality' ||
      e.type === 'requires_skill' ||
      e.type === 'requires_proficiency'
  );
}

/**
 * Group component edges by slot_index so alternatives can be rendered together.
 * Returns slots in ascending slot_index order.
 */
export interface ComponentSlot {
  slotIndex: number | null;
  edges: GraphEdge[];
  defaultEdge: GraphEdge | null;
}

export function groupComponentSlots(edges: GraphEdge[]): ComponentSlot[] {
  const componentEdges = edges.filter((e) => e.type === 'requires_component');
  const slotMap = new Map<string | number, GraphEdge[]>();

  for (const edge of componentEdges) {
    const key = edge.slot_index ?? `no_slot_${edge.to}`;
    if (!slotMap.has(key)) slotMap.set(key, []);
    slotMap.get(key)!.push(edge);
  }

  const slots: ComponentSlot[] = [];
  for (const [key, slotEdges] of slotMap) {
    const defaultEdge = slotEdges.find((e) => e.is_default) ?? slotEdges[0] ?? null;
    slots.push({
      slotIndex: typeof key === 'number' ? key : null,
      edges: slotEdges,
      defaultEdge,
    });
  }

  // Sort by slot_index ascending (nulls last)
  slots.sort((a, b) => {
    if (a.slotIndex === null && b.slotIndex === null) return 0;
    if (a.slotIndex === null) return 1;
    if (b.slotIndex === null) return -1;
    return a.slotIndex - b.slotIndex;
  });

  return slots;
}
