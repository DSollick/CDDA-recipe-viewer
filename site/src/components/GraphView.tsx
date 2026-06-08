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

function isMeta(type: string) {
  return type === 'skill' || type === 'proficiency' || type === 'quality' || type === 'group';
}
function nodeW(type: string) { return isMeta(type) ? META_W : ITEM_W; }
function nodeH(type: string) { return isMeta(type) ? META_H : ITEM_H; }

// ── Colors ────────────────────────────────────────────────────────────────────

const DOT_COLOR: Record<string, string> = {
  quality: 'bg-purple-400',
  skill: 'bg-orange-400',
  proficiency: 'bg-orange-300',
  group: 'bg-green-400',
  construction: 'bg-teal-400',
  disassembly: 'bg-teal-400',
  practice: 'bg-teal-400',
};

function itemDotColor(gn: GraphNode, harvestedFrom?: Record<string, string[]>): string {
  if (gn.incomplete) return 'bg-slate-600';
  if (gn.learn_method !== null) return 'bg-blue-400';
  if (harvestedFrom?.[gn.id]?.length) return 'bg-amber-400';
  return 'bg-slate-400';
}

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
  const harvestedFrom = data.harvestedFrom as Record<string, string[]> | undefined;
  const meta = isMeta(gn.type);
  const dot = gn.type === 'item'
    ? itemDotColor(gn, harvestedFrom)
    : (DOT_COLOR[gn.type] ?? 'bg-slate-400');

  return (
    <div
      style={{ width: nodeW(gn.type), height: nodeH(gn.type) }}
      title={gn.id}
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

  // Synthetic level-specific nodes (skills and tool qualities) built at render time
  const syntheticNodes = new Map<string, GraphNode>();

  function ensureLevelNode(baseId: string, level: number, fallbackType: GraphNode['type']): string {
    const id = level > 0 ? `${baseId}_lvl_${level}` : baseId;
    if (!syntheticNodes.has(id) && !nodes[id]) {
      const base = nodes[baseId];
      const baseName = base?.display_name ?? baseId.replace(/^(?:skill|quality)_/, '');
      syntheticNodes.set(id, {
        ...(base ?? {
          id, type: fallbackType, era: null, learn_method: null,
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

      // Skill nodes have no level in their ID — create a synthetic level-specific node.
      // Quality nodes already encode the level in their ID (qual_CUT_2), so use edge.to directly.
      const target =
        edge.type === 'requires_skill'
          ? ensureLevelNode(edge.to, edge.quality_level ?? 0, 'skill')
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

  // ── Dagre layout for all nodes ────────────────────────────────────────────
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 60, marginx: 24, marginy: 24 });

  for (const id of seen) {
    const type = getNode(id).type;
    g.setNode(id, { width: nodeW(type), height: nodeH(type) });
  }
  // Add ALL edges (not just spanning-tree edges) so dagre correctly ranks shared nodes.
  // Deduplicate to avoid parallel edges which confuse dagre's rank assignment.
  const dagreEdgeSeen = new Set<string>();
  for (const { source, target } of collected) {
    const key = `${source}\x00${target}`;
    if (!dagreEdgeSeen.has(key)) {
      dagreEdgeSeen.add(key);
      g.setEdge(source, target);
    }
  }

  dagre.layout(g);

  // ── Assemble RF nodes and edges ────────────────────────────────────────────
  const rfNodes: RFNode[] = [...seen].map((id) => {
    const type = getNode(id).type;
    const pos = g.node(id);
    return {
      id,
      type: 'cdda',
      position: pos
        ? { x: pos.x - nodeW(type) / 2, y: pos.y - nodeH(type) / 2 }
        : { x: 0, y: 0 },
      data: { graphNode: getNode(id), isRoot: id === rootId, harvestedFrom: dataset.harvested_from },
    };
  });

  const rfEdges: RFEdge[] = collected.map(({ source, target, edge, isTreeEdge }, i) => ({
    id: `e${i}`,
    source,
    target,
    label: edge.quantity > 1 ? `${edge.quantity}×` : undefined,
    style: { stroke: getNode(target).type === 'group' ? '#4ade80' : (EDGE_STROKE[edge.type] ?? '#64748b'), strokeWidth: 1.5 },
    labelStyle: { fill: '#94a3b8', fontSize: 10 },
    labelBgStyle: { fill: '#1e293b', fillOpacity: 0.8 },
    data: { isTreeEdge },
  }));

  return { rfNodes, rfEdges };
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
  const [selectedMetaId, setSelectedMetaId] = useState<string | null>(null);

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
      setSelectedMetaId(null);
      navigateTo(node.id);
    } else if (gn.type === 'quality' || gn.type === 'group') {
      setSelectedMetaId((prev) => (prev === node.id ? null : node.id));
    }
  };

  const selectedMetaNode = selectedMetaId ? (
    activeDataset.nodes[selectedMetaId] ?? rfNodes.find((n) => n.id === selectedMetaId)?.data.graphNode as GraphNode | undefined
  ) : null;
  const providerIds: string[] = selectedMetaId
    ? (activeDataset.quality_providers?.[selectedMetaId] ?? activeDataset.group_providers?.[selectedMetaId] ?? [])
    : [];

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
      <div className="flex-1 relative">
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

        {/* Provider panel — shown when a quality node is selected */}
        {selectedMetaNode && (
          <div className="absolute top-3 right-3 w-56 bg-slate-800 border border-slate-600 rounded shadow-xl text-xs text-slate-300 flex flex-col max-h-[70%]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 shrink-0">
              <span className={`font-semibold ${selectedMetaNode.type === 'group' ? 'text-green-300' : 'text-purple-300'}`}>
                {selectedMetaNode.display_name}
              </span>
              <button
                onClick={() => setSelectedMetaId(null)}
                className="text-slate-500 hover:text-slate-200 transition-colors ml-2"
              >✕</button>
            </div>
            {providerIds.length === 0 ? (
              <p className="px-3 py-2 text-slate-500">No provider data available.</p>
            ) : (
              <>
                <p className="px-3 pt-2 pb-1 text-slate-500 shrink-0">
                  {selectedMetaNode.type === 'group' ? 'Items in this group:' : 'Items providing this quality:'}
                </p>
                <ul className="overflow-y-auto px-3 pb-2 space-y-0.5">
                  {providerIds.map((id) => {
                    const n = activeDataset.nodes[id];
                    return (
                      <li key={id}>
                        <button
                          onClick={() => { setSelectedMetaId(null); navigateTo(id); }}
                          className="text-left w-full text-blue-300 hover:text-blue-100 hover:underline truncate block"
                        >
                          {n?.display_name ?? id}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
