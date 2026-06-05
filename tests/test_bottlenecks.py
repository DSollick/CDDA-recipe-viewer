"""Tests for bottlenecks.py — scoring and annotation."""

import shutil

import pytest

from builder.bottlenecks import score, annotate
from builder.graph import Graph, Node, Edge


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _item(id_: str, **kw) -> Node:
    return Node(id=id_, type="item", display_name=id_, **kw)


def _edge(from_: str, to: str, *, is_default=True, qty=1) -> Edge:
    return Edge(from_node=from_, to_node=to, type="requires_component",
                quantity=qty, is_default=is_default)


def _graph(*nodes_and_edges) -> Graph:
    nodes = {n.id: n for n in nodes_and_edges if isinstance(n, Node)}
    edges = [e for e in nodes_and_edges if isinstance(e, Edge)]
    return Graph(nodes=nodes, edges=edges)


# ---------------------------------------------------------------------------
# Unit tests — score()
# ---------------------------------------------------------------------------

def test_score_empty_graph():
    g = Graph(nodes={}, edges=[])
    assert score(g) == {}


def test_score_single_dep():
    # axe → axe_head
    g = _graph(
        _item("axe"), _item("axe_head"),
        _edge("axe", "axe_head"),
    )
    s = score(g)
    assert s.get("axe_head", 0) == 1
    assert s.get("axe", 0) == 0  # sources don't count themselves


def test_score_shared_dep():
    # axe → stick; spear → stick  ⟹ stick.score == 2
    g = _graph(
        _item("axe"), _item("spear"), _item("stick"),
        _edge("axe", "stick"),
        _edge("spear", "stick"),
    )
    s = score(g)
    assert s["stick"] == 2


def test_score_transitive():
    # sword → blade → iron_ore  ⟹ iron_ore.score == 2 (blade+sword both reach it)
    g = _graph(
        _item("sword"), _item("blade"), _item("iron_ore"),
        _edge("sword", "blade"),
        _edge("blade", "iron_ore"),
    )
    s = score(g)
    assert s["iron_ore"] == 2  # blade and sword both depend on iron_ore
    assert s["blade"] == 1    # only sword depends on blade


def test_score_does_not_count_non_default():
    # alt edge is_default=False — should not be followed
    g = _graph(
        _item("axe"), _item("axe_head"), _item("alt_head"),
        _edge("axe", "axe_head", is_default=True),
        _edge("axe", "alt_head", is_default=False),
    )
    s = score(g)
    assert s.get("axe_head", 0) == 1
    assert s.get("alt_head", 0) == 0


def test_score_skips_virtual_nodes():
    # requires_component edge targeting a qual_/skill_/prof_ node — must be ignored
    g = Graph(
        nodes={
            "axe": _item("axe"),
            "qual_CUT_1": Node(id="qual_CUT_1", type="quality", display_name="Cutting 1"),
        },
        edges=[
            Edge(from_node="axe", to_node="qual_CUT_1",
                 type="requires_tool_quality", is_default=True),
            Edge(from_node="axe", to_node="qual_CUT_1",
                 type="requires_component", quantity=1, is_default=True),
        ],
    )
    s = score(g)
    # qual_ prefix must be filtered
    assert "qual_CUT_1" not in s


def test_score_handles_cycle():
    # A → B → A (defensive: shouldn't loop forever or raise)
    g = _graph(
        _item("A"), _item("B"),
        _edge("A", "B"),
        _edge("B", "A"),
    )
    s = score(g)
    # Both nodes are reachable from the other — exact counts are less important than no crash
    assert isinstance(s, dict)


def test_score_tool_dep_counted():
    # Tool dep (qty=-1) should be followed — tools are progression gates
    g = _graph(
        _item("plank"), _item("saw"),
        _edge("plank", "saw", qty=-1),
    )
    s = score(g)
    assert s.get("saw", 0) == 1


def test_score_chain_depth():
    # a → b → c → d; d.score should be 3 (a, b, c all depend on it transitively)
    g = _graph(
        _item("a"), _item("b"), _item("c"), _item("d"),
        _edge("a", "b"), _edge("b", "c"), _edge("c", "d"),
    )
    s = score(g)
    assert s["d"] == 3
    assert s["c"] == 2
    assert s["b"] == 1


def test_score_diamond():
    #   a
    #  / \
    # b   c
    #  \ /
    #   d
    # d.score = 3 (a, b, c); b.score = c.score = 1 (a)
    g = _graph(
        _item("a"), _item("b"), _item("c"), _item("d"),
        _edge("a", "b"), _edge("a", "c"),
        _edge("b", "d"), _edge("c", "d"),
    )
    s = score(g)
    assert s["d"] == 3
    assert s["b"] == 1
    assert s["c"] == 1


# ---------------------------------------------------------------------------
# Unit tests — annotate()
# ---------------------------------------------------------------------------

def test_annotate_writes_scores_to_nodes():
    g = _graph(
        _item("axe"), _item("stick"),
        _edge("axe", "stick"),
    )
    annotate(g)
    assert g.nodes["stick"].bottleneck_score == 1
    assert g.nodes["axe"].bottleneck_score == 0


def test_annotate_returns_top_n():
    g = _graph(
        _item("a"), _item("b"), _item("c"), _item("d"),
        _edge("a", "d"), _edge("b", "d"), _edge("c", "d"),
        _edge("a", "c"),
    )
    top = annotate(g, top_n=2)
    assert top[0] == "d"  # highest score
    assert len(top) <= 2


def test_annotate_top_n_respects_limit():
    # Chain: a → b → c → d → e gives d.score=4, c.score=3, b.score=2, e.score=0+...
    # Actually: a→b→c→d→e: e.score=4, d.score=3, c.score=2, b.score=1 — 4 nodes with scores
    items = [_item(x) for x in ("a", "b", "c", "d", "e")]
    edges = [
        _edge("a", "b"), _edge("b", "c"), _edge("c", "d"), _edge("d", "e"),
    ]
    g = _graph(*items, *edges)
    top = annotate(g, top_n=3)
    assert len(top) == 3


def test_annotate_empty_graph_returns_empty():
    g = Graph(nodes={}, edges=[])
    top = annotate(g)
    assert top == []


def test_annotate_no_deps_returns_empty():
    g = _graph(_item("axe"), _item("stick"))  # no edges
    top = annotate(g)
    assert top == []


# ---------------------------------------------------------------------------
# Integration with emit
# ---------------------------------------------------------------------------

def test_emit_includes_bottlenecks_after_annotate(tmp_path):
    import json
    from builder.emit import emit
    from builder.fetch import CloneResult

    g = _graph(
        _item("a"), _item("b"), _item("c"),
        _edge("a", "c"), _edge("b", "c"),
    )
    annotate(g)
    assert g.nodes["c"].bottleneck_score == 2

    meta = CloneResult(
        path="/tmp/fake", build_type="experimental",
        tag=None, commit_sha="a" * 40, commit_date="2024-01-01T00:00:00+00:00",
    )
    dest = tmp_path / "graph.json"
    emit(experimental=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    assert "c" in data["experimental"]["bottlenecks"]


def test_emit_bottlenecks_empty_without_annotate(tmp_path):
    import json
    from builder.emit import emit
    from builder.fetch import CloneResult

    g = _graph(_item("a"), _item("b"), _item("c"), _edge("a", "c"), _edge("b", "c"))
    meta = CloneResult(
        path="/tmp/fake", build_type="experimental",
        tag=None, commit_sha="a" * 40, commit_date="2024-01-01T00:00:00+00:00",
    )
    dest = tmp_path / "graph.json"
    emit(experimental=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    assert data["experimental"]["bottlenecks"] == []


# ---------------------------------------------------------------------------
# Integration smoke test
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_bottlenecks_experimental():
    from builder.fetch import experimental
    from builder.load import load_all
    from builder.resolve import resolve
    from builder.graph import build

    clone = None
    try:
        clone = experimental()
        data = load_all(clone)
        resolved = resolve(data)
        g = build(resolved)
        top = annotate(g)

        assert len(top) == 20, f"Expected 20 bottlenecks, got {len(top)}"
        assert all(nid in g.nodes for nid in top), "Bottleneck IDs must exist in graph"

        print("\n--- Top 20 Bottleneck Nodes ---")
        for nid in top:
            node = g.nodes[nid]
            print(f"  {nid:30s}  score={node.bottleneck_score:>5d}  ({node.display_name})")
        print("--- End Bottlenecks ---")

    finally:
        if clone is not None:
            shutil.rmtree(clone.path, ignore_errors=True)
