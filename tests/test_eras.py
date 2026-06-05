"""Tests for eras.py — era classification."""

import shutil

import pytest

from builder.eras import annotate, ERA_ORDER
from builder.graph import Graph, Node, Edge


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _item(id_: str, **kw) -> Node:
    return Node(id=id_, type="item", display_name=id_, **kw)


def _edge(from_: str, to: str, *, is_default=True, slot_idx=0) -> Edge:
    return Edge(from_node=from_, to_node=to, type="requires_component",
                quantity=1, is_default=is_default, slot_index=slot_idx)


def _graph(*nodes_and_edges) -> Graph:
    nodes = {n.id: n for n in nodes_and_edges if isinstance(n, Node)}
    edges = [e for e in nodes_and_edges if isinstance(e, Edge)]
    return Graph(nodes=nodes, edges=edges)


_SIMPLE_GATES = {
    "stone": ["rock"],
    "iron":  ["iron_ingot"],
}


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------

def test_gate_item_classified_as_own_era():
    g = _graph(_item("rock"))
    annotate(g, _SIMPLE_GATES)
    assert g.nodes["rock"].era == "stone"


def test_item_with_no_deps_and_no_gate_is_none():
    g = _graph(_item("wood_stick"))
    annotate(g, _SIMPLE_GATES)
    assert g.nodes["wood_stick"].era is None


def test_direct_dep_on_gate():
    # knife → rock (stone gate)
    g = _graph(
        _item("knife"), _item("rock"),
        _edge("knife", "rock"),
    )
    annotate(g, _SIMPLE_GATES)
    assert g.nodes["knife"].era == "stone"


def test_transitive_dep_on_gate():
    # sword → blade → iron_ingot (iron gate)
    g = _graph(
        _item("sword"), _item("blade"), _item("iron_ingot"),
        _edge("sword", "blade"),
        _edge("blade", "iron_ingot"),
    )
    annotate(g, _SIMPLE_GATES)
    assert g.nodes["sword"].era == "iron"
    assert g.nodes["blade"].era == "iron"


def test_highest_era_gate_wins():
    # axe requires rock (stone) AND iron_ingot (iron) → iron era
    g = _graph(
        _item("axe"), _item("rock"), _item("iron_ingot"),
        _edge("axe", "rock",       slot_idx=0),
        _edge("axe", "iron_ingot", slot_idx=1),
    )
    annotate(g, _SIMPLE_GATES)
    assert g.nodes["axe"].era == "iron"


def test_non_default_edge_not_followed():
    # sword → iron_ingot (non-default) → iron NOT followed; sword → rock (default)
    g = _graph(
        _item("sword"), _item("iron_ingot"), _item("rock"),
        _edge("sword", "rock",       is_default=True,  slot_idx=0),
        _edge("sword", "iron_ingot", is_default=False, slot_idx=0),
    )
    annotate(g, _SIMPLE_GATES)
    assert g.nodes["sword"].era == "stone"


def test_returns_era_buckets():
    g = _graph(
        _item("rock"), _item("iron_ingot"), _item("knife"),
        _edge("knife", "rock"),
    )
    buckets = annotate(g, _SIMPLE_GATES)
    assert "stone" in buckets
    assert "rock" in buckets["stone"]
    assert "knife" in buckets["stone"]
    assert "iron" in buckets
    assert "iron_ingot" in buckets["iron"]


def test_unknown_gate_ids_silently_ignored():
    gates = {"stone": ["nonexistent_item"]}
    g = _graph(_item("axe"))
    buckets = annotate(g, gates)
    assert g.nodes["axe"].era is None
    assert buckets == {}


def test_era_order_is_correct():
    # Verify the ERA_ORDER matches design doc progression
    assert ERA_ORDER.index("wood") < ERA_ORDER.index("stone")
    assert ERA_ORDER.index("stone") < ERA_ORDER.index("copper")
    assert ERA_ORDER.index("copper") < ERA_ORDER.index("iron")
    assert ERA_ORDER.index("iron") < ERA_ORDER.index("plastics")
    assert ERA_ORDER.index("plastics") < ERA_ORDER.index("electrical")


def test_cycle_safety():
    g = _graph(
        _item("A"), _item("B"), _item("rock"),
        _edge("A", "B"),
        _edge("B", "A"),
        _edge("A", "rock"),
    )
    annotate(g, _SIMPLE_GATES)
    assert g.nodes["A"].era == "stone"
    assert g.nodes["B"].era == "stone"


def test_emit_includes_eras_after_annotate(tmp_path):
    import json
    from builder.emit import emit
    from builder.fetch import CloneResult

    g = _graph(
        _item("rock"), _item("knife"),
        _edge("knife", "rock"),
    )
    annotate(g, _SIMPLE_GATES)

    meta = CloneResult(path="/tmp", build_type="experimental",
                       tag=None, commit_sha="a"*40, commit_date="2024-01-01T00:00:00+00:00")
    emit(experimental=(g, meta), dest=tmp_path / "graph.json")
    data = json.loads((tmp_path / "graph.json").read_text())
    assert "stone" in data["experimental"]["eras"]
    assert "knife" in data["experimental"]["eras"]["stone"]


def test_emit_eras_empty_without_annotate(tmp_path):
    import json
    from builder.emit import emit
    from builder.fetch import CloneResult

    g = _graph(_item("rock"), _item("knife"), _edge("knife", "rock"))
    meta = CloneResult(path="/tmp", build_type="experimental",
                       tag=None, commit_sha="a"*40, commit_date="2024-01-01T00:00:00+00:00")
    emit(experimental=(g, meta), dest=tmp_path / "graph.json")
    data = json.loads((tmp_path / "graph.json").read_text())
    assert data["experimental"]["eras"] == {}


# ---------------------------------------------------------------------------
# Integration smoke test
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_eras_experimental():
    from builder.fetch import experimental
    from builder.load import load_all
    from builder.resolve import resolve
    from builder.graph import build

    clone = None
    try:
        clone = experimental()
        g = build(resolve(load_all(clone)))
        buckets = annotate(g)

        total_classified = sum(len(v) for v in buckets.values())
        total_nodes = len(g.nodes)

        print(f"\n--- Era Classification ({total_classified}/{total_nodes} nodes classified) ---")
        for era in ERA_ORDER:
            nodes = buckets.get(era, [])
            if nodes:
                examples = sorted(
                    nodes, key=lambda nid: g.nodes[nid].display_name
                )[:5]
                example_str = ", ".join(g.nodes[nid].display_name for nid in examples)
                print(f"  {era:12s}: {len(nodes):5d} nodes   e.g. {example_str}")
        unclassified = total_nodes - total_classified
        print(f"  {'(none)':12s}: {unclassified:5d} nodes")
        print("--- End Eras ---")

        assert total_classified > 0, "Expected some nodes to be classified"
        assert all(era in ERA_ORDER for era in buckets), "Unknown era in buckets"

    finally:
        if clone is not None:
            shutil.rmtree(clone.path, ignore_errors=True)
