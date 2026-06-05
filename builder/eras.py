"""
Era classification for the CDDA/Innawood dependency graph.

Two-step process:
  1. A small config (era_gates.json) maps known gate items to their era.
  2. Every other node's era = the latest-era gate found anywhere in its
     transitive dependency set (following is_default=True edges).
     Nodes with no gate in their tree get era = None.

Era ordering (Wood is earliest, Energy is latest):
  Wood → Stone → Bone → Leather → Copper → Bronze → Iron →
  Glass → Chemical → Plastics → Combustion → Electrical → Energy
"""

from __future__ import annotations

import collections
import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from builder.graph import Graph

log = logging.getLogger(__name__)

ERA_ORDER: list[str] = [
    "wood", "stone", "bone", "leather", "copper", "bronze",
    "iron", "glass", "chemical", "plastics", "combustion",
    "electrical", "energy",
]

_ERA_RANK: dict[str, int] = {e: i for i, e in enumerate(ERA_ORDER)}
_VIRTUAL_PREFIXES = ("qual_", "skill_", "prof_")
_GATES_PATH = Path(__file__).parent / "era_gates.json"


def load_gates(path: Path | None = None) -> dict[str, list[str]]:
    """Load the era gate config from era_gates.json (or a custom path)."""
    p = path or _GATES_PATH
    with p.open(encoding="utf-8") as f:
        raw = json.load(f)
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def _build_item_to_era(gates: dict[str, list[str]], graph: "Graph") -> dict[str, str]:
    """Invert the gates config to item_id → era, filtering to items in the graph."""
    item_to_era: dict[str, str] = {}
    for era, item_ids in gates.items():
        if era not in _ERA_RANK:
            log.warning("Unknown era %r in gates config — skipping", era)
            continue
        for item_id in item_ids:
            if item_id in graph.nodes:
                item_to_era[item_id] = era
            else:
                log.debug("Gate item %r not in graph — skipping", item_id)
    return item_to_era


def _build_default_dep_graph(graph: "Graph") -> dict[str, set[str]]:
    """
    Forward adjacency following is_default=True requires_component edges.

    Unlike bottlenecks._build_dep_graph this follows ALL default-path edges,
    not just must-have ones — for era purposes we want the natural crafting
    path, including slots where alternatives exist.
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


def _classify(
    node_id: str,
    deps: dict[str, set[str]],
    item_to_era: dict[str, str],
) -> str | None:
    """
    BFS from node_id through the dep graph.
    Returns the latest-era gate found, or None if no gate is reachable.
    """
    best_rank = -1
    visited: set[str] = set()
    stack = [node_id]
    while stack:
        node = stack.pop()
        if node in visited:
            continue
        visited.add(node)
        era = item_to_era.get(node)
        if era is not None:
            r = _ERA_RANK[era]
            if r > best_rank:
                best_rank = r
            # Gate items are opaque: don't traverse into their deps.
            # An item that depends on hotplate (iron gate) is iron era regardless
            # of what hotplate itself is made from internally.
            continue
        for child in deps.get(node, ()):
            if child not in visited:
                stack.append(child)
    return ERA_ORDER[best_rank] if best_rank >= 0 else None


def annotate(
    graph: "Graph",
    gates: dict[str, list[str]] | None = None,
) -> dict[str, list[str]]:
    """
    Classify all nodes into eras, write node.era in-place, and return
    a dict mapping era name → list of node IDs in that era.

    Nodes with no gate in their transitive dep tree get era = None
    and are not included in the returned dict.
    """
    if gates is None:
        gates = load_gates()

    item_to_era = _build_item_to_era(gates, graph)
    deps = _build_default_dep_graph(graph)

    era_buckets: dict[str, list[str]] = collections.defaultdict(list)
    classified = 0

    for node_id, node in graph.nodes.items():
        if node_id in item_to_era:
            # Gate items: pinned to their specified era regardless of their own deps.
            # This prevents e.g. cable (copper gate) being bumped to plastics because
            # it depends on duct_tape.
            era = item_to_era[node_id]
        else:
            era = _classify(node_id, deps, item_to_era)
        node.era = era
        if era is not None:
            era_buckets[era].append(node_id)
            classified += 1

    log.info(
        "Era classification: %d/%d nodes classified",
        classified, len(graph.nodes),
    )
    for era in ERA_ORDER:
        if era in era_buckets:
            log.debug("  %-12s: %d nodes", era, len(era_buckets[era]))

    return dict(era_buckets)
