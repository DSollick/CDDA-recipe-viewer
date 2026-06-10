"""
Pipeline entry point: python -m builder [options]

Full pipeline: fetch → load → resolve × 2 → graph × 2 → bottlenecks → eras → emit

Builds two datasets from a single CDDA clone:
  vanilla   — base CDDA data, no mods
  innawood  — vanilla + Innawood mod layer applied
"""
from __future__ import annotations

import argparse
import logging
import shutil
import sys


def _build_both(clone):
    from builder import load
    from builder import resolve as res_mod
    from builder import graph as graph_mod
    from builder import bottlenecks, eras

    data = load.load_all(clone)

    vanilla_resolved = res_mod.resolve_vanilla(data)
    innawood_resolved = res_mod.resolve_innawood(data)

    vanilla_graph = graph_mod.build(vanilla_resolved)
    innawood_graph = graph_mod.build(innawood_resolved)

    for g in (vanilla_graph, innawood_graph):
        bottlenecks.annotate(g)
        eras.annotate(g)

    return vanilla_graph, innawood_graph


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build CDDA Innawood recipe graph and write graph.json"
    )
    parser.add_argument("--out", required=True, metavar="PATH", help="Output path for graph.json")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    from builder import fetch, emit

    clone = fetch.experimental()
    try:
        vanilla_graph, innawood_graph = _build_both(clone)
        emit.emit(vanilla=(vanilla_graph, clone), innawood=(innawood_graph, clone), dest=args.out)
    finally:
        shutil.rmtree(clone.path, ignore_errors=True)


if __name__ == "__main__":
    main()
