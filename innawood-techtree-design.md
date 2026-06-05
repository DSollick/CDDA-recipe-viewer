# Innawood Tech Tree — Design Document

## Project Overview

A static web application that renders the full, accurate recipe/crafting dependency graph for a
Cataclysm: Dark Days Ahead (CDDA) Innawood run. The site is built nightly from live CDDA source
data and hosted free on GitHub Pages. It fills the gap left by the defunct chezzo.com item browser,
with a specific focus on the Innawood primitive-survival scenario rather than vanilla CDDA.

---

## Repository Structure

```
innawood-techtree/
├── .github/
│   └── workflows/
│       ├── nightly.yml        # Scheduled build + deploy
│       └── manual.yml         # Trigger-on-demand
├── builder/                   # Python data pipeline
│   ├── fetch.py               # Sparse-clone & file acquisition
│   ├── load.py                # JSON loading & schema validation
│   ├── resolve.py             # Mod layer application (blacklists, overrides)
│   ├── graph.py               # Dependency graph construction
│   ├── spawn.py               # Environment/spawn reachability analysis
│   ├── eras.py                # Era classification
│   ├── bottlenecks.py         # Bottleneck node scoring
│   ├── emit.py                # Output compiled graph JSON
│   └── schema/                # JSON schemas for CDDA types (for validation)
├── site/                      # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── TreeView.jsx       # Click-to-expand dependency tree
│   │   │   ├── SearchBar.jsx
│   │   │   ├── EraNav.jsx         # Era/age browsing sidebar
│   │   │   ├── BottleneckView.jsx # "What unlocks when I have X" view
│   │   │   ├── NodeCard.jsx       # Item detail panel
│   │   │   └── DataBanner.jsx     # Build date / CDDA commit display
│   │   ├── data/
│   │   │   └── graph.json         # Compiled output — committed by CI
│   │   └── hooks/
│   │       ├── useGraph.js
│   │       └── useSearch.js
│   ├── index.html
│   └── vite.config.js
├── README.md
└── DESIGN.md                  # This document
```

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Data pipeline | Python 3.11+ | Natural fit for JSON processing; Dustin's existing stack |
| Frontend | React + Vite | Strong AI tooling familiarity; large ecosystem; easy static build |
| Hosting | GitHub Pages | Free for public repos; integrates natively with Actions |
| CI/CD | GitHub Actions | Free + unlimited for public repos |
| VCS | Git / GitHub | Source of truth; also where CDDA data lives |

No external databases, no server-side compute, no API keys required.

---

## Data Sourcing

### Acquisition Method: Sparse Clone

At build time, the pipeline performs a sparse clone of `CleverRaven/Cataclysm-DDA` targeting
only the paths it needs, rather than fetching individual files. This is more robust against
path changes and captures the full directory tree structure.

**Sparse paths to clone:**
```
data/json/              # Vanilla items, recipes, qualities, tool qualities, item groups
data/mods/innawood/    # Innawood mod: additions, blacklists, scenario definitions
data/mods/              # Top-level mod index (to understand mod loading order)
```

The CDDA repo is cloned to a temp directory during the build and discarded afterward.
The compiled output (`graph.json`) is the only artifact committed to the site repo.

### Stable vs. Experimental

The pipeline builds **two separate graph datasets**:
- `graph-stable.json` — built from the latest tagged stable release
- `graph-experimental.json` — built from `master` HEAD

The frontend exposes a toggle to switch between them. Default is **stable**.

The build metadata for each includes:
- For stable: the release tag (e.g., `0.H`)
- For experimental: the short commit SHA and commit date

### Rebuild Schedule

Nightly cron via GitHub Actions (`0 4 * * *` UTC — quiet hours).
Also triggerable manually via `workflow_dispatch` for ad-hoc rebuilds.

The build only commits `graph.json` if the content has actually changed (compare hash before
committing), avoiding noise in git history from no-op rebuilds.

---

## Scope

### Mod Layer Resolution (Critical)

The Innawood tech tree is **not** just the contents of `data/mods/innawood/`. It is the result
of applying the Innawood mod layer on top of the full vanilla CDDA data. The pipeline must
correctly emulate CDDA's mod loading sequence:

1. Load all vanilla JSON from `data/json/`
2. Load and apply Innawood's **blacklists** — remove blacklisted items, recipes, and item groups
3. Load and apply Innawood's **additions** — new items, recipes, scenarios
4. Load and apply Innawood's **overrides/copy-from** — modifications to vanilla entities
5. Result: the "Innawood world" dataset

**CDDA blacklist types to handle:**
- `ITEM_BLACKLIST` — removes an item type entirely
- `RECIPE_BLACKLIST` — removes a specific recipe
- `ITEM_GROUP_BLACKLIST` — removes an item group (affects spawn resolution)
- `SKILL_BLACKLIST` — if present
- `copy-from` with field deletions

If the blacklist resolution produces an inconsistent state (e.g. a surviving recipe references
a blacklisted item), the build should **log a warning** and mark that recipe as `incomplete: true`
rather than silently emitting bad data.

### Recipe Types Included

- **Crafting recipes** — standard `type: recipe`
- **Construction recipes** — `type: construction` (shelter, fire ring, pit, etc.)
- **Disassembly recipes** — reverse-crafting paths, marked distinctly
- **Practice recipes** — `type: practice`, shown as skill-building leaf nodes

### Leaf Node Types

Leaf nodes are items with no crafting recipe in the resolved Innawood world. They are classified:

| Class | Description | Display |
|---|---|---|
| `environment_gather` | Found in nature in Innawood biomes (clay, flint, bark, wood, bone) | Green leaf — "Gathered" |
| `world_spawn` | Spawns in Innawood-compatible map structures | Yellow leaf — "Found in world" |
| `unavailable` | Exists in vanilla but is blacklisted or doesn't spawn in Innawood | Red — not shown in main tree, visible only in "why can't I make X" debug view |
| `unknown_spawn` | Pipeline cannot confidently determine spawn status | Grey — flagged for review |

#### Spawn Reachability Analysis

This is the most complex part of the pipeline. The goal is to determine, for each leaf item,
whether it can appear in an Innawood run.

**Algorithm (v1 — conservative):**

1. Start with the Innawood scenario definition to identify which overmap specials,
   city sizes, and mapgen templates are active.
2. Walk all `mapgen` entries referenced by active overmap specials and terrain types.
3. Walk all `item_group` references within those mapgen entries, recursively.
4. Build a set: `spawnable_items` — everything reachable via item groups in Innawood mapgen.
5. Add explicit Innawood additions (items defined in the mod's own JSON).
6. Add hardcoded natural resources: stone, wood, plant fibers, clay, sand, bone, hide, etc.
   (These are gathered via `forage` actions or terrain interaction, not item groups.)
7. Items in neither set get `unknown_spawn` classification.

This will not be perfect at v1. The pipeline should emit a separate `spawn_audit.json` listing
all `unknown_spawn` items for manual review and future refinement.

**Design principle:** When in doubt, classify as `unknown_spawn` rather than `unavailable`.
A false negative (showing something as gatherable when it isn't) is worse than a flag.

---

## Graph Data Model

### Node Schema

```json
{
  "id": "string",                    // Unique node ID (item type ID or recipe ID)
  "type": "item | construction | disassembly | practice | quality | proficiency | skill | environment | world_spawn | unavailable",
  "display_name": "string",
  "era": "string | null",            // e.g. "stone", "bronze", "iron", "electrical"
  "learn_method": "autolearn | book | practice | construction | null",
  "book_sources": ["item_id", ...],  // If learn_method = book
  "skill_requirements": [
    { "skill": "string", "level": 2 }
  ],
  "proficiency_requirements": ["proficiency_id", ...],
  "craft_time": "string | null",     // Human-readable, e.g. "45 minutes"
  "bottleneck_score": 0,             // Count of recipes that transitively depend on this node
  "spawn_class": "environment_gather | world_spawn | unavailable | unknown_spawn | null",
  "incomplete": false                // True if resolution produced warnings
}
```

### Edge Schema

```json
{
  "from": "node_id",
  "to": "node_id",
  "type": "requires_component | requires_tool_quality | requires_proficiency | requires_skill | alternative_of | byproduct_of",
  "quantity": 1,
  "quality_level": null,            // For tool quality edges: minimum level required
  "is_default": true                // For alternative groups: which is the "simplest" default
}
```

### Compiled Output: `graph.json`

```json
{
  "meta": {
    "generated_at": "ISO-8601",
    "cdda_stable_tag": "0.H",
    "cdda_stable_commit": "abc1234",
    "cdda_experimental_commit": "def5678",
    "cdda_experimental_date": "ISO-8601",
    "builder_version": "0.1.0"
  },
  "stable": {
    "nodes": { "node_id": { ...node } },
    "edges": [ { ...edge }, ... ],
    "eras": { "stone": ["node_id", ...], ... },
    "bottlenecks": ["node_id", ...]   // Top 20 by score
  },
  "experimental": { ...same structure }
}
```

---

## Graph Resolution Details

### Tool Quality Resolution

Tool quality requirements are **not** direct item references — they are quality-level thresholds.
The pipeline must:

1. Load `data/json/tool_qualities.json` to get the quality registry.
2. For each item, parse its `qualities` array to build a reverse map:
   `quality_id → [{item_id, level}]`
3. When a recipe requires `QUALITY CUT 2`, the edge points to a `quality` node (`CUT_2`),
   and that quality node has child edges to all items providing `CUT >= 2`.
4. Apply Innawood's spawn/blacklist filter to those items — only show items actually reachable.

In the frontend, tool quality nodes render distinctly: "Requires: Cutting 2 — e.g. stone knife, bone knife" with the alternatives toggle showing all qualifying items.

### `using` References (Shared Requirements)

CDDA recipes can reference shared requirement sets via `"using": [["requirement_id", multiplier]]`.
These requirement sets live in `data/json/requirements/`. The pipeline must resolve all `using`
references inline before emitting graph edges — they are not separate nodes, just a shorthand
for repeating the same component/tool lists.

### Alternative Components

When a recipe lists multiple items in a component slot with counts (CDDA's "any of these" groups):
- The **default path** uses the item with the lowest `bottleneck_score` among available options
  (simplest to obtain).
- All alternatives are stored in the graph and surfaced via UI toggle.
- Edges for non-default alternatives carry `is_default: false`.

### `copy-from` Inheritance

CDDA uses `copy-from` extensively for recipe/item inheritance. The pipeline must resolve the full
inheritance chain before processing any entity — treating `copy-from` as a prototype merge with
field-level overrides applied in order.

---

## Era Classification

The player-documented progression is:
**Wood → Stone → Bone → Leather → Copper → Bronze → Iron → Glass → Chemical → Plastics → Combustion → Electrical → Energy**

**Classification strategy (v1):**

The pipeline should first check whether Innawood's JSON tags items with era metadata
(e.g. a custom flag or category). If it does, use that directly.

If not, derive era from a combination of:
- Primary material of the item (`WOOD`, `STONE`, `IRON`, `BRONZE`, etc.)
- Skill requirements (higher fabrication/metallurgy thresholds = later era)
- Explicit dependency on known era-gating items (e.g. anything requiring an iron anvil = iron+)

Era assignment will be imperfect at v1. Emit an `era_audit.json` of unclassified items.
The frontend should handle `era: null` gracefully (shown under "Uncategorized").

---

## Bottleneck Detection

A **bottleneck node** is an item that a large number of other recipes transitively depend on.
These are the "unlock gates" of the Innawood progression — the anvil problem.

**Algorithm:**
1. For each node N, compute `bottleneck_score(N)` = number of distinct recipe nodes that
   have N as a transitive dependency (i.e. N appears somewhere in their full dependency tree).
2. Score is computed on the **resolved Innawood graph only** — vanilla-only items that got
   blacklisted don't count.
3. Top 20 nodes by score are flagged in `graph.json` as the bottleneck list.

**"What unlocks with X" view:**
The frontend should support selecting any node and seeing:
- Everything that directly depends on it
- Everything that becomes reachable (transitively) once it's available
This is the inverse traversal of the dependency graph and should be computed client-side
from the compiled graph JSON.

---

## Frontend UX

### Entry Points / Views

**1. Era Browser (default landing)**
Left sidebar lists eras in progression order. Selecting an era shows all items in that era
as cards. Clicking an item opens the dependency tree for that item.

**2. Search**
Global search bar (fuzzy match on `display_name`). Results show item name + era badge.
Selecting a result opens the dependency tree.

**3. Bottleneck View**
Accessible via nav: "Key Unlocks." Shows the top bottleneck nodes ranked by score, with
a one-line summary of how many recipes each gates. Clicking one shows the inverse tree
("what this unlocks") rather than the dependency tree.

**4. Dependency Tree (item detail)**
Click-to-expand tree rooted at the selected item. Nodes expand downward into their
requirements. Color coding:
- Blue — craftable recipe
- Green — environment gather (leaf)
- Yellow — world spawn (leaf)  
- Purple — tool quality requirement
- Orange — proficiency requirement
- Grey — unknown spawn

Each node shows: name, era badge, learn method badge, craft time.
Tool quality nodes show the default satisfying item + "N alternatives" toggle.
Proficiency nodes are leaves with a tooltip explaining how the proficiency is gained.

**5. Stable / Experimental Toggle**
Persistent toggle in the header. Switching reloads the graph from the alternate dataset.
The DataBanner shows which build is active and when it was generated.

### Component Alternatives Toggle

At any component node in the tree, a small "↕ N alternatives" button expands to show
all items that satisfy that slot. The default (simplest) path is shown collapsed.
This applies to both component alternatives and tool quality alternatives.

### Desktop-First

Minimum target width: 1280px. The tree view uses a two-panel layout:
left panel = tree; right panel = node detail card.
No specific mobile breakpoint required for v1, but don't actively break narrow viewports.

---

## CI/CD Pipeline

### GitHub Actions: Nightly Build

```yaml
# .github/workflows/nightly.yml
on:
  schedule:
    - cron: '0 4 * * *'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - Checkout innawood-techtree repo
      - Set up Python 3.11
      - Sparse clone CDDA master (experimental)
      - Sparse clone CDDA latest stable tag
      - Run builder pipeline for both
      - Validate output schema
      - Compare graph.json hash with current committed version
      - If changed: commit updated graph.json with message "chore: data update [stable: TAG] [exp: SHA]"
      - Deploy site/ to GitHub Pages via actions/deploy-pages
```

### Schema Validation = Hard Failure

If the CDDA JSON schema changes in a way that breaks the parser:
- The build **must fail loudly** rather than emit a degraded or partial graph.
- The previous `graph.json` is left unchanged — the site stays up on stale data.
- A GitHub Actions annotation and build failure notification makes the breakage visible.

The `schema/` directory contains JSON Schema definitions for the CDDA types we depend on.
The `load.py` step validates sampled files against these schemas before proceeding.
When a schema check fails, the error message should indicate which CDDA type changed and
what fields are missing or unexpected — enough context for a maintainer to fix the parser.

---

## Extensibility Notes (Future Mod Support)

The architecture should accommodate future mod layers without requiring a full rewrite:

- The mod resolution pipeline (`resolve.py`) should accept a **mod stack** as input rather
  than hardcoding Innawood. The stack is an ordered list of mod IDs to apply after vanilla.
- The spawn analysis (`spawn.py`) should accept the active scenario as a parameter.
- The era classification (`eras.py`) should be configurable per-mod.
- `graph.json` structure allows multiple named datasets alongside `stable`/`experimental`.

For v1, the only supported mod stack is `[innawood]`. The architecture should not prevent
adding `[innawood, mystical_innawood]` later without major refactoring.

---

## Open Questions / Deferred Decisions

1. **Era classification accuracy** — will likely need a manual curation pass after v1 generates
   `era_audit.json`. Build a lightweight YAML override file that the pipeline respects.

2. **Construction recipe format** — CDDA's construction JSON has a different schema than
   crafting recipes. Confirm the field mapping before `graph.py` implementation.

3. **Foraging / terrain interaction items** — clay from digging, flint from rocky terrain, etc.
   These aren't in item groups at all. May need a hardcoded list for v1 with a note to revisit.

4. **NPC trade items** — some items in Innawood may only be obtainable from NPC traders.
   Out of scope for v1 but worth a leaf node type eventually.

5. **Proficiency acquisition paths** — proficiencies are gained through practice and books.
   For v1, proficiency nodes are leaves with a static tooltip. A future version could link
   proficiency → books that teach it → whether those books spawn in Innawood.
