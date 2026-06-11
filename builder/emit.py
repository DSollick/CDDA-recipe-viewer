"""
Serialize Graph objects into per-mod graph JSON files consumed by the frontend.

Output structure (one file per mod)
------------------------------------
graph-<mod_id>.json:
{
  "nodes": { "<node_id>": { ...node }, ... },
  "edges": [ { ...edge }, ... ],
  "eras": { "<era>": ["<node_id>", ...], ... },
  "bottlenecks": ["<node_id>", ...],   // top-20 by bottleneck_score
  "quality_providers": { ... },
  "group_providers": { ... },
  "harvested_from": { ... },
  "foraged_from": { ... },
  "categories": { "<category>": ["<node_id>", ...], ... }
}

Manifest (graph-manifest.json):
{
  "generated_at": "<ISO-8601>",
  "cdda_commit": "<7-char sha>",
  "cdda_date": "<ISO-8601>",
  "builder_version": "<version>",
  "mods": [
    { "id": "vanilla",   "label": "Vanilla",   "file": "graph-vanilla.json",   "default": true },
    { "id": "innawood",  "label": "Innawood",  "file": "graph-innawood.json"  },
    ...
  ]
}
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
    from builder.mods import ModConfig

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
    """Serialize a Graph into the dataset object written to each graph-<mod>.json."""
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


def emit_all(
    mods: "list[tuple[ModConfig, Graph]]",
    *,
    clone: "CloneResult",
    dest: "str | Path",
) -> None:
    """
    Write one graph-<mod_id>.json per mod plus graph-manifest.json into *dest* directory.
    """
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)

    generated_at = datetime.now(timezone.utc).isoformat()
    builder_ver = _builder_version()

    manifest_mods = []
    for i, (mod, graph) in enumerate(mods):
        filename = f"graph-{mod.id}.json"
        filepath = dest / filename

        content = json.dumps(_dataset(graph), ensure_ascii=False, separators=(",", ":"))
        filepath.write_text(content, encoding="utf-8")

        size_kb = len(content.encode()) / 1024
        sha = hashlib.sha256(content.encode()).hexdigest()[:12]
        log.info("Wrote %s  (%.0f KB, sha256=%.12s)", filepath, size_kb, sha)

        entry: dict = {"id": mod.id, "label": mod.label, "file": filename}
        if i == 0:
            entry["default"] = True
        manifest_mods.append(entry)

    manifest = {
        "generated_at": generated_at,
        "cdda_commit": clone.commit_sha[:7],
        "cdda_date": clone.commit_date,
        "builder_version": builder_ver,
        "mods": manifest_mods,
    }
    manifest_path = dest / "graph-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("Wrote %s  (%d mods)", manifest_path, len(mods))


def content_hash(path: "str | Path") -> str | None:
    """Return a short SHA-256 hex digest of the file at *path*, or None if it doesn't exist."""
    p = Path(path)
    if not p.exists():
        return None
    return hashlib.sha256(p.read_bytes()).hexdigest()
