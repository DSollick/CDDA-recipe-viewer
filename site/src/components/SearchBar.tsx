import { useState, useRef, useEffect, useMemo } from 'react';
import { Dataset, ViewMode } from '../types';

interface SearchBarProps {
  activeDataset: Dataset | null;
  onSelectItem: (nodeId: string) => void;
  setView: (v: ViewMode) => void;
}

export default function SearchBar({ activeDataset, onSelectItem, setView }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!activeDataset || query.trim().length === 0) return [];
    const q = query.toLowerCase();
    const matched = Object.values(activeDataset.nodes)
      .filter((n) => n.type === 'item' && n.display_name.toLowerCase().includes(q))
      .slice(0, 20);
    matched.sort((a, b) => a.display_name.localeCompare(b.display_name));
    return matched;
  }, [query, activeDataset]);

  useEffect(() => {
    if (results.length > 0) setOpen(true);
    else setOpen(false);
  }, [results]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleSelect(nodeId: string) {
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
    onSelectItem(nodeId);
    setView('tree');
  }

  return (
    <div ref={containerRef} className="relative w-full md:w-64">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        placeholder="Search items..."
        className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-slate-400"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-slate-800 border border-slate-600 rounded shadow-xl z-50 max-h-72 overflow-y-auto">
          {results.map((node) => (
            <button
              key={node.id}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(node.id); }}
              className="w-full text-left px-3 py-2 hover:bg-slate-700 text-sm border-b border-slate-700 last:border-b-0"
            >
              <span className="text-slate-100">{node.display_name}</span>
              {node.era && (
                <span className="ml-2 text-xs text-slate-400">{node.era}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
