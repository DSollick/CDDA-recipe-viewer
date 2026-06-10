import React from 'react';
import { ViewMode, ModEntry, Dataset } from '../types';
import SearchBar from './SearchBar';
import { getModPalette } from '../modColors';

interface HeaderProps {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  onLogoClick: () => void;
  mods: ModEntry[];
  activeModId: string;
  setActiveModId: (id: string) => void;
  activeDataset: Dataset | null;
  onSelectItem: (nodeId: string) => void;
  preferCraftable: boolean;
  onTogglePreferCraftable: () => void;
  showModOnly: boolean;
  onToggleShowModOnly: () => void;
}

export default function Header({
  view,
  setView,
  onLogoClick,
  mods,
  activeModId,
  setActiveModId,
  activeDataset,
  onSelectItem,
  preferCraftable,
  onTogglePreferCraftable,
  showModOnly,
  onToggleShowModOnly,
}: HeaderProps) {
  const activeMod = mods.find((m) => m.id === activeModId);
  const isVanilla = activeModId === 'vanilla';
  const modPalette = getModPalette(activeModId);
  return (
    <header className="flex items-center gap-4 px-4 py-2 bg-slate-800 border-b border-slate-700 h-14 shrink-0">
      {/* Title */}
      <button
        onClick={onLogoClick}
        className="text-slate-100 font-bold text-lg whitespace-nowrap hover:text-white transition-colors"
      >
        CDDA Recipe Viewer
      </button>

      {/* Nav */}
      <nav className="flex items-center gap-1 ml-2">
        <NavBtn
          active={view === 'browse' || view === 'tree'}
          onClick={() => setView(view === 'graph' ? 'tree' : 'browse')}
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

      {/* Mod-only filter — hidden on vanilla since it would always show 0 items */}
      {!isVanilla && (
        <button
          onClick={onToggleShowModOnly}
          className={`text-xs px-2.5 py-1 rounded border transition-colors shrink-0 ${
            showModOnly
              ? `${modPalette.activeBg} ${modPalette.activeBorder} ${modPalette.activeText}`
              : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200'
          }`}
          title={`Show only items added by ${activeMod?.label ?? activeModId}`}
        >
          {activeMod?.label ?? activeModId} only
        </button>
      )}

      {/* Craftable first toggle */}
      <button
        onClick={onTogglePreferCraftable}
        className={`text-xs px-2.5 py-1 rounded border transition-colors shrink-0 ${
          preferCraftable
            ? 'bg-blue-900 border-blue-600 text-blue-200'
            : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200'
        }`}
        title="Sort category browser: craftable first, then forageable, then loot-only"
      >
        Craftable first
      </button>

      {/* Search */}
      <SearchBar activeDataset={activeDataset} onSelectItem={onSelectItem} setView={setView} />

      {/* Mod selector */}
      {mods.length > 1 && (
        <div className="flex items-center rounded overflow-hidden border border-slate-600 text-sm shrink-0">
          {mods.map((mod) => (
            <ToggleBtn
              key={mod.id}
              modId={mod.id}
              active={activeModId === mod.id}
              onClick={() => setActiveModId(mod.id)}
            >
              {mod.label}
            </ToggleBtn>
          ))}
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
  modId,
  active,
  onClick,
  children,
}: {
  modId: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const p = getModPalette(modId);
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 transition-colors ${
        active ? `${p.activeBg} ${p.activeText}` : 'bg-slate-800 text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}
