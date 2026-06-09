import { Dataset } from '../types';

const CATEGORY_ORDER = [
  'weapons', 'ammo', 'armor', 'tools',
  'food', 'medicine', 'books', 'materials',
  'bionics', 'vehicle_parts',
];

const CATEGORY_LABELS: Record<string, string> = {
  weapons: 'Weapons', ammo: 'Ammo', armor: 'Armor', tools: 'Tools',
  food: 'Food', medicine: 'Medicine', books: 'Books', materials: 'Materials',
  bionics: 'Bionics', vehicle_parts: 'Vehicle Parts',
};

const CATEGORY_DOT: Record<string, string> = {
  weapons: 'bg-red-400', ammo: 'bg-orange-400', armor: 'bg-blue-400', tools: 'bg-amber-400',
  food: 'bg-green-400', medicine: 'bg-teal-400', books: 'bg-violet-400', materials: 'bg-slate-400',
  bionics: 'bg-pink-400', vehicle_parts: 'bg-cyan-400',
};

interface CategorySidebarProps {
  activeDataset: Dataset | null;
  selectedCategory: string | null;
  onSelectCategory: (cat: string) => void;
}

export default function CategorySidebar({ activeDataset, selectedCategory, onSelectCategory }: CategorySidebarProps) {
  if (!activeDataset) {
    return <aside className="w-[200px] shrink-0 bg-slate-800 border-r border-slate-700" />;
  }

  const categories = activeDataset.categories ?? {};

  // Build ordered list: known categories first in CATEGORY_ORDER, then any extras
  const present = new Set(Object.keys(categories));
  const ordered: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    if (present.has(cat)) ordered.push(cat);
  }
  for (const cat of Object.keys(categories)) {
    if (!ordered.includes(cat)) ordered.push(cat);
  }

  function itemCount(cat: string): number {
    const ids = categories[cat] ?? [];
    return ids.filter((id) => activeDataset!.nodes[id]?.type === 'item').length;
  }

  return (
    <aside className="w-[200px] shrink-0 bg-slate-800 border-r border-slate-700 overflow-y-auto flex flex-col">
      <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-700">
        Category
      </div>
      <nav className="flex-1 py-1">
        {ordered.map((cat) => {
          const count = itemCount(cat);
          if (count === 0) return null;
          const isActive = selectedCategory === cat;
          const dot = CATEGORY_DOT[cat] ?? 'bg-slate-400';
          const label = CATEGORY_LABELS[cat] ?? cat;
          return (
            <button
              key={cat}
              onClick={() => onSelectCategory(cat)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                isActive ? 'bg-slate-700 text-white font-medium' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
              <span className="flex-1">{label}</span>
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${isActive ? 'bg-slate-600 text-slate-200' : 'bg-slate-700 text-slate-400'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
