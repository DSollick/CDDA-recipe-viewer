import React from 'react';
import { DatasetKey, ViewMode } from '../types';
import SearchBar from './SearchBar';
import { Dataset } from '../types';

interface HeaderProps {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  activeKey: DatasetKey;
  setActiveKey: (k: DatasetKey) => void;
  hasBoth: boolean;
  activeDataset: Dataset | null;
  onSelectItem: (nodeId: string) => void;
  preferCraftable: boolean;
  onTogglePreferCraftable: () => void;
}

export default function Header({
  view,
  setView,
  activeKey,
  setActiveKey,
  hasBoth,
  activeDataset,
  onSelectItem,
  preferCraftable,
  onTogglePreferCraftable,
}: HeaderProps) {
  return (
    <header className="flex items-center gap-4 px-4 py-2 bg-slate-800 border-b border-slate-700 h-14 shrink-0">
      {/* Title */}
      <button
        onClick={() => setView('era')}
        className="text-slate-100 font-bold text-lg whitespace-nowrap hover:text-white transition-colors"
      >
        CDDA Recipe Viewer
      </button>

      {/* Nav */}
      <nav className="flex items-center gap-1 ml-2">
        <NavBtn
          active={view === 'era' || view === 'tree'}
          onClick={() => setView(view === 'graph' ? 'tree' : 'era')}
        >
          Browse
        </NavBtn>
        <NavBtn active={view === 'graph'} onClick={() => setView('graph')}>
          Graph
        </NavBtn>
        <NavBtn active={view === 'bottlenecks'} onClick={() => setView('bottlenecks')}>
          Key Unlocks
        </NavBtn>
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Craftable first toggle */}
      <button
        onClick={onTogglePreferCraftable}
        className={`text-xs px-2.5 py-1 rounded border transition-colors shrink-0 ${
          preferCraftable
            ? 'bg-blue-900 border-blue-600 text-blue-200'
            : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200'
        }`}
        title="Sort era grid: craftable first, then harvestable, then loot-only"
      >
        Craftable first
      </button>

      {/* Search */}
      <SearchBar activeDataset={activeDataset} onSelectItem={onSelectItem} setView={setView} />

      {/* Dataset toggle */}
      {hasBoth && (
        <div className="flex items-center rounded overflow-hidden border border-slate-600 text-sm shrink-0">
          <ToggleBtn
            active={activeKey === 'stable'}
            onClick={() => setActiveKey('stable')}
          >
            Stable
          </ToggleBtn>
          <ToggleBtn
            active={activeKey === 'experimental'}
            onClick={() => setActiveKey('experimental')}
          >
            Experimental
          </ToggleBtn>
        </div>
      )}
    </header>
  );
}

function NavBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
        active
          ? 'bg-slate-600 text-white'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 transition-colors ${
        active ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}
