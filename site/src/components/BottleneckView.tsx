import React from 'react';
import { Dataset, GraphNode } from '../types';

interface BottleneckViewProps {
  activeDataset: Dataset | null;
  onSelectItem: (nodeId: string) => void;
}

const ERA_BADGE = 'bg-slate-700 text-slate-300';

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-block text-xs rounded px-2 py-0.5 ${className}`}>{children}</span>;
}

export default function BottleneckView({ activeDataset, onSelectItem }: BottleneckViewProps) {
  if (!activeDataset) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        No dataset loaded.
      </div>
    );
  }

  const bottleneckIds = activeDataset.bottlenecks;

  if (bottleneckIds.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        No bottleneck data available.
      </div>
    );
  }

  const bottleneckNodes: GraphNode[] = bottleneckIds
    .map((id) => activeDataset.nodes[id])
    .filter((n): n is GraphNode => n !== undefined);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="text-lg font-semibold text-slate-200 mb-1">Key Unlocks</h2>
      <p className="text-sm text-slate-500 mb-5">
        Top {bottleneckNodes.length} nodes by number of recipes they gate (bottleneck score).
      </p>

      <div className="space-y-2">
        {bottleneckNodes.map((node, i) => (
          <button
            key={node.id}
            onClick={() => onSelectItem(node.id)}
            className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 rounded-lg px-4 py-3 text-left transition-colors group"
          >
            {/* Rank */}
            <span className="text-slate-500 text-sm font-mono w-6 shrink-0 text-right">
              {i + 1}.
            </span>

            {/* Name */}
            <span className="flex-1 font-medium text-slate-100 group-hover:text-white text-sm">
              {node.display_name}
            </span>

            {/* Badges */}
            <div className="flex items-center gap-2 shrink-0">
              {node.era ? (
                <Badge className={ERA_BADGE}>{node.era}</Badge>
              ) : (
                <Badge className="bg-slate-700 text-slate-500">uncategorized</Badge>
              )}
              {node.incomplete && (
                <Badge className="bg-red-900 text-red-300">incomplete</Badge>
              )}
            </div>

            {/* Score */}
            <span className="text-amber-300 font-semibold text-sm shrink-0 w-28 text-right">
              Gates {node.bottleneck_score} recipe{node.bottleneck_score !== 1 ? 's' : ''}
            </span>

            {/* Craft time */}
            <span className="text-slate-500 text-xs shrink-0 w-24 text-right">
              {node.craft_time ?? '—'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
