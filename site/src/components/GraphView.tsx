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
  group: 'bg-yellow-400',
  construction: 'bg-teal-400',
  disassembly: 'bg-teal-400',
  practice: 'bg-teal-400',
};

function itemDotColor(gn: GraphNode, harvestedFrom?: Record<string, string[]>): string {
  if (gn.incomplete) return 'bg-slate-600';
  if (gn.learn_method !== null) return 'bg-blue-400';
  if (gn.spawn_class === 'environment_gather') return 'bg-green-400';
  if (harvestedFrom?.[gn.id]?.length) return 'bg-amber-400';
  return 'bg-slate-400';
}

interface SlotGroup {
  slotKey: string;
  sourceId: string;
  alternatives: string[]; // visible (non-hidden) nodeIds
  activeIdx: number;
}

interface GraphHandlers {
  openAltPanel: (slotKey: string) => void;
  hideNode: (nodeId: string) => void;
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
  const hasDeps = data.hasDeps as boolean;
  const slotKey = data.slotKey as string | undefined;
  const altCount = (data.altCount as number) ?? 0;
  const handlers = data.handlers as React.RefObject<GraphHandlers> | undefined;
  const meta = isMeta(gn.type);
  const dot = gn.type === 'item'
    ? itemDotColor(gn, harvestedFrom)
    : (DOT_COLOR[gn.type] ?? 'bg-slate-400');
  const navigable = !isRoot && (gn.type === 'item' || gn.type === 'construction' || gn.type === 'practice') && hasDeps;

  return (
    <div
      style={{ width: nodeW(gn.type), height: nodeH(gn.type) }}
      title={gn.id}
      className={`group flex items-center gap-1.5 px-2 rounded border text-xs select-none
        ${navigable ? 'cursor-pointer' : 'cursor-default'}
        ${isRoot
          ? 'bg-slate-700 border-slate-400 font-semibold text-white'
          : meta
            ? 'bg-slate-900 border-slate-700 text-slate-400'
            : 'bg-slate-800 border-slate-600 text-slate-200'}`}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} />
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span className="truncate flex-1 min-w-0">{gn.display_name}</span>
      {gn.mod_source && (
        <span className="shrink-0 text-[9px] text-emerald-400 leading-tight">{gn.mod_source}</span>
      )}
      {altCount > 1 && slotKey && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); handlers?.current?.openAltPanel(slotKey); }}
          className="shrink-0 ml-0.5 text-[9px] text-slate-500 hover:text-blue-300 border border-slate-700 hover:border-blue-600 rounded px-0.5 leading-tight transition-colors"
          title="Show alternative ingredients"
        >↕{altCount}</button>
      )}
      {!isRoot && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); handlers?.current?.hideNode(gn.id); }}
          className="shrink-0 ml-0.5 text-[9px] text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
          title="Hide this node"
        >✕</button>
      )}
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
  preferCraftable: boolean,
  slotSelections: Map<string, string>,
  hiddenNodeIds: Set<string>,
): { rfNodes: RFNode[]; rfEdges: RFEdge[]; slotGroups: Map<string, SlotGroup> } {
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

  const seen = new Set<string>([rootId]);
  type Coll = { source: string; target: string; edge: typeof dataset.edges[0]; isTreeEdge: boolean };
  const collected: Coll[] = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  const allSlotGroups = new Map<string, SlotGroup>();

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth >= maxHops) continue;

    const allOut = index.outEdges.get(item.id) ?? [];

    // ── Component slots: group alternatives, pick active ────────────────────
    type AltEntry = { nodeId: string; edge: typeof allOut[0] };
    const slotMap = new Map<string, { alts: AltEntry[]; defaultNodeId: string | null }>();
    for (const edge of allOut) {
      if (edge.type !== 'requires_component') continue;
      const sk = `${item.id}:${edge.recipe_key ?? ''}:${edge.slot_index ?? ''}`;
      const g = slotMap.get(sk) ?? { alts: [], defaultNodeId: null };
      g.alts.push({ nodeId: edge.to, edge });
      if (edge.is_default) g.defaultNodeId = edge.to;
      slotMap.set(sk, g);
    }

    for (const [sk, { alts, defaultNodeId }] of slotMap) {
      const visible = alts.filter((a) => !hiddenNodeIds.has(a.nodeId));
      if (visible.length === 0) continue;

      // Determine active index among visible alternatives
      let activeIdx = 0;
      // 1. Default edge
      const defIdx = visible.findIndex((a) => a.nodeId === defaultNodeId);
      if (defIdx >= 0) activeIdx = defIdx;
      // 2. Prefer craftable
      if (preferCraftable) {
        const ci = visible.findIndex((a) => nodes[a.nodeId]?.learn_method != null);
        if (ci >= 0) activeIdx = ci;
      }
      // 3. User selection (by nodeId — survives hiding other alts)
      if (slotSelections.has(sk)) {
        const selId = slotSelections.get(sk)!;
        const si = visible.findIndex((a) => a.nodeId === selId);
        if (si >= 0) activeIdx = si;
      }

      const active = visible[activeIdx];
      allSlotGroups.set(sk, {
        slotKey: sk,
        sourceId: item.id,
        alternatives: visible.map((a) => a.nodeId),
        activeIdx,
      });

      const target = active.nodeId;
      const isTreeEdge = !seen.has(target);
      collected.push({ source: item.id, target, edge: active.edge, isTreeEdge });
      if (isTreeEdge) {
        seen.add(target);
        if (!isMeta(getNode(target).type)) queue.push({ id: target, depth: item.depth + 1 });
      }
    }

    // ── Non-component edges (skills, qualities, proficiencies) ────────────────
    for (const edge of allOut) {
      if (edge.type === 'requires_component') continue;
      if (!DEP_TYPES.has(edge.type)) continue;
      if (!edge.is_default) continue;
      if (!showMeta) continue;

      const target =
        edge.type === 'requires_skill'
          ? ensureLevelNode(edge.to, edge.quality_level ?? 0, 'skill')
          : edge.to;

      const isTreeEdge = !seen.has(target);
      collected.push({ source: item.id, target, edge, isTreeEdge });
      if (isTreeEdge) {
        seen.add(target);
        if (!isMeta(getNode(target).type)) queue.push({ id: target, depth: item.depth + 1 });
      }
    }
  }

  // Build nodeId → slotInfo lookup for nodes that have alternatives
  const nodeSlotInfo = new Map<string, { slotKey: string; altCount: number }>();
  for (const [sk, group] of allSlotGroups) {
    if (group.alternatives.length > 1) {
      nodeSlotInfo.set(group.alternatives[group.activeIdx], { slotKey: sk, altCount: group.alternatives.length });
    }
  }

  // ── Dagre layout ──────────────────────────────────────────────────────────
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 60, marginx: 24, marginy: 24 });

  for (const id of seen) {
    const type = getNode(id).type;
    g.setNode(id, { width: nodeW(type), height: nodeH(type) });
  }
  const dagreEdgeSeen = new Set<string>();
  for (const { source, target } of collected) {
    const key = `${source}\x00${target}`;
    if (!dagreEdgeSeen.has(key)) { dagreEdgeSeen.add(key); g.setEdge(source, target); }
  }
  dagre.layout(g);

  // ── Assemble RF nodes and edges ────────────────────────────────────────────
  const rfNodes: RFNode[] = [...seen].map((id) => {
    const type = getNode(id).type;
    const pos = g.node(id);
    const si = nodeSlotInfo.get(id);
    return {
      id,
      type: 'cdda',
      position: pos
        ? { x: pos.x - nodeW(type) / 2, y: pos.y - nodeH(type) / 2 }
        : { x: 0, y: 0 },
      data: {
        graphNode: getNode(id),
        isRoot: id === rootId,
        harvestedFrom: dataset.harvested_from,
        hasDeps: (index.outEdges.get(id) ?? []).some((e) => DEP_TYPES.has(e.type)),
        slotKey: si?.slotKey,
        altCount: si?.altCount ?? 0,
        // handlers injected by GraphView after useMemo
      },
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

  return { rfNodes, rfEdges, slotGroups: allSlotGroups };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface GraphViewProps {
  rootNodeId: string;
  activeDataset: Dataset;
  graphIndex: GraphIndex;
  preferCraftable?: boolean;
  onRootChange: (id: string) => void;
}

export default function GraphView({
  rootNodeId,
  activeDataset,
  graphIndex,
  preferCraftable = false,
  onRootChange,
}: GraphViewProps) {
  const [maxHops, setMaxHops] = useState(3);
  const [showMeta, setShowMeta] = useState(true);
  const [selectedMetaId, setSelectedMetaId] = useState<string | null>(null);
  const [slotSelections, setSlotSelections] = useState<Map<string, string>>(new Map());
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(new Set());
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);

  // History stack.
  const [history, setHistory] = useState<string[]>([rootNodeId]);
  const [histIdx, setHistIdx] = useState(0);
  const suppressReset = useRef(false);

  useEffect(() => {
    if (suppressReset.current) {
      suppressReset.current = false;
    } else {
      setHistory([rootNodeId]);
      setHistIdx(0);
    }
    // Always clear slot/hide state when the root item changes
    setSlotSelections(new Map());
    setHiddenNodeIds(new Set());
    setSelectedSlotKey(null);
    setSelectedMetaId(null);
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

  const { rfNodes: baseRfNodes, rfEdges, slotGroups } = useMemo(
    () => buildLayoutedGraph(currentRoot, activeDataset, graphIndex, maxHops, showMeta, preferCraftable, slotSelections, hiddenNodeIds),
    [currentRoot, activeDataset, graphIndex, maxHops, showMeta, preferCraftable, slotSelections, hiddenNodeIds],
  );

  // Stable handler ref — avoids putting callbacks inside useMemo
  const handlersRef = useRef<GraphHandlers>({ openAltPanel: () => {}, hideNode: () => {} });
  handlersRef.current = {
    openAltPanel: (sk: string) => {
      setSelectedMetaId(null);
      setSelectedSlotKey(sk);
    },
    hideNode: (nodeId: string) => {
      setHiddenNodeIds((prev) => new Set([...prev, nodeId]));
      setSelectedSlotKey(null);
    },
  };

  // Inject the stable handlersRef into every node's data
  const rfNodes = useMemo(
    () => baseRfNodes.map((n) => ({ ...n, data: { ...n.data, handlers: handlersRef } })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseRfNodes],
  );

  const currentNode = activeDataset.nodes[currentRoot];

  // Timer-based double-click: ReactFlow's onNodeDoubleClick is unreliable across versions.
  const lastClickRef = useRef<{ id: string; time: number } | null>(null);

  const handleNodeClick: NodeMouseHandler = (_evt, node) => {
    const gn = node.data.graphNode as GraphNode;
    const now = Date.now();
    const last = lastClickRef.current;

    if (last && last.id === node.id && now - last.time < 300) {
      // Double-click: navigate
      lastClickRef.current = null;
      if (node.id === currentRoot) return;
      if ((gn.type === 'item' || gn.type === 'construction' || gn.type === 'practice') && node.data.hasDeps) {
        navigateTo(node.id);
      }
      return;
    }

    lastClickRef.current = { id: node.id, time: now };

    // Single-click: toggle meta panel for quality/group, close alt panel
    setSelectedSlotKey(null);
    if (gn.type === 'quality' || gn.type === 'group') {
      setSelectedMetaId((prev) => (prev === node.id ? null : node.id));
    } else {
      setSelectedMetaId(null);
    }
  };

  const selectedMetaNode = selectedMetaId ? (
    activeDataset.nodes[selectedMetaId] ?? baseRfNodes.find((n) => n.id === selectedMetaId)?.data.graphNode as GraphNode | undefined
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

        <div className="ml-auto flex items-center gap-2">
          {hiddenNodeIds.size > 0 && (
            <button
              onClick={() => { setHiddenNodeIds(new Set()); setSelectedSlotKey(null); }}
              className="text-slate-400 hover:text-slate-200 border border-slate-600 hover:border-slate-400 rounded px-2 py-0.5 transition-colors"
              title="Restore all hidden nodes"
            >{hiddenNodeIds.size} hidden — Show all</button>
          )}
          <span className="text-slate-600">{rfNodes.length} nodes · {rfEdges.length} edges</span>
        </div>
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

        {/* Alt selection panel — shown when a node's ↕ badge is clicked */}
        {selectedSlotKey && (() => {
          const group = slotGroups.get(selectedSlotKey);
          if (!group) return null;
          const sourceNode = activeDataset.nodes[group.sourceId];
          return (
            <div className="absolute top-3 left-3 w-60 bg-slate-800 border border-slate-600 rounded shadow-xl text-xs text-slate-300 flex flex-col max-h-[70%]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 shrink-0">
                <span className="font-semibold text-blue-300">Swap ingredient</span>
                <button onClick={() => setSelectedSlotKey(null)} className="text-slate-500 hover:text-slate-200 transition-colors ml-2">✕</button>
              </div>
              <p className="px-3 pt-2 pb-1 text-slate-500 shrink-0 truncate">
                for: {sourceNode?.display_name ?? group.sourceId}
              </p>
              <ul className="overflow-y-auto px-3 pb-2 space-y-0.5">
                {group.alternatives.map((nodeId, idx) => {
                  const n = activeDataset.nodes[nodeId];
                  const isActive = idx === group.activeIdx;
                  const dot = n?.learn_method !== null && n?.learn_method !== undefined ? 'bg-blue-400' : n?.spawn_class === 'environment_gather' ? 'bg-green-400' : (activeDataset.harvested_from?.[nodeId]?.length ? 'bg-amber-400' : 'bg-slate-400');
                  return (
                    <li key={nodeId}>
                      <button
                        onClick={() => {
                          setSlotSelections((prev) => new Map(prev).set(selectedSlotKey!, nodeId));
                          setSelectedSlotKey(null);
                        }}
                        className={`text-left w-full flex items-center gap-1.5 py-1 px-1 rounded transition-colors ${
                          isActive ? 'bg-slate-700 text-white' : 'hover:bg-slate-700 text-slate-300'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                        <span className="truncate flex-1">{n?.display_name ?? nodeId}</span>
                        {isActive && <span className="text-slate-500 shrink-0">active</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })()}

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
