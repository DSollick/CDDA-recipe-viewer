"""
Serialize two Graph objects (vanilla + innawood) into the graph.json consumed by the frontend.

Output structure
----------------
{
  "meta": {
    "generated_at": "<ISO-8601>",
    "cdda_commit": "<7-char sha>",
    "cdda_date": "<ISO-8601>",
    "builder_version": "<version>"
  },
  "vanilla":  { "nodes": {...}, "edges": [...], "eras": {...}, "bottlenecks": [...], ... },
  "innawood": { ...same structure }
}

Both datasets are built from the same CDDA checkout.
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


def _build_category_buckets(graph: "Graph") -> dict[str, list[str]]:
    buckets: dict[str, list[str]] = {}
    for nid, node in graph.nodes.items():
        if node.category is not None:
            buckets.setdefault(node.category, []).append(nid)
    return buckets


def _build_era_buckets(graph: "Graph") -> dict[str, list[str]]:
    buckets: dict[str, list[str]] = {}
    for nid, node in graph.nodes.items():
        if node.era is not None:
            buckets.setdefault(node.era, []).append(nid)
    return buckets


def _dataset(graph: "Graph") -> dict:
    """Serialize a single Graph into the dataset sub-object."""
    nodes = {nid: node.to_dict() for nid, node in graph.nodes.items()}
    edges = [e.to_dict() for e in graph.edges]

    ranked = sorted(
        [(nid, n.bottleneck_score) for nid, n in graph.nodes.items() if n.bottleneck_score > 0],
        key=lambda x: x[1],
        reverse=True,
    )
    bottlenecks = [nid for nid, _ in ranked[:20]]

    return {
        "nodes": nodes,
        "edges": edges,
        "eras": _build_era_buckets(graph),
        "bottlenecks": bottlenecks,
        "quality_providers": graph.quality_providers,
        "group_providers": graph.group_providers,
        "harvested_from": graph.harvested_from,
        "foraged_from": graph.foraged_from,
        "categories": _build_category_buckets(graph),
    }


def emit(
    *,
    vanilla: "tuple[Graph, CloneResult] | None" = None,
    innawood: "tuple[Graph, CloneResult] | None" = None,
    dest: "str | Path",
) -> None:
    """
    Write graph.json to *dest*.

    At least one of *vanilla* or *innawood* must be provided.
    Both are typically built from the same CloneResult.
    *dest* may be a file path or a directory (file written as graph.json inside it).
    """
    if vanilla is None and innawood is None:
        raise ValueError("At least one of vanilla or innawood must be provided")

    dest = Path(dest)
    if dest.is_dir():
        dest = dest / "graph.json"

    # Use whichever clone is available for meta (both come from the same checkout).
    clone_meta = (innawood or vanilla)[1]  # type: ignore[index]

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cdda_commit": clone_meta.commit_sha[:7],
        "cdda_date": clone_meta.commit_date,
        "builder_version": _builder_version(),
    }

    output: dict = {"meta": meta}
    if vanilla is not None:
        output["vanilla"] = _dataset(vanilla[0])
    if innawood is not None:
        output["innawood"] = _dataset(innawood[0])

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
