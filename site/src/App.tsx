import { useState, useMemo, useEffect } from 'react';
import { ViewMode } from './types';
import { useGraph } from './hooks/useGraph';
import Header from './components/Header';
import CategorySidebar from './components/CategorySidebar';
import CategoryGrid from './components/CategoryGrid';
import DependencyTree from './components/DependencyTree';
import NodeDetail from './components/NodeDetail';
import GraphView from './components/GraphView';

// Parse URL once at module load — synchronous, no re-render cost
const _p = new URLSearchParams(window.location.search);
const _initMod     = _p.get('mod') ?? 'vanilla';
const _initView    = (_p.get('view') as ViewMode) ?? 'browse';
const _initItem    = _p.get('item');
const _initCat     = _p.get('cat');
const _initDetail  = _p.get('detail');
const _initCraft   = _p.get('craft') !== '0';   // default true
const _initModOnly = _p.get('modonly') === '1';

export default function App() {
  const { loadState, errorMessage, manifest, activeDataset, activeModId, setActiveModId, graphIndex } =
    useGraph(_initMod);

  const [view, setView] = useState<ViewMode>(_initView);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(_initCat);
  const [preferCraftable, setPreferCraftable] = useState(_initCraft);
  const [showModOnly, setShowModOnly] = useState(_initModOnly);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(_initItem);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [detailNodeId, setDetailNodeId] = useState<string | null>(_initDetail ?? _initItem);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [treeHistory, setTreeHistory] = useState<string[]>(_initItem ? [_initItem] : []);
  const [treeHistIdx, setTreeHistIdx] = useState(_initItem ? 0 : -1);
  const [treeExpandLevel, setTreeExpandLevel] = useState(-1);

  // Sync shareable state → URL (replaceState keeps a single history entry)
  useEffect(() => {
    const p = new URLSearchParams();
    if (activeModId !== 'vanilla')                             p.set('mod', activeModId);
    if (view !== 'browse')                                     p.set('view', view);
    if (selectedCategory)                                      p.set('cat', selectedCategory);
    if (selectedItemId)                                        p.set('item', selectedItemId);
    if (detailNodeId && detailNodeId !== selectedItemId)       p.set('detail', detailNodeId);
    if (!preferCraftable)                                      p.set('craft', '0');
    if (showModOnly)                                           p.set('modonly', '1');
    const qs = p.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
  }, [view, activeModId, selectedCategory, selectedItemId, detailNodeId, preferCraftable, showModOnly]);

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
      setView('browse');
      setSelectedCategory(null);
    } else {
      handleSetActiveMod('vanilla');
      setPreferCraftable(true);
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

  const showSidebar = view !== 'graph';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      <Header
        view={view}
        setView={setView}
        onLogoClick={handleLogoClick}
        onMenuClick={() => setSidebarOpen((v) => !v)}
        mods={manifest?.mods ?? []}
        activeModId={activeModId}
        setActiveModId={handleSetActiveMod}
        activeDataset={activeDataset}
        onSelectItem={handleSelectItem}
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

      {/* Sidebar backdrop — mobile only */}
      {sidebarOpen && showSidebar && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {showSidebar && (
          <CategorySidebar
            activeDataset={activeDataset}
            selectedCategory={selectedCategory}
            onSelectCategory={handleSelectCategory}
            showModOnly={showModOnly}
            preferCraftable={preferCraftable}
            onTogglePreferCraftable={() => setPreferCraftable((v) => !v)}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
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
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm p-4 text-center">
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
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              {/* Tree panel */}
              <div className="flex flex-col md:w-3/5 border-b md:border-b-0 md:border-r border-slate-700 min-h-0 md:h-full" style={{ flex: '0 0 60%' }}>
                <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700 bg-slate-800 text-xs text-slate-300 shrink-0 overflow-x-auto">
                  <button
                    onClick={treeBack}
                    disabled={!treeCanBack}
                    className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                    title="Back"
                  >←</button>
                  <button
                    onClick={treeForward}
                    disabled={!treeCanForward}
                    className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                    title="Forward"
                  >→</button>
                  <span className="text-slate-200 font-medium truncate">
                    {activeDataset.nodes[selectedItemId]?.display_name ?? selectedItemId}
                  </span>
                  {treeHistory.length > 1 && (
                    <span className="text-slate-600 shrink-0">{treeHistIdx + 1} / {treeHistory.length}</span>
                  )}
                  <div className="ml-auto flex items-center gap-1 shrink-0">
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
                      >Collapse All</button>
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
              {/* Detail panel */}
              <div className="md:w-2/5 overflow-auto p-4" style={{ flex: '0 0 40%' }}>
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
                    graphIndex={graphIndex ?? undefined}
                  />
                ) : (
                  <div className="text-slate-500 text-sm mt-4">
                    Tap a node in the tree to see details.
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'tree' && !selectedItemId && (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm p-4 text-center">
              Select a category from the sidebar or use the search bar.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
