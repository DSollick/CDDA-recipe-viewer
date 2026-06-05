import { Dataset } from '../types';

interface EraSidebarProps {
  eras: string[];
  activeDataset: Dataset | null;
  selectedEra: string | null;
  hasUncategorized: boolean;
  uncategorizedCount: number;
  onSelectEra: (era: string) => void;
}

export default function EraSidebar({
  eras,
  activeDataset,
  selectedEra,
  hasUncategorized,
  uncategorizedCount,
  onSelectEra,
}: EraSidebarProps) {
  if (!activeDataset) {
    return <aside className="w-[200px] shrink-0 bg-slate-800 border-r border-slate-700" />;
  }

  // Count only 'item' type nodes per era (activeDataset is non-null here after the early return)
  const ds = activeDataset;
  function eraItemCount(era: string): number {
    const ids = ds.eras[era] ?? [];
    return ids.filter((id) => ds.nodes[id]?.type === 'item').length;
  }

  return (
    <aside className="w-[200px] shrink-0 bg-slate-800 border-r border-slate-700 overflow-y-auto flex flex-col">
      <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-700">
        Eras
      </div>
      <nav className="flex-1 py-1">
        {eras.map((era) => {
          const count = eraItemCount(era);
          if (count === 0) return null;
          const isActive = selectedEra === era;
          return (
            <button
              key={era}
              onClick={() => onSelectEra(era)}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${
                isActive
                  ? 'bg-slate-700 text-white font-medium'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <span className="capitalize">{era}</span>
              <span
                className={`text-xs rounded-full px-1.5 py-0.5 ${
                  isActive ? 'bg-slate-600 text-slate-200' : 'bg-slate-700 text-slate-400'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}

        {hasUncategorized && (
          <button
            onClick={() => onSelectEra('__uncategorized__')}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${
              selectedEra === '__uncategorized__'
                ? 'bg-slate-700 text-white font-medium'
                : 'text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <span>Uncategorized</span>
            <span
              className={`text-xs rounded-full px-1.5 py-0.5 ${
                selectedEra === '__uncategorized__'
                  ? 'bg-slate-600 text-slate-200'
                  : 'bg-slate-700 text-slate-400'
              }`}
            >
              {uncategorizedCount}
            </span>
          </button>
        )}
      </nav>
    </aside>
  );
}
