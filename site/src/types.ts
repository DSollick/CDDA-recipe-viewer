export interface GraphNode {
  id: string;
  type: 'item' | 'construction' | 'disassembly' | 'practice' | 'quality' | 'skill' | 'proficiency' | 'group';
  display_name: string;
  era: string | null;
  learn_method: string | null; // 'autolearn' | 'book' | 'practice' | null
  book_sources: unknown[];
  skill_requirements: Array<{ skill: string; level: number }>;
  proficiency_requirements: unknown[];
  craft_time: string | null;
  bottleneck_score: number;
  spawn_class: string | null;
  incomplete: boolean;
  pseudo: boolean;
  description?: string | null;
  mod_source?: string | null;
  category?: string | null;
  innawood_obsolete?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  type:
    | 'requires_component'
    | 'requires_tool_quality'
    | 'requires_skill'
    | 'requires_proficiency'
    | 'byproduct_of';
  quantity: number;
  quality_level: number | null;
  is_default: boolean;
  recipe_key: string | null;
  slot_index: number | null;
}

// The dataset object fetched from graph-<mod_id>.json
export interface Dataset {
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  eras: Record<string, string[]>;
  bottlenecks: string[];
  quality_providers: Record<string, string[]>;
  group_providers: Record<string, string[]>;
  harvested_from?: Record<string, string[]>;
  foraged_from?: Record<string, string[]>;
  categories?: Record<string, string[]>;
}

export interface ModEntry {
  id: string;
  label: string;
  file: string;
  default?: boolean;
}

export interface GraphManifest {
  generated_at: string;
  cdda_commit: string | null;
  cdda_date: string | null;
  builder_version: string;
  mods: ModEntry[];
}

export type ViewMode = 'browse' | 'tree' | 'graph' | 'bottlenecks';

// Adjacency index built from edges
export interface GraphIndex {
  // from node id → edges going out from it (its dependencies)
  outEdges: Map<string, GraphEdge[]>;
  // to node id → edges coming into it (what depends on it)
  inEdges: Map<string, GraphEdge[]>;
}
