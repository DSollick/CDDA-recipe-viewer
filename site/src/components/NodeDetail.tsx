import React, { useState, useEffect } from 'react';
import { GraphNode, GraphIndex } from '../types';
import { getModPalette } from '../modColors';

interface NodeDetailProps {
  node: GraphNode;
  providers?: string[];
  nodes?: Record<string, GraphNode>;
  onSelectItem?: (id: string) => void;
  harvestedFrom?: string[];
  foragedFrom?: string[];
  graphIndex?: GraphIndex;
}

const TYPE_COLORS: Record<GraphNode['type'], string> = {
  item: 'bg-blue-800 text-blue-200',
  quality: 'bg-purple-800 text-purple-200',
  skill: 'bg-orange-800 text-orange-200',
  proficiency: 'bg-orange-900 text-orange-200',
  group: 'bg-green-800 text-green-200',
  construction: 'bg-teal-800 text-teal-200',
  disassembly: 'bg-teal-800 text-teal-200',
  practice: 'bg-teal-800 text-teal-200',
};

const LEARN_METHOD_COLORS: Record<string, string> = {
  autolearn: 'bg-green-800 text-green-200',
  book: 'bg-blue-800 text-blue-200',
  practice: 'bg-yellow-800 text-yellow-200',
};

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-block text-xs rounded px-2 py-0.5 ${className}`}>{children}</span>;
}

export default function NodeDetail({ node, providers, nodes, onSelectItem, harvestedFrom, foragedFrom, graphIndex }: NodeDetailProps) {
  const [showUsedBy, setShowUsedBy] = useState(false);
  useEffect(() => { setShowUsedBy(false); }, [node.id]);

  const usedByNodes = Array.from(
    new Set((graphIndex?.inEdges.get(node.id) ?? []).map((e) => e.from))
  )
    .map((id) => nodes?.[id])
    .filter((n): n is GraphNode => !!n)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const typeColor = TYPE_COLORS[node.type] ?? 'bg-slate-700 text-slate-300';
  const learnColor = node.learn_method
    ? (LEARN_METHOD_COLORS[node.learn_method] ?? 'bg-slate-700 text-slate-300')
    : null;

  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 leading-tight">{node.display_name}</h2>
        <div className="text-xs text-slate-500 font-mono mt-0.5">{node.id}</div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2">
        <Badge className={typeColor}>{node.type}</Badge>
        {node.era && <Badge className="bg-slate-700 text-slate-300">{node.era}</Badge>}
        {!node.era && <Badge className="bg-slate-700 text-slate-500">uncategorized</Badge>}
        {node.learn_method && learnColor && (
          <Badge className={learnColor}>{node.learn_method}</Badge>
        )}
        {node.mod_source && <Badge className={getModPalette(node.mod_source).badge}>{node.mod_source}</Badge>}
        {node.pseudo && <Badge className="bg-violet-900 text-violet-300">pseudo</Badge>}
        {node.incomplete && <Badge className="bg-red-900 text-red-300">incomplete</Badge>}
        {node.innawood_obsolete && <Badge className="bg-orange-900 text-orange-300">no recipe in innawood</Badge>}
      </div>

      {/* Description */}
      {node.description && (
        <p className="text-slate-400 text-sm italic leading-relaxed">{node.description}</p>
      )}

      {/* Craft time */}
      {node.craft_time && (
        <DetailRow label="Craft time">
          <span className="text-slate-200">{node.craft_time}</span>
        </DetailRow>
      )}

      {/* Skill requirements */}
      {node.skill_requirements.length > 0 && (
        <DetailRow label="Skills required">
          <ul className="space-y-0.5">
            {node.skill_requirements.map((sr) => (
              <li key={sr.skill} className="text-slate-200 text-sm">
                {sr.skill}{' '}
                <span className="text-slate-400">level {sr.level}</span>
              </li>
            ))}
          </ul>
        </DetailRow>
      )}

      {/* Proficiency requirements */}
      {node.proficiency_requirements.length > 0 && (
        <DetailRow label="Proficiencies">
          <ul className="space-y-0.5">
            {(node.proficiency_requirements as Array<{ proficiency: string; required?: boolean }>).map(
              (pr, i) => (
                <li key={i} className="text-slate-200 text-sm">
                  {pr.proficiency ?? String(pr)}
                </li>
              )
            )}
          </ul>
        </DetailRow>
      )}

      {/* Used-by list */}
      {usedByNodes.length > 0 && (
        <DetailRow label="Used In">
          <button
            onClick={() => setShowUsedBy((v) => !v)}
            className="text-amber-300 font-semibold hover:text-amber-100 transition-colors"
          >
            {usedByNodes.length} item{usedByNodes.length !== 1 ? 's' : ''} use this{' '}
            <span className="text-xs">{showUsedBy ? '▲' : '▼'}</span>
          </button>
          {showUsedBy && (
            <ul className="mt-2 space-y-0.5 max-h-64 overflow-y-auto">
              {usedByNodes.map((n) => (
                <li key={n.id}>
                  {onSelectItem ? (
                    <button
                      onClick={() => onSelectItem(n.id)}
                      className="text-left text-blue-300 hover:text-blue-100 hover:underline text-sm"
                    >
                      {n.display_name}
                    </button>
                  ) : (
                    <span className="text-slate-300 text-sm">{n.display_name}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DetailRow>
      )}

      {/* Book sources */}
      {node.book_sources.length > 0 && (
        <DetailRow label={node.learn_method === 'autolearn' ? 'Also in books' : 'Book sources'}>
          <ul className="space-y-0.5">
            {(node.book_sources as Array<{ book: string; skill_level?: number } | string>).map(
              (bs, i) => {
                const bookId = typeof bs === 'string' ? bs : bs.book;
                const skillLevel = typeof bs !== 'string' ? bs.skill_level : undefined;
                const bookNode = nodes?.[bookId];
                return (
                  <li key={i} className="text-sm flex items-baseline gap-1">
                    {onSelectItem ? (
                      <button
                        onClick={() => onSelectItem(bookId)}
                        className="text-left text-blue-300 hover:text-blue-100 hover:underline"
                      >
                        {bookNode?.display_name ?? bookId}
                      </button>
                    ) : (
                      <span className="text-slate-300">{bookNode?.display_name ?? bookId}</span>
                    )}
                    {skillLevel !== undefined && (
                      <span className="text-slate-500">lvl {skillLevel}</span>
                    )}
                  </li>
                );
              }
            )}
          </ul>
        </DetailRow>
      )}

      {/* Spawn class */}
      {node.spawn_class && (
        <DetailRow label="Spawn class">
          <span className="text-slate-300 font-mono text-sm">{node.spawn_class}</span>
        </DetailRow>
      )}

      {/* Foraged from */}
      {foragedFrom && foragedFrom.length > 0 && (
        <DetailRow label="Foraged from">
          <ul className="space-y-0.5 max-h-48 overflow-y-auto">
            {foragedFrom.map((name) => (
              <li key={name} className="text-green-300 text-sm">{name}</li>
            ))}
          </ul>
        </DetailRow>
      )}

      {/* Harvested from */}
      {harvestedFrom && harvestedFrom.length > 0 && (
        <DetailRow label="Harvested from">
          <ul className="space-y-0.5 max-h-48 overflow-y-auto">
            {harvestedFrom.map((name) => (
              <li key={name} className="text-slate-300 text-sm">{name}</li>
            ))}
          </ul>
        </DetailRow>
      )}

      {/* Providers — for group and quality nodes */}
      {providers && providers.length > 0 && (
        <DetailRow label={node.type === 'group' ? 'Items that satisfy this' : 'Items providing this'}>
          <ul className="space-y-0.5 max-h-64 overflow-y-auto">
            {providers.map((id) => {
              const n = nodes?.[id];
              return (
                <li key={id}>
                  {onSelectItem ? (
                    <button
                      onClick={() => onSelectItem(id)}
                      className="text-left text-blue-300 hover:text-blue-100 hover:underline text-sm"
                    >
                      {n?.display_name ?? id}
                    </button>
                  ) : (
                    <span className="text-slate-300 text-sm">{n?.display_name ?? id}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </DetailRow>
      )}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}
