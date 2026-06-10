"""Tests for graph.py — unit tests for helpers, integration smoke test."""

import shutil

import pytest

from builder.graph import (
    Graph,
    Node,
    Edge,
    _display_name,
    _inline_using,
    _learn_method,
    _normalize_skills_required,
    _recipe_priority,
    build,
)


# ---------------------------------------------------------------------------
# Unit tests — helpers
# ---------------------------------------------------------------------------

def test_display_name_str():
    assert _display_name({"name": "axe"}) == "axe"

def test_display_name_str_dict():
    assert _display_name({"name": {"str": "axe"}}) == "axe"

def test_display_name_str_sp_preferred():
    assert _display_name({"name": {"str": "sheep", "str_sp": "sheep (unique)"}}) == "sheep (unique)"

def test_display_name_fallback_to_id():
    assert _display_name({"id": "my_item"}) == "my_item"

def test_display_name_fallback_to_result():
    assert _display_name({"result": "wood_plank"}) == "wood_plank"


def test_learn_method_autolearn():
    assert _learn_method({"autolearn": True}) == "autolearn"

def test_learn_method_book():
    assert _learn_method({"book_learn": [["book_id", 3]]}) == "book"

def test_learn_method_none():
    assert _learn_method({"skill_used": "fabrication"}) is None


def test_normalize_skills_required_flat():
    assert _normalize_skills_required(["survival", 3]) == [("survival", 3)]

def test_normalize_skills_required_nested():
    assert _normalize_skills_required([["electronics", 4]]) == [("electronics", 4)]

def test_normalize_skills_required_empty():
    assert _normalize_skills_required([]) == []
    assert _normalize_skills_required(None) == []

def test_normalize_skills_required_multiple_nested():
    assert _normalize_skills_required([["mechanics", 2], ["fabrication", 3]]) == [
        ("mechanics", 2), ("fabrication", 3)
    ]


def test_recipe_priority_autolearn_first():
    assert _recipe_priority(("k", {"autolearn": True})) < _recipe_priority(("k", {"book_learn": [["b", 1]]}))
    assert _recipe_priority(("k", {"book_learn": [["b", 1]]})) < _recipe_priority(("k", {}))


def test_inline_using_no_using():
    recipe = {"result": "x", "components": [[["wood", 1]]]}
    reqs = {}
    result = _inline_using(recipe, reqs)
    assert result is recipe  # unchanged


def test_inline_using_expands_components():
    recipe = {"result": "tent", "using": [["sewing_standard", 2]]}
    reqs = {
        "sewing_standard": {
            "id": "sewing_standard",
            "type": "requirement",
            "components": [[["thread", 10]]],
        }
    }
    result = _inline_using(recipe, reqs)
    # Thread qty should be multiplied by 2
    assert result["components"] == [[["thread", 20]]]


def test_inline_using_expands_qualities():
    recipe = {"result": "x", "using": [["needs_needle", 1]]}
    reqs = {
        "needs_needle": {
            "id": "needs_needle",
            "type": "requirement",
            "qualities": [{"id": "SEW", "level": 1}],
        }
    }
    result = _inline_using(recipe, reqs)
    assert {"id": "SEW", "level": 1} in result["qualities"]


def test_inline_using_preserves_existing_components():
    recipe = {
        "result": "x",
        "components": [[["cloth", 5]]],
        "using": [["sewing_standard", 1]],
    }
    reqs = {
        "sewing_standard": {
            "id": "sewing_standard",
            "type": "requirement",
            "components": [[["thread", 10]]],
        }
    }
    result = _inline_using(recipe, reqs)
    component_items = {slot[0][0] for slot in result["components"]}
    assert "cloth" in component_items
    assert "thread" in component_items


def test_inline_using_recursive():
    recipe = {"result": "x", "using": [["outer", 1]]}
    reqs = {
        "outer": {
            "id": "outer",
            "type": "requirement",
            "using": [["inner", 1]],
        },
        "inner": {
            "id": "inner",
            "type": "requirement",
            "components": [[["deep_item", 3]]],
        },
    }
    result = _inline_using(recipe, reqs)
    assert result["components"] == [[["deep_item", 3]]]


def test_inline_using_missing_req_warns_but_continues(caplog):
    import logging
    recipe = {"result": "x", "using": [["nonexistent", 1]]}
    with caplog.at_level(logging.WARNING, logger="builder.graph"):
        result = _inline_using(recipe, {})
    assert "nonexistent" in caplog.text
    assert "components" not in result


# ---------------------------------------------------------------------------
# Unit test — minimal build()
# ---------------------------------------------------------------------------

def _minimal_resolved():
    """Build a tiny fake ResolvedData for unit testing graph construction."""
    from builder.resolve import ResolvedData
    return ResolvedData(
        items={
            "stick": {"id": "stick", "type": "ITEM", "name": {"str": "stick"}},
            "knife": {"id": "knife", "type": "ITEM", "name": {"str": "knife"}},
            "wooden_stake": {"id": "wooden_stake", "type": "ITEM", "name": {"str": "wooden stake"}},
        },
        abstracts={},
        recipes={
            "wooden_stake": {
                "type": "recipe",
                "result": "wooden_stake",
                "skill_used": "fabrication",
                "difficulty": 1,
                "time": "5 m",
                "autolearn": True,
                "components": [[["stick", 1]]],
                "qualities": [{"id": "CUT", "level": 1}],
            }
        },
        uncrafts={},
        constructions={},
        practice={},
        requirements={},
        tool_qualities={"CUT": {"id": "CUT", "type": "tool_quality", "name": {"str": "Cutting"}}},
        item_groups={},
        harvests={}, monsters={}, terrains={}, furnitures={},
        blacklists=[],
        mod_additions={},
        unresolved_count=0,
    )


def test_build_creates_item_nodes():
    resolved = _minimal_resolved()
    g = build(resolved)
    assert "stick" in g.nodes
    assert "knife" in g.nodes
    assert "wooden_stake" in g.nodes
    assert g.nodes["wooden_stake"].type == "item"


def test_build_populates_recipe_metadata():
    g = build(_minimal_resolved())
    node = g.nodes["wooden_stake"]
    assert node.learn_method == "autolearn"
    assert node.craft_time == "5 m"
    assert node.skill_requirements == [{"skill": "fabrication", "level": 1}]


def test_build_creates_component_edge():
    g = build(_minimal_resolved())
    comp_edges = [e for e in g.edges if e.type == "requires_component" and e.from_node == "wooden_stake"]
    assert any(e.to_node == "stick" for e in comp_edges)


def test_build_creates_quality_node():
    g = build(_minimal_resolved())
    assert "qual_CUT_1" in g.nodes
    assert g.nodes["qual_CUT_1"].type == "quality"


def test_build_creates_quality_edge():
    g = build(_minimal_resolved())
    qual_edges = [e for e in g.edges if e.type == "requires_tool_quality" and e.from_node == "wooden_stake"]
    assert any(e.to_node == "qual_CUT_1" for e in qual_edges)


def test_build_creates_skill_node():
    g = build(_minimal_resolved())
    assert "skill_fabrication" in g.nodes
    assert g.nodes["skill_fabrication"].type == "skill"


def test_build_creates_skill_edge():
    g = build(_minimal_resolved())
    skill_edges = [e for e in g.edges if e.type == "requires_skill" and e.from_node == "wooden_stake"]
    assert any(e.to_node == "skill_fabrication" for e in skill_edges)


def test_build_alternative_components_is_default():
    from builder.resolve import ResolvedData
    resolved = ResolvedData(
        items={
            "axe_head": {"id": "axe_head", "type": "ITEM", "name": {"str": "axe head"}},
            "wood": {"id": "wood", "type": "ITEM", "name": {"str": "wood"}},
            "stick": {"id": "stick", "type": "ITEM", "name": {"str": "stick"}},
            "axe": {"id": "axe", "type": "ITEM", "name": {"str": "axe"}},
        },
        abstracts={}, uncrafts={}, constructions={}, practice={},
        requirements={}, tool_qualities={}, item_groups={},
        harvests={}, monsters={}, terrains={}, furnitures={},
        blacklists=[], mod_additions={}, unresolved_count=0,
        recipes={
            "axe": {
                "type": "recipe", "result": "axe",
                "autolearn": True, "time": "10 m",
                "components": [
                    [["axe_head", 1]],
                    [["wood", 1], ["stick", 2]],  # wood OR stick
                ],
            }
        },
    )
    g = build(resolved)
    wood_edge = next(e for e in g.edges if e.to_node == "wood")
    stick_edge = next(e for e in g.edges if e.to_node == "stick")
    assert wood_edge.is_default is True   # first alternative is default
    assert stick_edge.is_default is False


def test_build_multi_recipe_marks_primary():
    from builder.resolve import ResolvedData
    resolved = ResolvedData(
        items={"plank": {"id": "plank", "type": "ITEM", "name": {"str": "plank"}}},
        abstracts={}, uncrafts={}, constructions={}, practice={},
        requirements={}, tool_qualities={}, item_groups={},
        harvests={}, monsters={}, terrains={}, furnitures={},
        blacklists=[], mod_additions={}, unresolved_count=0,
        recipes={
            "plank": {
                "type": "recipe", "result": "plank",
                "autolearn": True, "time": "1 m",
                "components": [[["wood_log", 1]]],
            },
            "plank_saw": {
                "type": "recipe", "result": "plank", "id_suffix": "saw",
                "book_learn": [["carpentry_book", 2]], "time": "30 s",
                "components": [[["hardwood_log", 1]]],
            },
        },
    )
    g = build(resolved)
    # Primary recipe (autolearn) edges are is_default=True
    primary_edges = [e for e in g.edges if e.recipe_key == "plank" and e.type == "requires_component"]
    alt_edges = [e for e in g.edges if e.recipe_key == "plank_saw" and e.type == "requires_component"]
    assert all(e.is_default for e in primary_edges)
    assert all(not e.is_default for e in alt_edges)


def test_edge_to_dict_renames_fields():
    e = Edge(from_node="a", to_node="b", type="requires_component", quantity=2)
    d = e.to_dict()
    assert "from" in d
    assert "to" in d
    assert "from_node" not in d
    assert "to_node" not in d


# ---------------------------------------------------------------------------
# Integration smoke test
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_build_experimental():
    from builder.fetch import experimental
    from builder.load import load_all
    from builder.resolve import resolve

    clone = None
    try:
        clone = experimental()
        data = load_all(clone)
        resolved = resolve(data)
        g = build(resolved)

        assert len(g.nodes) > 5000, f"Expected >5000 nodes, got {len(g.nodes)}"
        assert len(g.edges) > 20000, f"Expected >20000 edges, got {len(g.edges)}"

        node_types = {}
        for n in g.nodes.values():
            node_types[n.type] = node_types.get(n.type, 0) + 1

        edge_types = {}
        for e in g.edges:
            edge_types[e.type] = edge_types.get(e.type, 0) + 1

        # Spot-check: known items exist
        assert "rock" in g.nodes or "stone" in g.nodes, "Expected basic stone items"

        # Sanity: no edges reference non-existent nodes
        missing = {e.from_node for e in g.edges if e.from_node not in g.nodes}
        missing |= {e.to_node for e in g.edges if e.to_node not in g.nodes}
        assert not missing, f"Edges reference {len(missing)} non-existent nodes: {list(missing)[:5]}"

        print("\n--- CDDA Graph Summary ---")
        print(f"Total nodes: {len(g.nodes)}")
        for t, c in sorted(node_types.items()):
            print(f"  {t:20s}: {c}")
        print(f"Total edges: {len(g.edges)}")
        for t, c in sorted(edge_types.items()):
            print(f"  {t:30s}: {c}")
        incomplete = sum(1 for n in g.nodes.values() if n.incomplete)
        print(f"Incomplete nodes (stub): {incomplete}")
        print("--- End Summary ---")

    finally:
        if clone is not None:
            shutil.rmtree(clone.path, ignore_errors=True)
