import React from 'react';
import { ViewMode, ModEntry, Dataset } from '../types';
import SearchBar from './SearchBar';
import { getModPalette } from '../modColors';

interface HeaderProps {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  onLogoClick: () => void;
  onMenuClick: () => void;
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
  onMenuClick,
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

  const modOnlyBtn = !isVanilla && (
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
  );

  const craftableBtn = (
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
  );

  const modSelector = mods.length > 1 && (
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
  );

  const navBtns = (
    <nav className="flex items-center gap-1">
      <NavBtn
        active={view === 'browse' || view === 'tree'}
        onClick={() => setView(view === 'graph' ? 'tree' : 'browse')}
      >
        Browse
      </NavBtn>
      <NavBtn active={view === 'graph'} onClick={() => setView('graph')}>
        Graph
      </NavBtn>
    </nav>
  );

  return (
    <header className="bg-slate-800 border-b border-slate-700 shrink-0">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 h-14">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMenuClick}
          className="md:hidden flex flex-col justify-center gap-1.5 w-6 h-6 shrink-0"
          aria-label="Open category menu"
        >
          <span className="block h-0.5 bg-slate-300 rounded" />
          <span className="block h-0.5 bg-slate-300 rounded" />
          <span className="block h-0.5 bg-slate-300 rounded" />
        </button>

        {/* Logo */}
        <button
          onClick={onLogoClick}
          className="text-slate-100 font-bold text-lg whitespace-nowrap hover:text-white transition-colors shrink-0"
        >
          CDDA Recipe Viewer
        </button>

        {/* Nav — desktop only */}
        <div className="hidden md:flex ml-2">{navBtns}</div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Filters — desktop only */}
        <div className="hidden md:flex items-center gap-2">
          {modOnlyBtn}
          {craftableBtn}
        </div>

        {/* Search — desktop only; mobile gets its own row */}
        <div className="hidden md:block">
          <SearchBar activeDataset={activeDataset} onSelectItem={onSelectItem} setView={setView} />
        </div>

        {/* Mod selector — desktop only */}
        <div className="hidden md:flex">{modSelector}</div>
      </div>

      {/* Mobile search row */}
      <div className="flex md:hidden px-3 pt-2 pb-2 border-t border-slate-700">
        <SearchBar activeDataset={activeDataset} onSelectItem={onSelectItem} setView={setView} />
      </div>

      {/* Secondary strip — mobile only: nav + filters + mod selector, wraps if needed */}
      <div className="flex md:hidden items-center gap-2 px-3 py-2 border-t border-slate-700 flex-wrap">
        {navBtns}
        <div className="w-px h-4 bg-slate-700 shrink-0" />
        {modOnlyBtn}
        <div className="flex-1" />
        {craftableBtn}
        {mods.length > 1 && (
          <select
            value={activeModId}
            onChange={(e) => setActiveModId(e.target.value)}
            className={`text-xs bg-slate-700 rounded px-2 py-1 shrink-0 border ${modPalette.activeBorder} ${modPalette.activeText}`}
          >
            {mods.map((mod) => (
              <option key={mod.id} value={mod.id} className="bg-slate-800 text-slate-200">
                {mod.label}
              </option>
            ))}
          </select>
        )}
      </div>
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
      className={`px-3 py-1 rounded text-sm font-medium transition-colors shrink-0 ${
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
      className={`px-3 py-1 transition-colors text-sm ${
        active ? `${p.activeBg} ${p.activeText}` : 'bg-slate-800 text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}
