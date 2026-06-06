import { GraphEdge, GraphIndex, GraphNode } from '../types';
import { getDependencyEdges, groupComponentSlots, ComponentSlot } from './graphIndex';

export type EdgeType = GraphEdge['type'];

export interface TreeNode {
  nodeId: string;
  edge: GraphEdge | null; // null for root
  // Component slot grouping (only relevant when edge.type === 'requires_component')
  slot: ComponentSlot | null;
  // Is this node using the default alternative for its slot?
  isDefaultAlt: boolean;
  // True when this nodeId was already seen on the ancestor path — renders as stub
  isCycle: boolean;
  // Pre-built children (non-component edges) and slots (component edges)
  nonComponentChildren: TreeNode[];
  componentSlots: SlotGroup[];
  depth: number;
}

export interface SlotGroup {
  slot: ComponentSlot;
  // The currently-selected edge in this slot
  activeEdgeIndex: number;
  // Child tree nodes for each alternative (lazy — only root node, children loaded on expand)
  alternatives: TreeNodeStub[];
}

export interface TreeNodeStub {
  edge: GraphEdge;
  nodeId: string;
}

/**
 * Build the root TreeNode for a given node ID.
 * Children beyond `maxDepth` are included as collapsed stubs (isCycle=false, empty children).
 * ancestorPath tracks the chain of node IDs from root to here for cycle detection.
 */
export function buildTreeNode(
  nodeId: string,
  edge: GraphEdge | null,
  slot: ComponentSlot | null,
  index: GraphIndex,
  nodes: Record<string, GraphNode>,
  ancestorPath: Set<string>,
  depth: number,
  maxDepth: number
): TreeNode {
  const isCycle = ancestorPath.has(nodeId) && edge !== null;

  if (isCycle) {
    return {
      nodeId,
      edge,
      slot,
      isDefaultAlt: edge?.is_default ?? true,
      isCycle: true,
      nonComponentChildren: [],
      componentSlots: [],
      depth,
    };
  }

  const nextAncestors = new Set(ancestorPath);
  nextAncestors.add(nodeId);

  if (depth >= maxDepth) {
    // Stub: we know the node exists but don't expand it yet
    return {
      nodeId,
      edge,
      slot,
      isDefaultAlt: edge?.is_default ?? true,
      isCycle: false,
      nonComponentChildren: [],
      componentSlots: [],
      depth,
    };
  }

  const depEdges = getDependencyEdges(nodeId, index);

  // Non-component deps: skill, proficiency, tool_quality
  const nonCompEdges = depEdges.filter((e) => e.type !== 'requires_component');
  const nonComponentChildren: TreeNode[] = nonCompEdges.map((e) =>
    buildTreeNode(e.to, e, null, index, nodes, nextAncestors, depth + 1, maxDepth)
  );

  // Component slots
  const slots = groupComponentSlots(depEdges);
  const componentSlots: SlotGroup[] = slots.map((s) => {
    const alternatives: TreeNodeStub[] = s.edges.map((e) => ({ edge: e, nodeId: e.to }));
    const defaultIdx = s.edges.findIndex((e) => e.is_default);
    return {
      slot: s,
      activeEdgeIndex: defaultIdx >= 0 ? defaultIdx : 0,
      alternatives,
    };
  });

  return {
    nodeId,
    edge,
    slot,
    isDefaultAlt: edge?.is_default ?? true,
    isCycle: false,
    nonComponentChildren,
    componentSlots,
    depth,
  };
}

/**
 * Expand a stub TreeNode one level deeper (called on user click).
 * Returns a new TreeNode with children populated.
 */
export function expandTreeNode(
  stub: TreeNode,
  index: GraphIndex,
  nodes: Record<string, GraphNode>,
  ancestorPath: Set<string>,
  maxDepth: number
): TreeNode {
  return buildTreeNode(
    stub.nodeId,
    stub.edge,
    stub.slot,
    index,
    nodes,
    ancestorPath,
    stub.depth,
    stub.depth + maxDepth
  );
}

/**
 * Collect the ancestor path from root to a given node by doing a depth-first walk.
 * Used when expanding a collapsed node to provide a correct ancestorPath.
 */
export function collectAncestorPath(root: TreeNode): Set<string> {
  // Since we can't easily walk back from a stub, callers should track this themselves.
  // This utility builds a set from root ancestors for a fresh expansion.
  const path = new Set<string>();
  path.add(root.nodeId);
  return path;
}
