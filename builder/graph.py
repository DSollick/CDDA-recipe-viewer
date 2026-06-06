"""
Build the dependency graph from resolved CDDA data.

Graph model
-----------
  Item node (type="item")
    One node per concrete item in resolved.items, plus stub nodes for any item
    referenced by a recipe but absent from resolved.items.
    The node carries metadata from the item's *primary* recipe (autolearn preferred).
    Multiple recipes for the same item are all emitted as edge sets; non-primary
    recipe edges carry is_default=False and can be grouped by recipe_key.

  Construction node (type="construction")
    One per entry in resolved.constructions. Consumes items via component edges.

  Disassembly node (type="disassembly")
    One per entry in resolved.uncrafts. Yields items via byproduct_of edges.

  Practice node (type="practice")
    One per entry in resolved.practice.

  Quality node (type="quality")
    One per (quality_id, min_level) pair required by any recipe.
    ID format: "qual_{quality_id}_{level}"

  Skill node (type="skill")
    One per skill ID referenced by any recipe.
    ID format: "skill_{skill_id}"

  Proficiency node (type="proficiency")
    One per proficiency ID that is *required* (not optional) by any recipe.
    ID format: "prof_{proficiency_id}"

Edge model
----------
  requires_component   from_node → ingredient item (qty: amount needed; qty=-1: tool, not consumed)
  requires_tool_quality  from_node → quality node (quality_level: min level required)
  requires_skill       from_node → skill node (quality_level field repurposed for skill level)
  requires_proficiency from_node → proficiency node
  byproduct_of         disassembly node → yielded item
  alternative_of       (reserved; not yet emitted — future multi-recipe navigation)

Extension beyond design doc schema
-----------------------------------
  Edge.recipe_key (str | None): composite recipe key that groups edges belonging to the
  same recipe. Essential for items with multiple recipes — the frontend can toggle which
  recipe's edges to show. Not in the original spec but required for correctness.
"""

from __future__ import annotations

import collections
import dataclasses
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from builder.resolve import ResolvedData

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class Node:
    id: str
    type: str                                           # item | construction | disassembly | practice | quality | skill | proficiency
    display_name: str
    era: str | None = None                             # filled by eras.py
    learn_method: str | None = None                    # autolearn | book | practice | construction | None
    book_sources: list = dataclasses.field(default_factory=list)
    skill_requirements: list = dataclasses.field(default_factory=list)
    proficiency_requirements: list = dataclasses.field(default_factory=list)
    craft_time: str | None = None
    bottleneck_score: int = 0                          # filled by bottlenecks.py
    spawn_class: str | None = None                     # filled by spawn.py
    incomplete: bool = False
    pseudo: bool = False

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclasses.dataclass
class Edge:
    from_node: str
    to_node: str
    type: str
    quantity: int = 1
    quality_level: int | None = None
    is_default: bool = True
    recipe_key: str | None = None
    # Index of the component/tool slot this edge belongs to within its recipe.
    # Edges sharing the same (from_node, recipe_key, slot_index) are OR-alternatives
    # within one slot — only one needs to be provided to craft the item.
    slot_index: int | None = None

    def to_dict(self) -> dict:
        d = dataclasses.asdict(self)
        d["from"] = d.pop("from_node")
        d["to"] = d.pop("to_node")
        return d


@dataclasses.dataclass
class Graph:
    nodes: dict[str, Node]
    edges: list[Edge]


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def build(resolved: "ResolvedData") -> Graph:
    """Build the full dependency graph from resolved CDDA data."""
    nodes: dict[str, Node] = {}
    edges: list[Edge] = []

    # Seed item nodes for everything in resolved.items
    for item_id, item in resolved.items.items():
        nodes[item_id] = _make_item_node(item_id, item)

    # --- Crafting recipes ---
    # Group by result item so we can pick a primary recipe per item
    recipes_by_result: dict[str, list[tuple[str, dict]]] = collections.defaultdict(list)
    for key, recipe in resolved.recipes.items():
        result = recipe.get("result")
        if result:
            recipes_by_result[result].append((key, recipe))

    for result_id, result_recipes in recipes_by_result.items():
        _ensure_item_node(result_id, resolved.items, nodes)

        # Sort: autolearn first, then book, then others; stable sort preserves file order
        result_recipes.sort(key=_recipe_priority)

        # Primary recipe → populate the item node's metadata
        _populate_node_from_recipe(nodes[result_id], result_recipes[0][1])

        for i, (recipe_key, recipe) in enumerate(result_recipes):
            is_primary = (i == 0)
            inlined = _inline_using(recipe, resolved.requirements)
            recipe_edges = _craft_edges(result_id, recipe_key, inlined, is_primary, nodes, resolved)
            edges.extend(recipe_edges)

    # --- Construction recipes ---
    for con_id, con in resolved.constructions.items():
        nodes[con_id] = _make_construction_node(con_id, con)
        inlined = _inline_using(con, resolved.requirements)
        edges.extend(_construction_edges(con_id, con_id, inlined, nodes, resolved))

    # --- Uncraft (disassembly) ---
    for unc_key, unc in resolved.uncrafts.items():
        result = unc.get("result")
        if not result:
            continue
        node_id = f"uncraft_{result}"
        _ensure_item_node(result, resolved.items, nodes)
        nodes[node_id] = Node(
            id=node_id,
            type="disassembly",
            display_name=nodes[result].display_name,
            craft_time=unc.get("time"),
        )
        for slot in unc.get("components", []):
            for alt_idx, entry in enumerate(slot):
                item_id, qty = entry[0], entry[1]
                _ensure_item_node(item_id, resolved.items, nodes)
                edges.append(Edge(
                    from_node=node_id, to_node=item_id,
                    type="byproduct_of",
                    quantity=qty,
                    is_default=(alt_idx == 0),
                    recipe_key=unc_key,
                ))

    # --- Practice recipes ---
    for prac_id, prac in resolved.practice.items():
        nodes[prac_id] = _make_practice_node(prac_id, prac)
        inlined = _inline_using(prac, resolved.requirements)
        edges.extend(_craft_edges(prac_id, prac_id, inlined, True, nodes, resolved))

    return Graph(nodes=nodes, edges=edges)


# ---------------------------------------------------------------------------
# Node factories
# ---------------------------------------------------------------------------

def _make_item_node(item_id: str, item: dict) -> Node:
    flags = item.get("flags", [])
    return Node(
        id=item_id,
        type="item",
        display_name=_display_name(item),
        pseudo="PSEUDO" in flags,
    )


def _make_construction_node(con_id: str, con: dict) -> Node:
    # Use the group name as display when available, else the id
    display = con.get("group") or con_id
    skill_reqs = [
        {"skill": s, "level": lvl}
        for s, lvl in con.get("required_skills", [])
    ]
    return Node(
        id=con_id,
        type="construction",
        display_name=display,
        learn_method="construction",
        skill_requirements=skill_reqs,
        craft_time=con.get("time"),
    )


def _make_practice_node(prac_id: str, prac: dict) -> Node:
    skill = prac.get("skill_used", "")
    skill_reqs = [{"skill": skill, "level": 0}] if skill else []
    return Node(
        id=prac_id,
        type="practice",
        display_name=_display_name(prac),
        learn_method="practice",
        skill_requirements=skill_reqs,
        craft_time=prac.get("time"),
    )


def _populate_node_from_recipe(node: Node, recipe: dict) -> None:
    """Fill craft metadata onto an item node from its primary recipe."""
    node.learn_method = _learn_method(recipe)
    node.book_sources = [src[0] for src in recipe.get("book_learn", [])]
    node.skill_requirements = _skill_reqs_from_recipe(recipe)
    node.proficiency_requirements = [
        p["proficiency"] for p in recipe.get("proficiencies", [])
        if isinstance(p, dict) and p.get("required", False)
    ]
    node.craft_time = recipe.get("time")


# ---------------------------------------------------------------------------
# Edge builders
# ---------------------------------------------------------------------------

def _craft_edges(
    from_node: str,
    recipe_key: str,
    recipe: dict,
    is_primary: bool,
    nodes: dict[str, Node],
    resolved: "ResolvedData",
) -> list[Edge]:
    """Build all dependency edges for a crafting-style recipe."""
    edges: list[Edge] = []

    # Component and tool edges share a single slot counter so slot_index is unique
    # within a recipe — edges with the same slot_index are OR-alternatives.
    slot_counter = 0

    # Component edges — three-level list: [slot[alternative[item_id, qty, ?qualifier]]]
    for slot in recipe.get("components", []):
        for alt_idx, entry in enumerate(slot):
            item_id, qty = entry[0], entry[1]
            _ensure_item_node(item_id, resolved.items, nodes)
            edges.append(Edge(
                from_node=from_node, to_node=item_id,
                type="requires_component",
                quantity=qty,
                is_default=(is_primary and alt_idx == 0),
                recipe_key=recipe_key,
                slot_index=slot_counter,
            ))
        slot_counter += 1

    # Specific tool edges — same list structure; qty=-1 means not consumed
    for slot in recipe.get("tools", []):
        for alt_idx, entry in enumerate(slot):
            item_id, qty = entry[0], entry[1]
            _ensure_item_node(item_id, resolved.items, nodes)
            edges.append(Edge(
                from_node=from_node, to_node=item_id,
                type="requires_component",
                quantity=qty,
                is_default=(is_primary and alt_idx == 0),
                recipe_key=recipe_key,
                slot_index=slot_counter,
            ))
        slot_counter += 1

    # Tool quality edges — qualities can be flat [{id,level}] or nested [[{id,level},...]]
    # where the outer list is AND-slots and the inner list is OR-alternatives.
    for q_slot in recipe.get("qualities", []):
        alternatives = q_slot if isinstance(q_slot, list) else [q_slot]
        for i, q in enumerate(alternatives):
            if isinstance(q, dict):
                qual_id = q["id"]
                level = q.get("level", 1)
            else:
                qual_id, level = q[0], q[1]
            qnode_id = _quality_node_id(qual_id, level)
            _ensure_quality_node(qual_id, level, qnode_id, resolved.tool_qualities, nodes)
            edges.append(Edge(
                from_node=from_node, to_node=qnode_id,
                type="requires_tool_quality",
                quality_level=level,
                is_default=(is_primary and i == 0),
                recipe_key=recipe_key,
            ))

    # Primary skill edge
    skill_id = recipe.get("skill_used")
    if skill_id:
        difficulty = recipe.get("difficulty") or 0
        skill_nid = f"skill_{skill_id}"
        _ensure_skill_node(skill_id, skill_nid, nodes)
        edges.append(Edge(
            from_node=from_node, to_node=skill_nid,
            type="requires_skill",
            quality_level=difficulty,
            is_default=is_primary,
            recipe_key=recipe_key,
        ))

    # Secondary skill edges (skills_required)
    for skill_id, level in _normalize_skills_required(recipe.get("skills_required")):
        skill_nid = f"skill_{skill_id}"
        _ensure_skill_node(skill_id, skill_nid, nodes)
        edges.append(Edge(
            from_node=from_node, to_node=skill_nid,
            type="requires_skill",
            quality_level=level,
            is_default=is_primary,
            recipe_key=recipe_key,
        ))

    # Required proficiency edges (optional proficiencies are time penalties, not hard requirements)
    for prof in recipe.get("proficiencies", []):
        if not isinstance(prof, dict):
            continue
        if not prof.get("required", False):
            continue
        prof_id = prof.get("proficiency")
        if not prof_id:
            continue
        prof_nid = f"prof_{prof_id}"
        _ensure_proficiency_node(prof_id, prof_nid, nodes)
        edges.append(Edge(
            from_node=from_node, to_node=prof_nid,
            type="requires_proficiency",
            is_default=is_primary,
            recipe_key=recipe_key,
        ))

    return edges


def _construction_edges(
    from_node: str,
    recipe_key: str,
    con: dict,
    nodes: dict[str, Node],
    resolved: "ResolvedData",
) -> list[Edge]:
    """Construction recipes share the same component/quality/skill edge structure."""
    edges = _craft_edges(from_node, recipe_key, con, True, nodes, resolved)

    # Constructions use required_skills instead of skill_used + difficulty
    for skill_id, level in con.get("required_skills", []):
        skill_nid = f"skill_{skill_id}"
        _ensure_skill_node(skill_id, skill_nid, nodes)
        edges.append(Edge(
            from_node=from_node, to_node=skill_nid,
            type="requires_skill",
            quality_level=level,
            is_default=True,
            recipe_key=recipe_key,
        ))

    return edges


# ---------------------------------------------------------------------------
# Using / requirement inlining
# ---------------------------------------------------------------------------

def _inline_using(obj: dict, requirements: dict[str, dict], _depth: int = 0) -> dict:
    """
    Expand 'using' references into obj's components/tools/qualities.
    Requirements can themselves reference other requirements, so this is recursive
    with a depth guard.
    """
    using = obj.get("using")
    if not using or _depth > 5:
        return obj

    result = dict(obj)
    extra_components: list = []
    extra_tools: list = []
    extra_qualities: list = []

    for ref in using:
        if not isinstance(ref, list) or not ref:
            continue
        req_id = ref[0]
        multiplier = ref[1] if len(ref) > 1 else 1
        req = requirements.get(req_id)
        if req is None:
            log.warning("_inline_using: requirement %r not found", req_id)
            continue

        # Recurse into the requirement's own using refs first
        req_exp = _inline_using(req, requirements, _depth + 1)

        for slot in req_exp.get("components", []):
            scaled = [[e[0], e[1] * multiplier] + list(e[2:]) for e in slot]
            extra_components.append(scaled)

        for slot in req_exp.get("tools", []):
            extra_tools.append(slot)

        for q in req_exp.get("qualities", []):
            extra_qualities.append(q)

    if extra_components:
        result["components"] = list(result.get("components") or []) + extra_components
    if extra_tools:
        result["tools"] = list(result.get("tools") or []) + extra_tools
    if extra_qualities:
        result["qualities"] = list(result.get("qualities") or []) + extra_qualities

    return result


# ---------------------------------------------------------------------------
# Node-ensure helpers
# ---------------------------------------------------------------------------

def _ensure_item_node(item_id: str, items: dict, nodes: dict[str, Node]) -> None:
    if item_id not in nodes:
        item = items.get(item_id)
        if item:
            nodes[item_id] = _make_item_node(item_id, item)
        else:
            nodes[item_id] = Node(id=item_id, type="item", display_name=item_id, incomplete=True)


def _ensure_quality_node(
    qual_id: str,
    level: int,
    node_id: str,
    tool_qualities: dict,
    nodes: dict[str, Node],
) -> None:
    if node_id not in nodes:
        tq = tool_qualities.get(qual_id, {})
        display = _display_name(tq) if tq else f"{qual_id} {level}"
        nodes[node_id] = Node(id=node_id, type="quality", display_name=display)


def _ensure_skill_node(skill_id: str, node_id: str, nodes: dict[str, Node]) -> None:
    if node_id not in nodes:
        nodes[node_id] = Node(id=node_id, type="skill", display_name=skill_id)


def _ensure_proficiency_node(prof_id: str, node_id: str, nodes: dict[str, Node]) -> None:
    if node_id not in nodes:
        nodes[node_id] = Node(id=node_id, type="proficiency", display_name=prof_id)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _quality_node_id(qual_id: str, level: int) -> str:
    return f"qual_{qual_id}_{level}"


def _display_name(obj: dict) -> str:
    name = obj.get("name")
    if name is None:
        return obj.get("id") or obj.get("result") or obj.get("abstract") or "?"
    if isinstance(name, str):
        return name
    if isinstance(name, dict):
        return name.get("str_sp") or name.get("str") or next(iter(name.values()), "?")
    return str(name)


def _learn_method(recipe: dict) -> str | None:
    if recipe.get("autolearn"):
        return "autolearn"
    if recipe.get("book_learn"):
        return "book"
    if recipe.get("decomp_learn"):
        return "practice"
    return None


def _book_sources(recipe: dict) -> list[str]:
    return [src[0] for src in recipe.get("book_learn", []) if isinstance(src, list) and src]


def _skill_reqs_from_recipe(recipe: dict) -> list[dict]:
    reqs = []
    if recipe.get("skill_used"):
        reqs.append({"skill": recipe["skill_used"], "level": recipe.get("difficulty") or 0})
    for skill, level in _normalize_skills_required(recipe.get("skills_required")):
        reqs.append({"skill": skill, "level": level})
    return reqs


def _normalize_skills_required(skills_required) -> list[tuple[str, int]]:
    """Normalize skills_required to [(skill_id, level), ...].

    CDDA has two observed formats:
      ["survival", 3]        — single pair as flat list
      [["electronics", 3]]   — list of [skill, level] pairs
    """
    if not skills_required:
        return []
    if isinstance(skills_required[0], str):
        # Flat single-pair format
        if len(skills_required) >= 2 and isinstance(skills_required[1], int):
            return [(skills_required[0], skills_required[1])]
        return []
    # List of pairs
    return [
        (pair[0], pair[1])
        for pair in skills_required
        if isinstance(pair, list) and len(pair) >= 2
    ]


def _recipe_priority(key_recipe: tuple[str, dict]) -> int:
    """Lower = preferred primary recipe. Autolearn > book_learn > others."""
    _, recipe = key_recipe
    if recipe.get("autolearn"):
        return 0
    if recipe.get("book_learn"):
        return 1
    return 2
