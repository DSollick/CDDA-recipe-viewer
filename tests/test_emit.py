"""Tests for emit.py — graph serialization."""

import json
import shutil
from pathlib import Path

import pytest

from builder.emit import emit, content_hash


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fake_clone_result(sha="a" * 40, date="2024-01-01T00:00:00+00:00"):
    from builder.fetch import CloneResult
    return CloneResult(path="/tmp/fake", build_type="experimental", tag=None, commit_sha=sha, commit_date=date)


def _minimal_graph():
    from tests.test_graph import _minimal_resolved
    from builder.graph import build
    return build(_minimal_resolved())


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------

def test_emit_requires_at_least_one_dataset(tmp_path):
    with pytest.raises(ValueError, match="[Aa]t least one"):
        emit(dest=tmp_path / "graph.json")


def test_emit_writes_file(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    emit(innawood=(g, meta), dest=tmp_path / "graph.json")
    assert (tmp_path / "graph.json").exists()


def test_emit_dest_is_directory(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    emit(innawood=(g, meta), dest=tmp_path)
    assert (tmp_path / "graph.json").exists()


def test_emit_creates_parent_dirs(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "output" / "subdir" / "graph.json"
    emit(innawood=(g, meta), dest=dest)
    assert dest.exists()


def test_emit_valid_json(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "graph.json"
    emit(innawood=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    assert isinstance(data, dict)


def test_emit_meta_fields_present(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result(sha="b" * 40, date="2024-06-01T12:00:00+00:00")
    dest = tmp_path / "graph.json"
    emit(innawood=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    m = data["meta"]
    assert "generated_at" in m
    assert "builder_version" in m
    assert m["cdda_commit"] == "b" * 7
    assert m["cdda_date"] == "2024-06-01T12:00:00+00:00"


def test_emit_vanilla_only(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result(sha="c" * 40)
    dest = tmp_path / "graph.json"
    emit(vanilla=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    assert "vanilla" in data
    assert "innawood" not in data
    assert data["meta"]["cdda_commit"] == "c" * 7


def test_emit_innawood_dataset_structure(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "graph.json"
    emit(innawood=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    ds = data["innawood"]
    assert "nodes" in ds
    assert "edges" in ds
    assert "eras" in ds
    assert "bottlenecks" in ds
    assert isinstance(ds["nodes"], dict)
    assert isinstance(ds["edges"], list)


def test_emit_nodes_keyed_by_id(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "graph.json"
    emit(innawood=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    nodes = data["innawood"]["nodes"]
    assert "wooden_stake" in nodes
    assert "stick" in nodes


def test_emit_node_has_expected_fields(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "graph.json"
    emit(innawood=(g, meta), dest=dest)
    node = json.loads(dest.read_text())["innawood"]["nodes"]["wooden_stake"]
    assert node["type"] == "item"
    assert "display_name" in node
    assert "learn_method" in node


def test_emit_edges_use_from_to_keys(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "graph.json"
    emit(innawood=(g, meta), dest=dest)
    edges = json.loads(dest.read_text())["innawood"]["edges"]
    for e in edges:
        assert "from" in e
        assert "to" in e
        assert "from_node" not in e
        assert "to_node" not in e


def test_emit_both_datasets(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result(sha="e" * 40)
    dest = tmp_path / "graph.json"
    emit(vanilla=(g, meta), innawood=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    assert "vanilla" in data
    assert "innawood" in data
    assert data["meta"]["cdda_commit"] == "e" * 7


def test_emit_eras_and_bottlenecks_empty(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "graph.json"
    emit(innawood=(g, meta), dest=dest)
    ds = json.loads(dest.read_text())["innawood"]
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
def test_emit_both(tmp_path):
    from builder.fetch import experimental
    from builder.load import load_all
    from builder.resolve import resolve_vanilla, resolve_innawood
    from builder.graph import build

    clone = None
    try:
        clone = experimental()
        data = load_all(clone)
        vanilla_g = build(resolve_vanilla(data))
        innawood_g = build(resolve_innawood(data))
        dest = tmp_path / "graph.json"
        emit(vanilla=(vanilla_g, clone), innawood=(innawood_g, clone), dest=dest)

        raw = dest.read_text(encoding="utf-8")
        parsed = json.loads(raw)

        assert "vanilla" in parsed
        assert "innawood" in parsed
        assert parsed["meta"]["cdda_commit"] is not None

        for key in ("vanilla", "innawood"):
            ds = parsed[key]
            assert len(ds["nodes"]) > 5000
            assert len(ds["edges"]) > 20000

        size_mb = len(raw.encode()) / (1024 * 1024)
        print(f"\ngraph.json size: {size_mb:.1f} MB")
        for key in ("vanilla", "innawood"):
            ds = parsed[key]
            print(f"{key}: nodes={len(ds['nodes'])}, edges={len(ds['edges'])}")

    finally:
        if clone is not None:
            shutil.rmtree(clone.path, ignore_errors=True)
