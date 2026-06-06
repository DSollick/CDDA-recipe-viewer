import { useState, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeProps,
  type NodeTypes,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { Dataset, GraphIndex, GraphNode } from '../types';

// ── Sizing ────────────────────────────────────────────────────────────────────

const ITEM_W = 164, ITEM_H = 42;
const META_W = 152, META_H = 34;
const META_RIGHT_GAP = 64; // gap between rightmost item column and meta column

function isMeta(type: string) {
  return type === 'skill' || type === 'proficiency' || type === 'quality';
}
function nodeW(type: string) { return isMeta(type) ? META_W : ITEM_W; }
function nodeH(type: string) { return isMeta(type) ? META_H : ITEM_H; }

// ── Colors ────────────────────────────────────────────────────────────────────

const DOT_COLOR: Record<string, string> = {
  item: 'bg-blue-400',
  quality: 'bg-purple-400',
  skill: 'bg-orange-400',
  proficiency: 'bg-orange-300',
  construction: 'bg-teal-400',
  disassembly: 'bg-teal-400',
  practice: 'bg-teal-400',
};

const EDGE_STROKE: Record<string, string> = {
  requires_component:    '#64748b',
  requires_tool_quality: '#a855f7',
  requires_skill:        '#f97316',
  requires_proficiency:  '#fb923c',
};

// ── Custom node ───────────────────────────────────────────────────────────────

function CddaNode({ data }: NodeProps) {
  const gn = data.graphNode as GraphNode;
  const isRoot = data.isRoot as boolean;
  const meta = isMeta(gn.type);
  const dot = DOT_COLOR[gn.type] ?? 'bg-slate-400';

  return (
    <div
      style={{ width: nodeW(gn.type), height: nodeH(gn.type) }}
      className={`flex items-center gap-1.5 px-2 rounded border text-xs select-none
        ${isRoot
          ? 'bg-slate-700 border-slate-400 font-semibold text-white'
          : meta
            ? 'bg-slate-900 border-slate-700 text-slate-400'
            : 'bg-slate-800 border-slate-600 text-slate-200'}`}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span className="truncate">{gn.display_name}</span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { cdda: CddaNode };

// ── Subgraph + layout ─────────────────────────────────────────────────────────

const DEP_TYPES = new Set([
  'requires_component',
  'requires_tool_quality',
  'requires_skill',
  'requires_proficiency',
]);

function buildLayoutedGraph(
  rootId: string,
  dataset: Dataset,
  index: GraphIndex,
  maxHops: number,
  showMeta: boolean,
): { rfNodes: RFNode[]; rfEdges: RFEdge[] } {
  const { nodes } = dataset;

  // Synthetic level-specific skill nodes: "skill_chemistry_lvl_3"
  // Created on the fly so the data model is untouched.
  const syntheticNodes = new Map<string, GraphNode>(); // leveledId → synthetic GraphNode

  function skillLevelId(baseId: string, level: number): string {
    return level > 0 ? `${baseId}_lvl_${level}` : baseId;
  }

  function ensureSkillLevelNode(baseId: string, level: number): string {
    const id = skillLevelId(baseId, level);
    if (!syntheticNodes.has(id) && !nodes[id]) {
      const base = nodes[baseId];
      const baseName = base?.display_name ?? baseId.replace('skill_', '');
      syntheticNodes.set(id, {
        ...(base ?? {
          id, type: 'skill' as const, era: null, learn_method: null,
          book_sources: [], skill_requirements: [], proficiency_requirements: [],
          craft_time: null, bottleneck_score: 0, spawn_class: null,
          incomplete: false, pseudo: false,
        }),
        id,
        display_name: level > 0 ? `${baseName} ${level}` : baseName,
      });
    }
    return id;
  }

  function getNode(id: string): GraphNode {
    return nodes[id] ?? syntheticNodes.get(id) ?? {
      id, type: 'item', display_name: id, era: null, learn_method: null,
      book_sources: [], skill_requirements: [], proficiency_requirements: [],
      craft_time: null, bottleneck_score: 0, spawn_class: null,
      incomplete: true, pseudo: false,
    };
  }

  // BFS
  const seen = new Set<string>([rootId]);
  type Coll = { source: string; target: string; edge: typeof dataset.edges[0]; isTreeEdge: boolean };
  const collected: Coll[] = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth >= maxHops) continue;

    for (const edge of index.outEdges.get(item.id) ?? []) {
      if (!DEP_TYPES.has(edge.type)) continue;
      if (!edge.is_default) continue;
      if (!showMeta && edge.type !== 'requires_component') continue;

      // For skill edges, create a level-specific target node ID
      const target =
        edge.type === 'requires_skill'
          ? ensureSkillLevelNode(edge.to, edge.quality_level ?? 0)
          : edge.to;

      const isTreeEdge = !seen.has(target);
      collected.push({ source: item.id, target, edge, isTreeEdge });

      if (isTreeEdge) {
        seen.add(target);
        // Don't enqueue meta nodes — they're leaves by definition
        if (!isMeta(getNode(target).type)) {
          queue.push({ id: target, depth: item.depth + 1 });
        }
      }
    }
  }

  // RF nodes
  const rfNodes: RFNode[] = [...seen].map((id) => ({
    id,
    position: { x: 0, y: 0 },
    type: 'cdda',
    data: { graphNode: getNode(id), isRoot: id === rootId },
  }));

  // RF edges
  const rfEdges: RFEdge[] = collected.map(({ source, target, edge, isTreeEdge }, i) => ({
    id: `e${i}`,
    source,
    target,
    label: edge.quantity > 1 ? `${edge.quantity}×` : undefined,
    style: { stroke: EDGE_STROKE[edge.type] ?? '#64748b', strokeWidth: 1.5 },
    labelStyle: { fill: '#94a3b8', fontSize: 10 },
    labelBgStyle: { fill: '#1e293b', fillOpacity: 0.8 },
    data: { isTreeEdge },
  }));

  // Dagre layout — tree edges only, meta nodes excluded from layout edges
  // (their x will be overridden after layout anyway)
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 60, marginx: 24, marginy: 24 });

  for (const n of rfNodes) {
    const type = (n.data.graphNode as GraphNode).type;
    g.setNode(n.id, { width: nodeW(type), height: nodeH(type) });
  }
  for (const e of rfEdges) {
    if (e.data?.isTreeEdge && !isMeta(getNode(e.target).type)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  // Find rightmost edge of any non-meta node for pinning meta nodes
  let maxItemRight = 0;
  for (const n of rfNodes) {
    const type = (n.data.graphNode as GraphNode).type;
    if (!isMeta(type)) {
      const pos = g.node(n.id);
      if (pos) maxItemRight = Math.max(maxItemRight, pos.x + nodeW(type) / 2);
    }
  }
  const metaX = maxItemRight + META_RIGHT_GAP;

  const laidOut: RFNode[] = rfNodes.map((n) => {
    const type = (n.data.graphNode as GraphNode).type;
    const pos = g.node(n.id);
    if (!pos) return { ...n, position: { x: 0, y: 0 } };

    if (isMeta(type)) {
      // Pin to rightmost column; keep dagre's y for vertical spacing
      return { ...n, position: { x: metaX, y: pos.y - nodeH(type) / 2 } };
    }
    return { ...n, position: { x: pos.x - nodeW(type) / 2, y: pos.y - nodeH(type) / 2 } };
  });

  return { rfNodes: laidOut, rfEdges };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface GraphViewProps {
  rootNodeId: string;
  activeDataset: Dataset;
  graphIndex: GraphIndex;
  onRootChange: (id: string) => void;
}

export default function GraphView({
  rootNodeId,
  activeDataset,
  graphIndex,
  onRootChange,
}: GraphViewProps) {
  const [maxHops, setMaxHops] = useState(3);
  const [showMeta, setShowMeta] = useState(true);

  // History stack — reset when an external root change arrives (new search)
  const [history, setHistory] = useState<string[]>([rootNodeId]);
  const [histIdx, setHistIdx] = useState(0);

  useEffect(() => {
    setHistory([rootNodeId]);
    setHistIdx(0);
  }, [rootNodeId]);

  const currentRoot = history[histIdx];

  function navigateTo(id: string) {
    setHistory((prev) => [...prev.slice(0, histIdx + 1), id]);
    setHistIdx((i) => i + 1);
    onRootChange(id); // keep parent's selectedItemId in sync
  }

  const canBack = histIdx > 0;
  const canForward = histIdx < history.length - 1;

  const { rfNodes, rfEdges } = useMemo(
    () => buildLayoutedGraph(currentRoot, activeDataset, graphIndex, maxHops, showMeta),
    [currentRoot, activeDataset, graphIndex, maxHops, showMeta],
  );

  const currentNode = activeDataset.nodes[currentRoot];

  const handleNodeClick: NodeMouseHandler = (_evt, node) => {
    const gn = node.data.graphNode as GraphNode;
    if (node.id === currentRoot) return;
    // Only re-root on item/construction/practice — meta nodes are terminal
    if (gn.type === 'item' || gn.type === 'construction' || gn.type === 'practice') {
      navigateTo(node.id);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700 bg-slate-800 text-xs text-slate-300 shrink-0">

        {/* Back / forward */}
        <button
          onClick={() => setHistIdx((i) => i - 1)}
          disabled={!canBack}
          className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Back"
        >
          ←
        </button>
        <button
          onClick={() => setHistIdx((i) => i + 1)}
          disabled={!canForward}
          className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Forward"
        >
          →
        </button>

        {/* Current item name */}
        <span className="text-slate-200 font-medium truncate max-w-48">
          {currentNode?.display_name ?? currentRoot}
        </span>

        {/* History breadcrumb count */}
        {history.length > 1 && (
          <span className="text-slate-600 text-xs">
            {histIdx + 1} / {history.length}
          </span>
        )}

        <div className="w-px h-4 bg-slate-700 mx-1" />

        {/* Depth */}
        <span className="text-slate-500">Depth</span>
        <input
          type="range" min={1} max={6} value={maxHops}
          onChange={(e) => setMaxHops(Number(e.target.value))}
          className="w-24 accent-blue-400"
        />
        <span className="w-3 text-slate-400">{maxHops}</span>

        {/* Skills toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer ml-1">
          <input
            type="checkbox" checked={showMeta}
            onChange={(e) => setShowMeta(e.target.checked)}
            className="accent-blue-400"
          />
          Skills &amp; qualities
        </label>

        <span className="ml-auto text-slate-600">
          {rfNodes.length} nodes · {rfEdges.length} edges
        </span>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        <ReactFlow
          key={currentRoot}
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          onNodeClick={handleNodeClick}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
        >
          <Background variant={BackgroundVariant.Dots} color="#334155" gap={24} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
