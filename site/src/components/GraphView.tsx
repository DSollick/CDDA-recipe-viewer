import { useState, useMemo } from 'react';
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
const META_W = 148, META_H = 34;

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
  requires_component:   '#64748b', // slate-500
  requires_tool_quality:'#a855f7', // purple-500
  requires_skill:       '#f97316', // orange-500
  requires_proficiency: '#fb923c', // orange-400
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

  // BFS — collect nodes and edges
  const seen = new Set<string>([rootId]);
  type Coll = { edge: typeof dataset.edges[0]; isTreeEdge: boolean };
  const collected: Coll[] = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth >= maxHops) continue;

    for (const edge of index.outEdges.get(item.id) ?? []) {
      if (!DEP_TYPES.has(edge.type)) continue;
      if (!edge.is_default) continue;
      if (!showMeta && edge.type !== 'requires_component') continue;

      const isTreeEdge = !seen.has(edge.to);
      collected.push({ edge, isTreeEdge });
      if (isTreeEdge) {
        seen.add(edge.to);
        queue.push({ id: edge.to, depth: item.depth + 1 });
      }
    }
  }

  // Stub node for any id not found in dataset (incomplete reference)
  function getNode(id: string): GraphNode {
    return nodes[id] ?? {
      id, type: 'item', display_name: id, era: null, learn_method: null,
      book_sources: [], skill_requirements: [], proficiency_requirements: [],
      craft_time: null, bottleneck_score: 0, spawn_class: null,
      incomplete: true, pseudo: false,
    };
  }

  // Build RF nodes (position filled by dagre)
  const rfNodes: RFNode[] = [...seen].map((id) => ({
    id,
    position: { x: 0, y: 0 },
    type: 'cdda',
    data: { graphNode: getNode(id), isRoot: id === rootId },
  }));

  // Build RF edges
  const rfEdges: RFEdge[] = collected.map(({ edge, isTreeEdge }, i) => ({
    id: `e${i}`,
    source: edge.from,
    target: edge.to,
    label: edge.quantity > 1 ? `${edge.quantity}×` : undefined,
    style: { stroke: EDGE_STROKE[edge.type] ?? '#64748b', strokeWidth: 1.5 },
    labelStyle: { fill: '#94a3b8', fontSize: 10 },
    labelBgStyle: { fill: '#1e293b', fillOpacity: 0.8 },
    data: { isTreeEdge },
  }));

  // Dagre layout — only tree edges (avoids cycle issues)
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 60, marginx: 24, marginy: 24 });

  for (const n of rfNodes) {
    const type = (n.data.graphNode as GraphNode).type;
    g.setNode(n.id, { width: nodeW(type), height: nodeH(type) });
  }
  for (const e of rfEdges) {
    if (e.data?.isTreeEdge) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const laidOut: RFNode[] = rfNodes.map((n) => {
    const type = (n.data.graphNode as GraphNode).type;
    const { x, y } = g.node(n.id);
    return { ...n, position: { x: x - nodeW(type) / 2, y: y - nodeH(type) / 2 } };
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

  const { rfNodes, rfEdges } = useMemo(
    () => buildLayoutedGraph(rootNodeId, activeDataset, graphIndex, maxHops, showMeta),
    [rootNodeId, activeDataset, graphIndex, maxHops, showMeta],
  );

  const handleNodeClick: NodeMouseHandler = (_evt, node) => {
    const gn = node.data.graphNode as GraphNode;
    if (gn.type === 'item' || gn.type === 'construction' || gn.type === 'practice') {
      onRootChange(node.id);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-slate-700 bg-slate-800 text-xs text-slate-300 shrink-0">
        <span className="text-slate-500">Depth</span>
        <input
          type="range" min={1} max={6} value={maxHops}
          onChange={(e) => setMaxHops(Number(e.target.value))}
          className="w-24 accent-blue-400"
        />
        <span className="w-3 text-slate-400">{maxHops}</span>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox" checked={showMeta}
            onChange={(e) => setShowMeta(e.target.checked)}
            className="accent-blue-400"
          />
          Skills &amp; qualities
        </label>

        <span className="ml-auto text-slate-500">
          {rfNodes.length} nodes · {rfEdges.length} edges
        </span>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        <ReactFlow
          key={rootNodeId}
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
