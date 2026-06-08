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

export interface Dataset {
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  eras: Record<string, string[]>; // era_name → [node_id, ...]
  bottlenecks: string[]; // top-20 node IDs by bottleneck_score
  quality_providers: Record<string, string[]>; // qual_node_id → item IDs that satisfy it
  group_providers: Record<string, string[]>;   // group_id → member item IDs
  harvested_from?: Record<string, string[]>;   // item_id → monster display names
  foraged_from?: Record<string, string[]>;     // item_id → terrain/furniture display names
}

export interface GraphMeta {
  generated_at: string;
  cdda_stable_tag: string | null;
  cdda_stable_commit: string | null;
  cdda_experimental_commit: string | null;
  cdda_experimental_date: string | null;
  builder_version: string;
}

export interface GraphData {
  meta: GraphMeta;
  stable?: Dataset;
  experimental?: Dataset;
}

export type ViewMode = 'era' | 'tree' | 'graph' | 'bottlenecks';
export type DatasetKey = 'stable' | 'experimental';

// Adjacency index built from edges
export interface GraphIndex {
  // from node id → edges going out from it (its dependencies)
  outEdges: Map<string, GraphEdge[]>;
  // to node id → edges coming into it (what depends on it)
  inEdges: Map<string, GraphEdge[]>;
}
