import { useState, useMemo } from 'react';
import { ViewMode } from './types';
import { useGraph } from './hooks/useGraph';
import Header from './components/Header';
import CategorySidebar from './components/CategorySidebar';
import CategoryGrid from './components/CategoryGrid';
import DependencyTree from './components/DependencyTree';
import NodeDetail from './components/NodeDetail';
import BottleneckView from './components/BottleneckView';
import GraphView from './components/GraphView';

export default function App() {
  const { loadState, errorMessage, manifest, activeDataset, activeModId, setActiveModId, graphIndex } =
    useGraph();

  const [view, setView] = useState<ViewMode>('browse');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [preferCraftable, setPreferCraftable] = useState(false);
  const [showModOnly, setShowModOnly] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);

  const [treeHistory, setTreeHistory] = useState<string[]>([]);
  const [treeHistIdx, setTreeHistIdx] = useState(-1);
  const [treeExpandLevel, setTreeExpandLevel] = useState(-1);

  const panelNodeId = hoveredNodeId ?? detailNodeId ?? selectedItemId;

  function navigateTo(nodeId: string) {
    if (nodeId === selectedItemId) return;
    const insertAt = treeHistIdx + 1;
    setTreeHistory((prev) => [...prev.slice(0, insertAt), nodeId]);
    setTreeHistIdx(insertAt);
    setSelectedItemId(nodeId);
    setDetailNodeId(nodeId);
    setHoveredNodeId(null);
    setTreeExpandLevel(-1);
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

  function handleSelectCategory(cat: string) {
    setSelectedCategory(cat);
    setView('browse');
  }

  function handleSetActiveMod(id: string) {
    setActiveModId(id);
    setSelectedItemId(null);
    setDetailNodeId(null);
    setSelectedCategory(null);
    setTreeHistory([]);
    setTreeHistIdx(-1);
    setShowModOnly(false);
    setView('browse');
  }

  function handleLogoClick() {
    if (view !== 'browse' || selectedCategory !== null) {
      // First press: return to blank browse
      setView('browse');
      setSelectedCategory(null);
    } else {
      // Already at blank browse: full reset to vanilla with no filters
      handleSetActiveMod('vanilla');
      setPreferCraftable(false);
    }
  }

  const dataBanner = useMemo<string | null>(() => {
    if (!manifest) return null;
    const activeMod = manifest.mods.find((m) => m.id === activeModId);
    const parts: string[] = [activeMod?.label ?? activeModId];
    if (manifest.cdda_date) {
      const d = new Date(manifest.cdda_date);
      parts.push(`built ${d.toISOString().slice(0, 10)}`);
    }
    if (manifest.cdda_commit) {
      parts.push(`commit ${manifest.cdda_commit}`);
    }
    return parts.join(' — ');
  }, [manifest, activeModId]);

  if (loadState === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-300">
        <div className="text-center">
          <div className="text-2xl font-bold mb-2">Loading…</div>
          <div className="text-slate-500 text-sm">
            {manifest ? `Fetching ${activeModId} dataset` : 'Fetching manifest'}
          </div>
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
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col" style={{ minWidth: '1280px' }}>
      <Header
        view={view}
        setView={setView}
        onLogoClick={handleLogoClick}
        mods={manifest?.mods ?? []}
        activeModId={activeModId}
        setActiveModId={handleSetActiveMod}
        activeDataset={activeDataset}
        onSelectItem={handleSelectItem}
        preferCraftable={preferCraftable}
        onTogglePreferCraftable={() => setPreferCraftable((v) => !v)}
        showModOnly={showModOnly}
        onToggleShowModOnly={() => setShowModOnly((v) => !v)}
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
        {view !== 'bottlenecks' && view !== 'graph' && (
          <CategorySidebar
            activeDataset={activeDataset}
            selectedCategory={selectedCategory}
            onSelectCategory={handleSelectCategory}
            showModOnly={showModOnly}
          />
        )}

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
              preferCraftable={preferCraftable}
              onRootChange={(id) => setSelectedItemId(id)}
            />
          )}

          {view === 'graph' && !selectedItemId && (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Select an item from the category browser or search bar first.
            </div>
          )}

          {view === 'browse' && (
            <CategoryGrid
              category={selectedCategory}
              activeDataset={activeDataset}
              preferCraftable={preferCraftable}
              showModOnly={showModOnly}
              onSelectItem={handleSelectItem}
            />
          )}

          {view === 'tree' && selectedItemId && activeDataset && graphIndex && (
            <div className="flex flex-1 overflow-hidden">
              <div className="w-3/5 flex flex-col border-r border-slate-700">
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
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => setTreeExpandLevel((v) => v + 1)}
                      className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 transition-colors"
                      title="Expand one more level of visible nodes"
                    >Expand +1</button>
                    {treeExpandLevel >= 0 && (
                      <button
                        onClick={() => setTreeExpandLevel(-1)}
                        className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 transition-colors"
                        title="Collapse all auto-expanded nodes"
                      >Collapse all</button>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <DependencyTree
                    rootNodeId={selectedItemId}
                    nodes={activeDataset.nodes}
                    graphIndex={graphIndex}
                    harvestedFrom={activeDataset.harvested_from}
                    preferCraftable={preferCraftable}
                    expandLevel={treeExpandLevel}
                    onHoverNode={setHoveredNodeId}
                    onClickNode={(id) => { setDetailNodeId(id); setHoveredNodeId(null); }}
                    onDoubleClickNode={(id) => navigateTreeTo(id)}
                    selectedNodeId={detailNodeId}
                  />
                </div>
              </div>
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
                    foragedFrom={activeDataset.foraged_from?.[panelNodeId]}
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
              Select a category from the sidebar or use the search bar.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
