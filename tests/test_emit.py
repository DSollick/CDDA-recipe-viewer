"""Tests for emit.py — graph serialization."""

import json
import shutil
from pathlib import Path

import pytest

from builder.emit import emit_all, content_hash
from builder.mods import VANILLA, ModConfig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fake_clone(sha="a" * 40, date="2024-01-01T00:00:00+00:00"):
    from builder.fetch import CloneResult
    return CloneResult(path="/tmp/fake", build_type="experimental", tag=None, commit_sha=sha, commit_date=date)


def _minimal_graph():
    from tests.test_graph import _minimal_resolved
    from builder.graph import build
    return build(_minimal_resolved())


def _emit_one(tmp_path, mod=VANILLA, **clone_kwargs):
    """Helper: emit a single-mod dataset and return (dest_dir, parsed_manifest)."""
    g = _minimal_graph()
    clone = _fake_clone(**clone_kwargs)
    emit_all([(mod, g)], clone=clone, dest=tmp_path)
    manifest = json.loads((tmp_path / "graph-manifest.json").read_text())
    return tmp_path, manifest


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------

def test_emit_writes_manifest(tmp_path):
    _, manifest = _emit_one(tmp_path)
    assert (tmp_path / "graph-manifest.json").exists()
    assert "mods" in manifest


def test_emit_writes_dataset_file(tmp_path):
    dest, manifest = _emit_one(tmp_path)
    fname = manifest["mods"][0]["file"]
    assert (dest / fname).exists()


def test_emit_creates_parent_dirs(tmp_path):
    g = _minimal_graph()
    clone = _fake_clone()
    dest = tmp_path / "output" / "subdir"
    emit_all([(VANILLA, g)], clone=clone, dest=dest)
    assert (dest / "graph-manifest.json").exists()


def test_emit_dataset_valid_json(tmp_path):
    dest, manifest = _emit_one(tmp_path)
    fname = manifest["mods"][0]["file"]
    data = json.loads((dest / fname).read_text())
    assert isinstance(data, dict)


def test_emit_manifest_meta_fields(tmp_path):
    _, manifest = _emit_one(tmp_path, sha="b" * 40, date="2024-06-01T12:00:00+00:00")
    assert "generated_at" in manifest
    assert "builder_version" in manifest
    assert manifest["cdda_commit"] == "b" * 7
    assert manifest["cdda_date"] == "2024-06-01T12:00:00+00:00"


def test_emit_first_mod_is_default(tmp_path):
    g = _minimal_graph()
    clone = _fake_clone()
    innawood = ModConfig(id="innawood", label="Innawood", dir_name="innawood")
    emit_all([(VANILLA, g), (innawood, g)], clone=clone, dest=tmp_path)
    manifest = json.loads((tmp_path / "graph-manifest.json").read_text())
    assert manifest["mods"][0].get("default") is True
    assert "default" not in manifest["mods"][1]


def test_emit_both_mods_present(tmp_path):
    g = _minimal_graph()
    clone = _fake_clone()
    innawood = ModConfig(id="innawood", label="Innawood", dir_name="innawood")
    emit_all([(VANILLA, g), (innawood, g)], clone=clone, dest=tmp_path)
    manifest = json.loads((tmp_path / "graph-manifest.json").read_text())
    ids = [m["id"] for m in manifest["mods"]]
    assert "vanilla" in ids
    assert "innawood" in ids
    for mod in manifest["mods"]:
        assert (tmp_path / mod["file"]).exists()


def test_emit_dataset_structure(tmp_path):
    dest, manifest = _emit_one(tmp_path)
    fname = manifest["mods"][0]["file"]
    ds = json.loads((dest / fname).read_text())
    for key in ("nodes", "edges", "eras", "bottlenecks"):
        assert key in ds
    assert isinstance(ds["nodes"], dict)
    assert isinstance(ds["edges"], list)


def test_emit_nodes_keyed_by_id(tmp_path):
    dest, manifest = _emit_one(tmp_path)
    fname = manifest["mods"][0]["file"]
    nodes = json.loads((dest / fname).read_text())["nodes"]
    assert "wooden_stake" in nodes
    assert "stick" in nodes


def test_emit_node_has_expected_fields(tmp_path):
    dest, manifest = _emit_one(tmp_path)
    fname = manifest["mods"][0]["file"]
    node = json.loads((dest / fname).read_text())["nodes"]["wooden_stake"]
    assert node["type"] == "item"
    assert "display_name" in node
    assert "learn_method" in node


def test_emit_edges_use_from_to_keys(tmp_path):
    dest, manifest = _emit_one(tmp_path)
    fname = manifest["mods"][0]["file"]
    edges = json.loads((dest / fname).read_text())["edges"]
    for e in edges:
        assert "from" in e
        assert "to" in e
        assert "from_node" not in e
        assert "to_node" not in e


def test_emit_eras_and_bottlenecks_empty(tmp_path):
    dest, manifest = _emit_one(tmp_path)
    fname = manifest["mods"][0]["file"]
    ds = json.loads((dest / fname).read_text())
    assert ds["eras"] == {}
    assert ds["bottlenecks"] == []


def test_content_hash_none_for_missing_file(tmp_path):
    assert content_hash(tmp_path / "nonexistent.json") is None


def test_content_hash_changes_on_content_change(tmp_path):
    f = tmp_path / "f.json"
    f.write_text('{"a":1}')
    h1 = content_hash(f)
    f.write_text('{"a":2}')
    h2 = content_hash(f)
    assert h1 != h2


def test_content_hash_stable(tmp_path):
    f = tmp_path / "f.json"
    f.write_text('{"hello":"world"}')
    assert content_hash(f) == content_hash(f)


# ---------------------------------------------------------------------------
# Integration smoke test
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_emit_all_mods(tmp_path):
    from builder.fetch import experimental
    from builder.load import load_all
    from builder.resolve import resolve_vanilla, resolve_with_mod
    from builder.graph import build
    from builder.mods import MODS

    clone = None
    try:
        clone = experimental()
        vanilla_data = load_all(clone, mod_dir="")
        vanilla_g = build(resolve_vanilla(vanilla_data))

        built = [(VANILLA, vanilla_g)]
        for mod in MODS[1:]:  # skip vanilla — already built
            data = load_all(clone, mod_dir=mod.dir_name)
            g = build(resolve_with_mod(data))
            built.append((mod, g))

        emit_all(built, clone=clone, dest=tmp_path)

        manifest = json.loads((tmp_path / "graph-manifest.json").read_text())
        assert len(manifest["mods"]) == len(MODS)

        for mod_entry in manifest["mods"]:
            ds = json.loads((tmp_path / mod_entry["file"]).read_text())
            assert len(ds["nodes"]) > 5000, f"{mod_entry['id']}: too few nodes"
            print(f"{mod_entry['id']}: nodes={len(ds['nodes'])}, edges={len(ds['edges'])}")

    finally:
        if clone is not None:
            shutil.rmtree(clone.path, ignore_errors=True)
