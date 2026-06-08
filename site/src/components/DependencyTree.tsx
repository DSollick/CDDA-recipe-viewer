import React, { useState, useCallback } from 'react';
import { GraphNode, GraphEdge, GraphIndex } from '../types';
import { buildTreeNode, TreeNode } from '../lib/treeTraversal';

interface DependencyTreeProps {
  rootNodeId: string;
  nodes: Record<string, GraphNode>;
  graphIndex: GraphIndex;
  harvestedFrom?: Record<string, string[]>;
  preferCraftable?: boolean;
  expandLevel?: number;
  onHoverNode: (id: string | null) => void;
  onClickNode: (id: string) => void;
  onDoubleClickNode?: (id: string) => void;
  selectedNodeId: string | null;
}

// Node type dot colors — items use itemDotColor() instead
const TYPE_DOT: Record<string, string> = {
  quality: 'bg-purple-400',
  skill: 'bg-orange-400',
  proficiency: 'bg-orange-300',
  group: 'bg-green-400',
  construction: 'bg-teal-400',
  disassembly: 'bg-teal-400',
  practice: 'bg-teal-400',
};

function itemDotColor(node: GraphNode, harvestedFrom?: Record<string, string[]>): string {
  if (node.incomplete) return 'bg-slate-600';
  if (node.learn_method !== null) return 'bg-blue-400';       // craftable
  if (harvestedFrom?.[node.id]?.length) return 'bg-amber-400'; // harvestable
  return 'bg-slate-400';                                       // loot-only
}

const EDGE_TYPE_LABEL: Record<GraphEdge['type'], string> = {
  requires_component: '',
  requires_tool_quality: 'tool',
  requires_skill: 'skill',
  requires_proficiency: 'prof',
  byproduct_of: 'byproduct',
};

export default function DependencyTree({
  rootNodeId,
  nodes,
  graphIndex,
  harvestedFrom,
  preferCraftable,
  expandLevel,
  onHoverNode,
  onClickNode,
  onDoubleClickNode,
  selectedNodeId,
}: DependencyTreeProps) {
  // expandedNodes: Set of nodeId+depth keys that are manually expanded beyond default
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  // slotSelections: map of "nodeId:slotIndex" -> activeEdgeIndex override
  const [slotSelections, setSlotSelections] = useState<Map<string, number>>(new Map());
  // expandedAlts: set of "nodeId:slotKey" to show all alternatives
  const [expandedAlts, setExpandedAlts] = useState<Set<string>>(new Set());

  // When expandLevel resets to -1 (collapse all), clear manual expansion state
  React.useEffect(() => {
    if ((expandLevel ?? -1) < 0) {
      setExpandedPaths(new Set());
      setExpandedAlts(new Set());
    }
  }, [expandLevel]);

  const rootTree = buildTreeNode(
    rootNodeId,
    null,
    null,
    graphIndex,
    nodes,
    new Set<string>(),
    0,
    2
  );

  const toggleExpand = useCallback((pathKey: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      return next;
    });
  }, []);

  const toggleAlt = useCallback((altKey: string) => {
    setExpandedAlts((prev) => {
      const next = new Set(prev);
      if (next.has(altKey)) next.delete(altKey);
      else next.add(altKey);
      return next;
    });
  }, []);

  const setSlotActive = useCallback((slotKey: string, idx: number) => {
    setSlotSelections((prev) => new Map(prev).set(slotKey, idx));
  }, []);

  return (
    <div className="font-mono text-sm">
      <TreeNodeRow
        treeNode={rootTree}
        nodes={nodes}
        graphIndex={graphIndex}
        expandedPaths={expandedPaths}
        slotSelections={slotSelections}
        expandedAlts={expandedAlts}
        onToggleExpand={toggleExpand}
        onToggleAlt={toggleAlt}
        onSetSlotActive={setSlotActive}
        harvestedFrom={harvestedFrom}
        preferCraftable={preferCraftable}
        expandLevel={expandLevel}
        onHoverNode={onHoverNode}
        onClickNode={onClickNode}
        onDoubleClickNode={onDoubleClickNode}
        selectedNodeId={selectedNodeId}
        pathKey={rootNodeId}
        ancestorPath={new Set([rootNodeId])}
        isRoot
      />
    </div>
  );
}

interface RowProps {
  treeNode: TreeNode;
  nodes: Record<string, GraphNode>;
  graphIndex: GraphIndex;
  expandedPaths: Set<string>;
  slotSelections: Map<string, number>;
  expandedAlts: Set<string>;
  onToggleExpand: (key: string) => void;
  onToggleAlt: (key: string) => void;
  onSetSlotActive: (key: string, idx: number) => void;
  harvestedFrom?: Record<string, string[]>;
  preferCraftable?: boolean;
  expandLevel?: number;
  onHoverNode: (id: string | null) => void;
  onClickNode: (id: string) => void;
  onDoubleClickNode?: (id: string) => void;
  selectedNodeId: string | null;
  pathKey: string;
  ancestorPath: Set<string>;
  isRoot?: boolean;
}

function TreeNodeRow({
  treeNode,
  nodes,
  graphIndex,
  expandedPaths,
  slotSelections,
  expandedAlts,
  harvestedFrom,
  preferCraftable,
  expandLevel,
  onToggleExpand,
  onToggleAlt,
  onSetSlotActive,
  onHoverNode,
  onClickNode,
  onDoubleClickNode,
  selectedNodeId,
  pathKey,
  ancestorPath,
  isRoot = false,
}: RowProps) {
  const node = nodes[treeNode.nodeId];
  const edge = treeNode.edge;

  // Check if this node is a stub (no children loaded yet) and not a cycle
  const isStub =
    !treeNode.isCycle &&
    treeNode.nonComponentChildren.length === 0 &&
    treeNode.componentSlots.length === 0 &&
    !isRoot;

  // Determine if we have children to show
  const hasChildren =
    treeNode.nonComponentChildren.length > 0 || treeNode.componentSlots.length > 0;

  const isExpanded = isRoot || expandedPaths.has(pathKey) || treeNode.depth <= (expandLevel ?? -1);

  // For stubs: check if there are actually edges to expand
  const depEdgesExist =
    isStub &&
    ((graphIndex.outEdges.get(treeNode.nodeId)?.filter(
      (e) =>
        e.type === 'requires_component' ||
        e.type === 'requires_tool_quality' ||
        e.type === 'requires_skill' ||
        e.type === 'requires_proficiency'
    ).length ?? 0) > 0);

  const isSelected = selectedNodeId === treeNode.nodeId;
  const dotColor = !node
    ? 'bg-slate-600'
    : node.type === 'item'
      ? itemDotColor(node, harvestedFrom)
      : (TYPE_DOT[node.type] ?? 'bg-slate-400');

  // Build expanded tree node on demand when user expands a stub
  const expandedNode =
    isStub && isExpanded
      ? buildTreeNode(treeNode.nodeId, edge, treeNode.slot, graphIndex, nodes, ancestorPath, treeNode.depth, treeNode.depth + 2)
      : treeNode;

  const nextAncestors = new Set(ancestorPath);
  nextAncestors.add(treeNode.nodeId);

  return (
    <div className={isRoot ? '' : 'ml-4 border-l border-slate-700 pl-2'}>
      {/* This node row */}
      <div
        className={`flex items-center gap-1.5 py-0.5 px-1 rounded cursor-pointer group transition-colors ${
          isSelected ? 'bg-slate-700' : 'hover:bg-slate-800'
        }`}
        onClick={() => onClickNode(treeNode.nodeId)}
        onDoubleClick={() => onDoubleClickNode?.(treeNode.nodeId)}
        onMouseEnter={() => onHoverNode(treeNode.nodeId)}
        onMouseLeave={() => onHoverNode(null)}
      >
        {/* Expand toggle — only show if there are (or might be) children */}
        {(hasChildren || depEdgesExist) && !treeNode.isCycle ? (
          <button
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onToggleExpand(pathKey);
            }}
            className="text-slate-500 hover:text-slate-300 w-4 h-4 flex items-center justify-center shrink-0 text-xs"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Type dot */}
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />

        {/* Edge type label */}
        {edge && EDGE_TYPE_LABEL[edge.type] && (
          <span className="text-xs text-slate-500 shrink-0 w-10">{EDGE_TYPE_LABEL[edge.type]}</span>
        )}

        {/* Quantity badge (components) */}
        {edge?.type === 'requires_component' && edge.quantity > 1 && (
          <span className="text-xs text-slate-400 shrink-0">{edge.quantity}×</span>
        )}

        {/* Quality level badge */}
        {edge?.type === 'requires_tool_quality' && edge.quality_level !== null && (
          <span className="text-xs text-slate-400 shrink-0">lvl {edge.quality_level}</span>
        )}

        {/* Node name */}
        <span className={`text-sm leading-snug ${isSelected ? 'text-white font-medium' : 'text-slate-200 group-hover:text-white'}`}>
          {node?.display_name ?? treeNode.nodeId}
        </span>

        {/* Cycle stub */}
        {treeNode.isCycle && (
          <span className="text-xs text-slate-500 italic ml-1">(see above)</span>
        )}

        {/* Pseudo / incomplete */}
        {node?.pseudo && (
          <span className="text-xs text-violet-400 ml-1">pseudo</span>
        )}
        {node?.incomplete && (
          <span className="text-xs text-red-400 ml-1">incomplete</span>
        )}
      </div>

      {/* Children */}
      {isExpanded && !treeNode.isCycle && (
        <div>
          {/* Non-component children (skills, proficiencies, tool qualities) */}
          {expandedNode.nonComponentChildren.map((child, i) => {
            const childPath = `${pathKey}::nc::${child.nodeId}::${i}`;
            return (
              <TreeNodeRow
                key={childPath}
                treeNode={child}
                nodes={nodes}
                graphIndex={graphIndex}
                expandedPaths={expandedPaths}
                slotSelections={slotSelections}
                expandedAlts={expandedAlts}
                onToggleExpand={onToggleExpand}
                onToggleAlt={onToggleAlt}
                onSetSlotActive={onSetSlotActive}
                harvestedFrom={harvestedFrom}
                preferCraftable={preferCraftable}
                expandLevel={expandLevel}
                onHoverNode={onHoverNode}
                onClickNode={onClickNode}
                onDoubleClickNode={onDoubleClickNode}
                selectedNodeId={selectedNodeId}
                pathKey={childPath}
                ancestorPath={nextAncestors}
              />
            );
          })}

          {/* Component slots */}
          {expandedNode.componentSlots.map((slotGroup, si) => {
            const slotKey = `${treeNode.nodeId}:slot:${slotGroup.slot.slotIndex ?? si}`;
            let defaultIdx = slotGroup.activeEdgeIndex;
            if (preferCraftable && !slotSelections.has(slotKey) && slotGroup.alternatives.length > 1) {
              const craftableIdx = slotGroup.alternatives.findIndex((alt) => {
                const altNode = nodes[alt.nodeId];
                return altNode?.learn_method !== null && altNode?.learn_method !== undefined;
              });
              if (craftableIdx !== -1) defaultIdx = craftableIdx;
            }
            const activeIdx = slotSelections.get(slotKey) ?? defaultIdx;
            const activeAlt = slotGroup.alternatives[activeIdx];
            const altKey = `${pathKey}::slot${si}`;
            const showingAlts = expandedAlts.has(altKey);
            const hasAlts = slotGroup.alternatives.length > 1;

            if (!activeAlt) return null;

            const activeChildTree = buildTreeNode(
              activeAlt.nodeId,
              activeAlt.edge,
              slotGroup.slot,
              graphIndex,
              nodes,
              nextAncestors,
              treeNode.depth + 1,
              treeNode.depth + 3
            );

            const childPathKey = `${pathKey}::slot${si}::${activeAlt.nodeId}`;

            return (
              <div key={slotKey} className="ml-4 border-l border-slate-700 pl-2">
                {/* Active alternative */}
                <div className="flex items-start gap-1">
                  <div className="flex-1">
                    <TreeNodeRow
                      treeNode={activeChildTree}
                      nodes={nodes}
                      graphIndex={graphIndex}
                      expandedPaths={expandedPaths}
                      slotSelections={slotSelections}
                      expandedAlts={expandedAlts}
                      onToggleExpand={onToggleExpand}
                      onToggleAlt={onToggleAlt}
                      onSetSlotActive={onSetSlotActive}
                      onHoverNode={onHoverNode}
                      onClickNode={onClickNode}
                      harvestedFrom={harvestedFrom}
                      preferCraftable={preferCraftable}
                      expandLevel={expandLevel}
                      onDoubleClickNode={onDoubleClickNode}
                      selectedNodeId={selectedNodeId}
                      pathKey={childPathKey}
                      ancestorPath={nextAncestors}
                    />
                  </div>
                  {/* Alt toggle button */}
                  {hasAlts && (
                    <button
                      onClick={() => onToggleAlt(altKey)}
                      className="shrink-0 text-xs text-slate-500 hover:text-slate-300 mt-0.5 px-1 rounded border border-slate-700 hover:border-slate-500 transition-colors"
                      title="Show alternative components"
                    >
                      {showingAlts ? '▲' : `↕ ${slotGroup.alternatives.length - 1} alt`}
                    </button>
                  )}
                </div>

                {/* Other alternatives */}
                {showingAlts &&
                  slotGroup.alternatives.map((alt, altIdx) => {
                    if (altIdx === activeIdx) return null;
                    const altChildTree = buildTreeNode(
                      alt.nodeId,
                      alt.edge,
                      slotGroup.slot,
                      graphIndex,
                      nodes,
                      nextAncestors,
                      treeNode.depth + 1,
                      treeNode.depth + 3
                    );
                    const altChildPath = `${pathKey}::slot${si}::alt${altIdx}::${alt.nodeId}`;
                    return (
                      <div key={altChildPath} className="flex items-start gap-1">
                        <div className="flex-1 opacity-60">
                          <TreeNodeRow
                            treeNode={altChildTree}
                            nodes={nodes}
                            graphIndex={graphIndex}
                            expandedPaths={expandedPaths}
                            slotSelections={slotSelections}
                            expandedAlts={expandedAlts}
                            onToggleExpand={onToggleExpand}
                            onToggleAlt={onToggleAlt}
                            onSetSlotActive={onSetSlotActive}
                            onHoverNode={onHoverNode}
                            onClickNode={onClickNode}
                            harvestedFrom={harvestedFrom}
                            preferCraftable={preferCraftable}
                            onDoubleClickNode={onDoubleClickNode}
                            selectedNodeId={selectedNodeId}
                            pathKey={altChildPath}
                            ancestorPath={nextAncestors}
                          />
                        </div>
                        <button
                          onClick={() => {
                            onSetSlotActive(slotKey, altIdx);
                            onToggleAlt(altKey); // collapse alts
                          }}
                          className="shrink-0 text-xs text-slate-500 hover:text-slate-300 mt-0.5 px-1 rounded border border-slate-700 hover:border-slate-500 transition-colors"
                          title="Use this alternative"
                        >
                          use
                        </button>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
