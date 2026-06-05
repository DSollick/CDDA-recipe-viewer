"""
Bottleneck scoring for the CDDA dependency graph.

A bottleneck node is an item (or other graph node) that a large number of
distinct craftable items transitively depend on. These are the "unlock gates"
of the Innawood progression — the anvil problem.

Algorithm
---------
1. Build a forward dependency graph from requires_component edges (default path
   only). Both consumed components (qty > 0) and tool deps (qty = -1) are included
   because tools are real progression gates. Quality/skill/proficiency node targets
   are excluded — those are gates too, but not item nodes.

2. For each source node (any node with outgoing dep edges), walk its full
   transitive dependency set with an iterative DFS. Each reachable node has its
   score incremented by one. A visited set per source prevents double-counting
   and handles any cycles safely.

3. Scores are written onto Node.bottleneck_score in-place by annotate().
   The top-N node IDs (sorted by score, highest first) are returned.
"""

from __future__ import annotations

import collections
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from builder.graph import Graph

log = logging.getLogger(__name__)

_VIRTUAL_PREFIXES = ("qual_", "skill_", "prof_")


def _build_dep_graph(graph: "Graph") -> dict[str, set[str]]:
    """
    Return forward adjacency: node_id → set of item node_ids it directly
    depends on (requires_component, is_default=True, item targets only).
    """
    deps: dict[str, set[str]] = collections.defaultdict(set)
    for edge in graph.edges:
        if not (edge.type == "requires_component" and edge.is_default):
            continue
        target = edge.to_node
        if any(target.startswith(p) for p in _VIRTUAL_PREFIXES):
            continue
        deps[edge.from_node].add(target)
    return dict(deps)


def score(graph: "Graph") -> dict[str, int]:
    """
    Compute raw bottleneck scores for all nodes.

    score(N) = number of distinct nodes whose transitive dependency set
    contains N (following is_default requires_component edges only).
    """
    deps = _build_dep_graph(graph)
    counts: dict[str, int] = collections.defaultdict(int)

    for source, direct in deps.items():
        visited: set[str] = set()
        stack = list(direct)
        while stack:
            node = stack.pop()
            if node in visited:
                continue
            visited.add(node)
            counts[node] += 1
            for child in deps.get(node, ()):
                if child not in visited:
                    stack.append(child)

    return dict(counts)


def annotate(graph: "Graph", top_n: int = 20) -> list[str]:
    """
    Compute bottleneck scores, write them into Node.bottleneck_score in-place,
    and return a sorted list of the top_n node IDs (highest score first).

    Only nodes that exist in graph.nodes are annotated; scores for stub
    nodes or missing IDs are computed but not written.
    """
    scores = score(graph)
    for node_id, s in scores.items():
        node = graph.nodes.get(node_id)
        if node is not None:
            node.bottleneck_score = s

    ranked = sorted(
        [(nid, s) for nid, s in scores.items() if nid in graph.nodes],
        key=lambda x: x[1],
        reverse=True,
    )
    top = [nid for nid, _ in ranked[:top_n]]
    if top:
        log.info(
            "Top bottleneck: %s (score=%d)",
            top[0], scores[top[0]],
        )
    return top
