import { useState, useMemo } from 'react';
import { ViewMode } from './types';
import { useGraph } from './hooks/useGraph';
import Header from './components/Header';
import EraSidebar from './components/EraSidebar';
import EraGrid from './components/EraGrid';
import DependencyTree from './components/DependencyTree';
import NodeDetail from './components/NodeDetail';
import BottleneckView from './components/BottleneckView';
import GraphView from './components/GraphView';

// Era display order
const ERA_ORDER = [
  'wood',
  'stone',
  'bone',
  'leather',
  'copper',
  'bronze',
  'iron',
  'glass',
  'chemical',
  'plastics',
  'combustion',
  'electrical',
  'energy',
];

export default function App() {
  const { loadState, errorMessage, graphData, activeDataset, activeKey, setActiveKey, graphIndex, hasBoth } =
    useGraph();

  const [view, setView] = useState<ViewMode>('era');
  const [selectedEra, setSelectedEra] = useState<string | null>(null);
  const [preferCraftable, setPreferCraftable] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);

  // Tree-view navigation history — shared by all item-navigation paths
  const [treeHistory, setTreeHistory] = useState<string[]>([]);
  const [treeHistIdx, setTreeHistIdx] = useState(-1);

  // Ordered list of eras present in current dataset
  const orderedEras = useMemo<string[]>(() => {
    if (!activeDataset) return [];
    const present = new Set(Object.keys(activeDataset.eras));
    const result: string[] = [];
    for (const era of ERA_ORDER) {
      if (present.has(era)) result.push(era);
    }
    // Add any eras not in ERA_ORDER (except null — handled as 'Uncategorized')
    for (const era of Object.keys(activeDataset.eras)) {
      if (!ERA_ORDER.includes(era) && !result.includes(era)) result.push(era);
    }
    return result;
  }, [activeDataset]);

  // The node shown in the detail panel: hoveredNodeId takes priority, else detailNodeId (selected item)
  const panelNodeId = hoveredNodeId ?? detailNodeId ?? selectedItemId;

  // Single unified navigation function — every path that picks a new item goes here.
  // This ensures provider links, era grid clicks, and double-clicks in the tree all
  // append to the same history stack so back/forward always works.
  function navigateTo(nodeId: string) {
    if (nodeId === selectedItemId) return;
    const insertAt = treeHistIdx + 1;
    setTreeHistory((prev) => [...prev.slice(0, insertAt), nodeId]);
    setTreeHistIdx(insertAt);
    setSelectedItemId(nodeId);
    setDetailNodeId(nodeId);
    setHoveredNodeId(null);
  }

  function handleSelectItem(nodeId: string) {
    navigateTo(nodeId);
    setView((v) => v === 'graph' ? 'graph' : 'tree');
  }

  function navigateTreeTo(nodeId: string) {
    navigateTo(nodeId);
  }

  function treeBack() {
    const newIdx = treeHistIdx - 1;
    const id = treeHistory[newIdx];
    setTreeHistIdx(newIdx);
    setSelectedItemId(id);
    setDetailNodeId(id);
    setHoveredNodeId(null);
  }

  function treeForward() {
    const newIdx = treeHistIdx + 1;
    const id = treeHistory[newIdx];
    setTreeHistIdx(newIdx);
    setSelectedItemId(id);
    setDetailNodeId(id);
    setHoveredNodeId(null);
  }

  const treeCanBack = treeHistIdx > 0;
  const treeCanForward = treeHistIdx < treeHistory.length - 1;

  function handleSelectEra(era: string) {
    setSelectedEra(era);
    setView('era');
  }

  // Also handle null-era nodes as "Uncategorized"
  const nullEraNodeIds = useMemo<string[]>(() => {
    if (!activeDataset) return [];
    return Object.values(activeDataset.nodes)
      .filter((n) => n.era === null && n.type === 'item')
      .map((n) => n.id);
  }, [activeDataset]);

  const hasUncategorized = nullEraNodeIds.length > 0;

  // When dataset changes, reset all navigation
  function handleSetActiveKey(k: typeof activeKey) {
    setActiveKey(k);
    setSelectedItemId(null);
    setDetailNodeId(null);
    setSelectedEra(null);
    setTreeHistory([]);
    setTreeHistIdx(-1);
    setView('era');
  }

  // Data banner content
  const dataBanner = useMemo<string | null>(() => {
    if (!graphData) return null;
    const meta = graphData.meta;
    if (activeKey === 'experimental') {
      const parts: string[] = ['Experimental'];
      if (meta.cdda_experimental_date) {
        const d = new Date(meta.cdda_experimental_date);
        parts.push(`built ${d.toISOString().slice(0, 10)}`);
      }
      if (meta.cdda_experimental_commit) {
        parts.push(`commit ${meta.cdda_experimental_commit.slice(0, 7)}`);
      }
      return parts.join(' — ');
    } else {
      const parts: string[] = ['Stable'];
      if (meta.cdda_stable_tag) parts.push(`tag ${meta.cdda_stable_tag}`);
      if (meta.cdda_stable_commit) parts.push(`commit ${meta.cdda_stable_commit.slice(0, 7)}`);
      return parts.join(' — ');
    }
  }, [graphData, activeKey]);

  if (loadState === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-300">
        <div className="text-center">
          <div className="text-2xl font-bold mb-2">Loading graph data…</div>
          <div className="text-slate-500 text-sm">Fetching /graph.json</div>
        </div>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-300">
        <div className="text-center">
          <div className="text-2xl font-bold mb-2 text-red-400">Failed to load graph data</div>
          <div className="text-slate-400 text-sm font-mono bg-slate-800 rounded px-4 py-2 mt-3">
            {errorMessage}
          </div>
          <div className="text-slate-500 text-sm mt-3">
            Make sure <code className="text-slate-300">public/graph.json</code> exists.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col" style={{ minWidth: '1280px' }}>
      <Header
        view={view}
        setView={setView}
        activeKey={activeKey}
        setActiveKey={handleSetActiveKey}
        hasBoth={hasBoth}
        activeDataset={activeDataset}
        onSelectItem={handleSelectItem}
        preferCraftable={preferCraftable}
        onTogglePreferCraftable={() => setPreferCraftable((v) => !v)}
      />

      {/* Data banner */}
      {dataBanner && (
        <div className="bg-slate-800 border-b border-slate-700 px-4 py-1 text-xs text-slate-400 flex items-center gap-3">
          <span>{dataBanner}</span>
          {import.meta.env.VITE_DEPLOY_SHA && (
            <span className="text-slate-600">site {import.meta.env.VITE_DEPLOY_SHA.slice(0, 7)}</span>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Era Sidebar */}
        {view !== 'bottlenecks' && view !== 'graph' && (
          <EraSidebar
            eras={orderedEras}
            activeDataset={activeDataset}
            selectedEra={selectedEra}
            hasUncategorized={hasUncategorized}
            uncategorizedCount={nullEraNodeIds.length}
            onSelectEra={handleSelectEra}
          />
        )}

        {/* Main area */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {view === 'bottlenecks' && (
            <BottleneckView
              activeDataset={activeDataset}
              onSelectItem={handleSelectItem}
            />
          )}

          {view === 'graph' && selectedItemId && activeDataset && graphIndex && (
            <GraphView
              rootNodeId={selectedItemId}
              activeDataset={activeDataset}
              graphIndex={graphIndex}
              onRootChange={(id) => setSelectedItemId(id)}
            />
          )}

          {view === 'graph' && !selectedItemId && (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Select an item from the era grid or search bar first.
            </div>
          )}

          {view === 'era' && (
            <EraGrid
              era={selectedEra}
              activeDataset={activeDataset}
              nullEraNodeIds={nullEraNodeIds}
              harvestedFrom={activeDataset?.harvested_from}
              preferCraftable={preferCraftable}
              onSelectItem={handleSelectItem}
            />
          )}

          {view === 'tree' && selectedItemId && activeDataset && graphIndex && (
            <div className="flex flex-1 overflow-hidden">
              {/* Dependency tree — left 60% */}
              <div className="w-3/5 flex flex-col border-r border-slate-700">
                {/* Navigation bar */}
                <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700 bg-slate-800 text-xs text-slate-300 shrink-0">
                  <button
                    onClick={treeBack}
                    disabled={!treeCanBack}
                    className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Back"
                  >←</button>
                  <button
                    onClick={treeForward}
                    disabled={!treeCanForward}
                    className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Forward"
                  >→</button>
                  <span className="text-slate-200 font-medium truncate max-w-48">
                    {activeDataset.nodes[selectedItemId]?.display_name ?? selectedItemId}
                  </span>
                  {treeHistory.length > 1 && (
                    <span className="text-slate-600">{treeHistIdx + 1} / {treeHistory.length}</span>
                  )}
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <DependencyTree
                    rootNodeId={selectedItemId}
                    nodes={activeDataset.nodes}
                    graphIndex={graphIndex}
                    harvestedFrom={activeDataset.harvested_from}
                    onHoverNode={setHoveredNodeId}
                    onClickNode={(id) => { setDetailNodeId(id); setHoveredNodeId(null); }}
                    onDoubleClickNode={(id) => navigateTreeTo(id)}
                    selectedNodeId={detailNodeId}
                  />
                </div>
              </div>
              {/* Detail panel — right 40% */}
              <div className="w-2/5 overflow-auto p-4">
                {panelNodeId && activeDataset.nodes[panelNodeId] ? (
                  <NodeDetail
                    node={activeDataset.nodes[panelNodeId]}
                    providers={
                      activeDataset.group_providers?.[panelNodeId] ??
                      activeDataset.quality_providers?.[panelNodeId]
                    }
                    nodes={activeDataset.nodes}
                    onSelectItem={handleSelectItem}
                    harvestedFrom={activeDataset.harvested_from?.[panelNodeId]}
                  />
                ) : (
                  <div className="text-slate-500 text-sm mt-4">
                    Click or hover a node in the tree to see details.
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'tree' && !selectedItemId && (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Select an item from the era grid or search bar.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
