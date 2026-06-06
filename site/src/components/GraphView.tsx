import { useState, useMemo, useEffect, useRef } from 'react';
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
const META_GAP = 60;      // horizontal gap between rightmost parent and meta node
const META_SPACING = 10;  // minimum vertical gap between meta nodes in the same column

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

  // Synthetic level-specific skill nodes built at render time
  const syntheticNodes = new Map<string, GraphNode>();

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

  // BFS — item nodes only enqueued; meta nodes collected but not traversed
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

      const target =
        edge.type === 'requires_skill'
          ? ensureSkillLevelNode(edge.to, edge.quality_level ?? 0)
          : edge.to;

      const isTreeEdge = !seen.has(target);
      collected.push({ source: item.id, target, edge, isTreeEdge });

      if (isTreeEdge) {
        seen.add(target);
        // Meta nodes are leaves — don't traverse into them
        if (!isMeta(getNode(target).type)) {
          queue.push({ id: target, depth: item.depth + 1 });
        }
      }
    }
  }

  // Split into item and meta node sets
  const itemIds = new Set([...seen].filter((id) => !isMeta(getNode(id).type)));
  const metaIds = new Set([...seen].filter((id) => isMeta(getNode(id).type)));

  // ── Phase 1: Dagre layout for item nodes only ──────────────────────────────
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 60, marginx: 24, marginy: 24 });

  for (const id of itemIds) {
    const type = getNode(id).type;
    g.setNode(id, { width: nodeW(type), height: nodeH(type) });
  }
  for (const { source, target, isTreeEdge } of collected) {
    if (isTreeEdge && itemIds.has(source) && itemIds.has(target)) {
      g.setEdge(source, target);
    }
  }

  dagre.layout(g);

  // ── Phase 2: Compute meta node positions ───────────────────────────────────
  // X = rightmost parent's right-edge + META_GAP
  // Y initial = average of all parent centre-Ys
  type MetaAccum = { x: number; sumY: number; count: number };
  const metaAccum = new Map<string, MetaAccum>();

  for (const { source, target } of collected) {
    if (!metaIds.has(target)) continue;
    const parentPos = g.node(source);
    if (!parentPos) continue;
    const parentRight = parentPos.x + nodeW(getNode(source).type) / 2;
    const existing = metaAccum.get(target);
    if (!existing) {
      metaAccum.set(target, { x: parentRight + META_GAP, sumY: parentPos.y, count: 1 });
    } else {
      metaAccum.set(target, {
        x: Math.max(existing.x, parentRight + META_GAP),
        sumY: existing.sumY + parentPos.y,
        count: existing.count + 1,
      });
    }
  }

  // ── Phase 3: Vertical stacking within each X column ───────────────────────
  // Group meta nodes by their computed X, sort by natural Y, then push apart.
  const byX = new Map<number, string[]>();
  for (const [id, accum] of metaAccum) {
    const col = accum.x;
    if (!byX.has(col)) byX.set(col, []);
    byX.get(col)!.push(id);
  }

  const finalMetaPos = new Map<string, { x: number; y: number }>();
  const rowH = META_H + META_SPACING;

  for (const [col, ids] of byX) {
    ids.sort((a, b) => {
      const ya = metaAccum.get(a)!;
      const yb = metaAccum.get(b)!;
      return ya.sumY / ya.count - yb.sumY / yb.count;
    });

    // Place each node; push downward if it would overlap the previous
    let prevBottom = -Infinity;
    for (const id of ids) {
      const acc = metaAccum.get(id)!;
      const naturalY = acc.sumY / acc.count;
      const y = Math.max(naturalY, prevBottom + META_H / 2 + META_SPACING);
      finalMetaPos.set(id, { x: col, y });
      prevBottom = y + META_H / 2;
    }

    // Centre the column around the natural midpoint to avoid drifting down
    const naturalMid = ids.reduce((s, id) => {
      const a = metaAccum.get(id)!;
      return s + a.sumY / a.count;
    }, 0) / ids.length;
    const layoutMid = (finalMetaPos.get(ids[0])!.y + finalMetaPos.get(ids[ids.length - 1])!.y) / 2;
    const shift = naturalMid - layoutMid;
    for (const id of ids) {
      const p = finalMetaPos.get(id)!;
      finalMetaPos.set(id, { x: p.x, y: p.y + shift });
    }

    void rowH; // suppress unused-var warning
  }

  // ── Phase 4: Assemble RF nodes with final positions ────────────────────────
  const rfNodes: RFNode[] = [...seen].map((id) => ({
    id,
    position: { x: 0, y: 0 },
    type: 'cdda',
    data: { graphNode: getNode(id), isRoot: id === rootId },
  }));

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

  const laidOut: RFNode[] = rfNodes.map((n) => {
    const type = getNode(n.id).type;
    if (isMeta(type)) {
      const pos = finalMetaPos.get(n.id);
      if (!pos) return { ...n, position: { x: 0, y: 0 } };
      return { ...n, position: { x: pos.x, y: pos.y - META_H / 2 } };
    }
    const pos = g.node(n.id);
    if (!pos) return { ...n, position: { x: 0, y: 0 } };
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

  // History stack.
  // Problem: navigateTo → onRootChange → parent sets selectedItemId → rootNodeId prop
  // changes → useEffect would reset history. Use a ref to suppress that reset.
  const [history, setHistory] = useState<string[]>([rootNodeId]);
  const [histIdx, setHistIdx] = useState(0);
  const suppressReset = useRef(false);

  useEffect(() => {
    if (suppressReset.current) {
      suppressReset.current = false;
      return;
    }
    setHistory([rootNodeId]);
    setHistIdx(0);
  }, [rootNodeId]);

  const currentRoot = history[histIdx];
  const canBack = histIdx > 0;
  const canForward = histIdx < history.length - 1;

  function navigateTo(id: string) {
    setHistory((prev) => [...prev.slice(0, histIdx + 1), id]);
    setHistIdx((i) => i + 1);
    suppressReset.current = true;
    onRootChange(id);
  }

  const { rfNodes, rfEdges } = useMemo(
    () => buildLayoutedGraph(currentRoot, activeDataset, graphIndex, maxHops, showMeta),
    [currentRoot, activeDataset, graphIndex, maxHops, showMeta],
  );

  const currentNode = activeDataset.nodes[currentRoot];

  const handleNodeClick: NodeMouseHandler = (_evt, node) => {
    if (node.id === currentRoot) return;
    const gn = node.data.graphNode as GraphNode;
    if (gn.type === 'item' || gn.type === 'construction' || gn.type === 'practice') {
      navigateTo(node.id);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700 bg-slate-800 text-xs text-slate-300 shrink-0">
        <button
          onClick={() => setHistIdx((i) => i - 1)}
          disabled={!canBack}
          className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Back"
        >←</button>
        <button
          onClick={() => setHistIdx((i) => i + 1)}
          disabled={!canForward}
          className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Forward"
        >→</button>

        <span className="text-slate-200 font-medium truncate max-w-48">
          {currentNode?.display_name ?? currentRoot}
        </span>
        {history.length > 1 && (
          <span className="text-slate-600">{histIdx + 1} / {history.length}</span>
        )}

        <div className="w-px h-4 bg-slate-700 mx-1" />

        <span className="text-slate-500">Depth</span>
        <input
          type="range" min={1} max={6} value={maxHops}
          onChange={(e) => setMaxHops(Number(e.target.value))}
          className="w-24 accent-blue-400"
        />
        <span className="w-3 text-slate-400">{maxHops}</span>

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
