"""
Pipeline entry point: python -m builder [options]

Fetches CDDA master HEAD once, then for each configured mod:
  load → resolve → graph → bottlenecks → eras → emit

Produces one graph-<mod_id>.json per mod plus a graph-manifest.json index.
"""
from __future__ import annotations

import argparse
import logging
import shutil
import sys


def _build_mod(clone, mod_id: str, mod_dir: str):
    from builder import load
    from builder.resolve import resolve_vanilla, resolve_with_mod
    from builder import graph as graph_mod
    from builder import bottlenecks, eras

    data = load.load_all(clone, mod_dir=mod_dir)
    resolved = resolve_vanilla(data) if not mod_dir else resolve_with_mod(data, mod_name=mod_id)
    g = graph_mod.build(resolved)
    bottlenecks.annotate(g)
    eras.annotate(g)
    return g


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build CDDA recipe graphs and write per-mod graph JSON files"
    )
    parser.add_argument("--out", required=True, metavar="DIR",
                        help="Output directory for graph-*.json and graph-manifest.json")
    parser.add_argument("--mods", metavar="ID,...",
                        help="Comma-separated mod IDs to build (default: all configured mods)")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    from builder import fetch, emit
    from builder.mods import MODS

    selected_ids = set(args.mods.split(",")) if args.mods else None
    mods_to_build = [m for m in MODS if selected_ids is None or m.id in selected_ids]

    clone = fetch.experimental()
    try:
        built = []
        for mod in mods_to_build:
            log.info("Building mod: %s (%s)", mod.id, mod.dir_name or "vanilla")
            graph = _build_mod(clone, mod.id, mod.dir_name)
            built.append((mod, graph))

        emit.emit_all(built, clone=clone, dest=args.out)
    finally:
        shutil.rmtree(clone.path, ignore_errors=True)


log = logging.getLogger(__name__)

if __name__ == "__main__":
    main()
