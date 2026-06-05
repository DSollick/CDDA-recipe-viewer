"""
Serialize one or two Graph objects into the graph.json format consumed by the frontend.

Output structure
----------------
{
  "meta": {
    "generated_at": "<ISO-8601>",
    "cdda_stable_tag": "<tag>",          // null if stable not provided
    "cdda_stable_commit": "<sha>",        // null if stable not provided
    "cdda_experimental_commit": "<sha>",  // null if experimental not provided
    "cdda_experimental_date": "<ISO-8601>", // null if experimental not provided
    "builder_version": "<version>"
  },
  "stable": {
    "nodes": { "<node_id>": { ...node }, ... },
    "edges": [ { ...edge }, ... ],
    "eras": {},           // populated by eras.py (not yet implemented)
    "bottlenecks": []     // populated by bottlenecks.py (not yet implemented)
  },
  "experimental": { ...same structure }   // absent if experimental not provided
}

Both `stable` and `experimental` are optional individually, but at least one must be given.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from builder.fetch import CloneResult
    from builder.graph import Graph

log = logging.getLogger(__name__)


def _builder_version() -> str:
    try:
        return importlib.metadata.version("cdda-builder")
    except importlib.metadata.PackageNotFoundError:
        return "dev"


def _dataset(graph: "Graph") -> dict:
    """Serialize a single Graph into the dataset sub-object."""
    nodes = {nid: node.to_dict() for nid, node in graph.nodes.items()}
    edges = [e.to_dict() for e in graph.edges]

    # Derive top-20 bottleneck list from node scores written by bottlenecks.annotate().
    # If annotate() was never called all scores are 0 and the list stays empty.
    ranked = sorted(
        [(nid, n.bottleneck_score) for nid, n in graph.nodes.items() if n.bottleneck_score > 0],
        key=lambda x: x[1],
        reverse=True,
    )
    bottlenecks = [nid for nid, _ in ranked[:20]]

    return {
        "nodes": nodes,
        "edges": edges,
        "eras": {},         # TODO: populated by eras.py
        "bottlenecks": bottlenecks,
    }


def emit(
    *,
    stable: "tuple[Graph, CloneResult] | None" = None,
    experimental: "tuple[Graph, CloneResult] | None" = None,
    dest: "str | Path",
) -> None:
    """
    Write graph.json to *dest*.

    At least one of *stable* or *experimental* must be provided.
    *dest* may be a file path or a directory (file written as graph.json inside it).
    """
    if stable is None and experimental is None:
        raise ValueError("At least one of stable or experimental must be provided")

    dest = Path(dest)
    if dest.is_dir():
        dest = dest / "graph.json"

    stable_graph, stable_meta = stable if stable is not None else (None, None)
    exp_graph, exp_meta = experimental if experimental is not None else (None, None)

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cdda_stable_tag": stable_meta.tag if stable_meta else None,
        "cdda_stable_commit": stable_meta.commit_sha[:7] if stable_meta else None,
        "cdda_experimental_commit": exp_meta.commit_sha[:7] if exp_meta else None,
        "cdda_experimental_date": exp_meta.commit_date if exp_meta else None,
        "builder_version": _builder_version(),
    }

    output: dict = {"meta": meta}
    if stable_graph is not None:
        output["stable"] = _dataset(stable_graph)
    if exp_graph is not None:
        output["experimental"] = _dataset(exp_graph)

    dest.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(output, ensure_ascii=False, separators=(",", ":"))
    dest.write_text(content, encoding="utf-8")

    size_kb = len(content.encode()) / 1024
    sha = hashlib.sha256(content.encode()).hexdigest()[:12]
    log.info("Wrote %s  (%.0f KB, sha256=%.12s)", dest, size_kb, sha)


def content_hash(path: "str | Path") -> str | None:
    """Return a short SHA-256 hex digest of the file at *path*, or None if it doesn't exist."""
    p = Path(path)
    if not p.exists():
        return None
    return hashlib.sha256(p.read_bytes()).hexdigest()
