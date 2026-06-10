import React from 'react';
import { Dataset, GraphNode } from '../types';

const CATEGORY_LABELS: Record<string, string> = {
  weapons: 'Weapons', ammo: 'Ammo', armor: 'Armor', tools: 'Tools',
  food: 'Food', medicine: 'Medicine', books: 'Books', materials: 'Materials',
  bionics: 'Bionics', vehicle_parts: 'Vehicle Parts',
};

const LEARN_METHOD_COLORS: Record<string, string> = {
  autolearn: 'bg-green-800 text-green-200',
  book: 'bg-blue-800 text-blue-200',
  practice: 'bg-yellow-800 text-yellow-200',
};

function sourcePriority(node: GraphNode): number {
  if (node.learn_method !== null) return 0;
  if (node.spawn_class !== null) return 1;
  return 2;
}

interface CategoryGridProps {
  category: string | null;
  activeDataset: Dataset | null;
  preferCraftable: boolean;
  showModOnly: boolean;
  onSelectItem: (nodeId: string) => void;
}

export default function CategoryGrid({ category, activeDataset, preferCraftable, showModOnly, onSelectItem }: CategoryGridProps) {
  if (!activeDataset) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">No dataset loaded.</div>;
  }

  if (category === null) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Select a category from the sidebar to browse items.</div>;
  }

  const nodeIds = activeDataset.categories?.[category] ?? [];
  const items: GraphNode[] = nodeIds
    .map((id) => activeDataset.nodes[id])
    .filter((n): n is GraphNode => {
      if (!n || n.type !== 'item') return false;
      if (showModOnly && !n.mod_source) return false;
      return true;
    });

  items.sort((a, b) => {
    if (preferCraftable) {
      const diff = sourcePriority(a) - sourcePriority(b);
      if (diff !== 0) return diff;
    }
    return a.display_name.localeCompare(b.display_name);
  });

  const label = CATEGORY_LABELS[category] ?? category;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="text-lg font-semibold text-slate-200 mb-4">
        {label}
        <span className="ml-2 text-sm font-normal text-slate-500">{items.length} items</span>
      </h2>
      {items.length === 0 ? (
        <div className="text-slate-500 text-sm">No items in this category.</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {items.map((node) => (
            <ItemCard key={node.id} node={node} onSelect={onSelectItem} />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemCard({ node, onSelect }: { node: GraphNode; onSelect: (id: string) => void }) {
  const learnColor = node.learn_method ? (LEARN_METHOD_COLORS[node.learn_method] ?? 'bg-slate-700 text-slate-300') : null;

  return (
    <button
      onClick={() => onSelect(node.id)}
      className="bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 rounded-lg p-3 text-left transition-colors group"
    >
      <div className="font-medium text-slate-100 group-hover:text-white text-sm leading-snug mb-2">
        {node.display_name}
      </div>
      <div className="flex flex-wrap gap-1 mt-auto">
        {node.learn_method && learnColor && (
          <Badge className={learnColor}>{node.learn_method}</Badge>
        )}
        {!node.learn_method && node.spawn_class && (
          <Badge className="bg-slate-700 text-slate-400">{node.spawn_class}</Badge>
        )}
        {node.incomplete && (
          <Badge className="bg-red-900 text-red-300">incomplete</Badge>
        )}
        {node.mod_source && (
          <Badge className="bg-emerald-900 text-emerald-300">{node.mod_source}</Badge>
        )}
        {node.innawood_obsolete && (
          <Badge className="bg-orange-900 text-orange-300">no recipe in innawood</Badge>
        )}
      </div>
      {node.craft_time && (
        <div className="text-xs text-slate-500 mt-1.5">{node.craft_time}</div>
      )}
    </button>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`text-xs rounded px-1.5 py-0.5 ${className}`}>{children}</span>;
}
