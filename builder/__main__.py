"""
Pipeline entry point: python -m builder [options]

Full pipeline: fetch → load → resolve → graph → bottlenecks → eras → emit
"""
from __future__ import annotations

import argparse
import logging
import shutil
import sys


def _pipeline(clone):
    from builder import load
    from builder import resolve as res_mod
    from builder import graph as graph_mod
    from builder import bottlenecks, eras

    data = load.load_all(clone)
    resolved = res_mod.resolve(data)
    graph = graph_mod.build(resolved)
    bottlenecks.annotate(graph)
    eras.annotate(graph)
    return graph


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build CDDA Innawood recipe graph and write graph.json"
    )
    parser.add_argument("--experimental", action="store_true", help="Fetch CDDA master HEAD")
    parser.add_argument("--stable", action="store_true", help="Fetch latest CDDA stable tag")
    parser.add_argument("--out", required=True, metavar="PATH", help="Output path for graph.json")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    if not args.experimental and not args.stable:
        parser.error("At least one of --experimental or --stable is required")

    from builder import fetch, emit

    clones = []
    exp_pair = None
    stable_pair = None

    try:
        if args.experimental:
            clone = fetch.experimental()
            clones.append(clone)
            exp_pair = (_pipeline(clone), clone)

        if args.stable:
            clone = fetch.stable()
            clones.append(clone)
            stable_pair = (_pipeline(clone), clone)

        emit.emit(experimental=exp_pair, stable=stable_pair, dest=args.out)

    finally:
        for clone in clones:
            shutil.rmtree(clone.path, ignore_errors=True)


if __name__ == "__main__":
    main()
