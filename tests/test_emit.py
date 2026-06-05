"""Tests for emit.py — graph serialization."""

import json
import shutil
from pathlib import Path

import pytest

from builder.emit import emit, content_hash


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fake_clone_result(build_type="experimental", tag=None, sha="a" * 40, date="2024-01-01T00:00:00+00:00"):
    from builder.fetch import CloneResult
    return CloneResult(path="/tmp/fake", build_type=build_type, tag=tag, commit_sha=sha, commit_date=date)


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
    emit(experimental=(g, meta), dest=tmp_path / "graph.json")
    assert (tmp_path / "graph.json").exists()


def test_emit_dest_is_directory(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    emit(experimental=(g, meta), dest=tmp_path)
    assert (tmp_path / "graph.json").exists()


def test_emit_creates_parent_dirs(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "output" / "subdir" / "graph.json"
    emit(experimental=(g, meta), dest=dest)
    assert dest.exists()


def test_emit_valid_json(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "graph.json"
    emit(experimental=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    assert isinstance(data, dict)


def test_emit_meta_fields_present(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result(sha="b" * 40, date="2024-06-01T12:00:00+00:00")
    dest = tmp_path / "graph.json"
    emit(experimental=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    m = data["meta"]
    assert "generated_at" in m
    assert "builder_version" in m
    assert m["cdda_experimental_commit"] == "b" * 7
    assert m["cdda_experimental_date"] == "2024-06-01T12:00:00+00:00"
    assert m["cdda_stable_tag"] is None
    assert m["cdda_stable_commit"] is None


def test_emit_stable_meta(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result(build_type="stable", tag="0.H", sha="c" * 40)
    dest = tmp_path / "graph.json"
    emit(stable=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    assert data["meta"]["cdda_stable_tag"] == "0.H"
    assert data["meta"]["cdda_stable_commit"] == "c" * 7
    assert "stable" in data
    assert "experimental" not in data


def test_emit_experimental_dataset_structure(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "graph.json"
    emit(experimental=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    ds = data["experimental"]
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
    emit(experimental=(g, meta), dest=dest)
    data = json.loads(dest.read_text())
    nodes = data["experimental"]["nodes"]
    assert "wooden_stake" in nodes
    assert "stick" in nodes


def test_emit_node_has_expected_fields(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "graph.json"
    emit(experimental=(g, meta), dest=dest)
    node = json.loads(dest.read_text())["experimental"]["nodes"]["wooden_stake"]
    assert node["type"] == "item"
    assert "display_name" in node
    assert "learn_method" in node


def test_emit_edges_use_from_to_keys(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "graph.json"
    emit(experimental=(g, meta), dest=dest)
    edges = json.loads(dest.read_text())["experimental"]["edges"]
    for e in edges:
        assert "from" in e
        assert "to" in e
        assert "from_node" not in e
        assert "to_node" not in e


def test_emit_both_datasets(tmp_path):
    g = _minimal_graph()
    stable_meta = _fake_clone_result(build_type="stable", tag="0.H", sha="s" * 40)
    exp_meta = _fake_clone_result(build_type="experimental", sha="e" * 40)
    dest = tmp_path / "graph.json"
    emit(stable=(g, stable_meta), experimental=(g, exp_meta), dest=dest)
    data = json.loads(dest.read_text())
    assert "stable" in data
    assert "experimental" in data
    assert data["meta"]["cdda_stable_tag"] == "0.H"
    assert data["meta"]["cdda_experimental_commit"] == "e" * 7


def test_emit_eras_and_bottlenecks_empty(tmp_path):
    g = _minimal_graph()
    meta = _fake_clone_result()
    dest = tmp_path / "graph.json"
    emit(experimental=(g, meta), dest=dest)
    ds = json.loads(dest.read_text())["experimental"]
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
def test_emit_experimental(tmp_path):
    from builder.fetch import experimental
    from builder.load import load_all
    from builder.resolve import resolve
    from builder.graph import build

    clone = None
    try:
        clone = experimental()
        data = load_all(clone)
        resolved = resolve(data)
        g = build(resolved)
        dest = tmp_path / "graph.json"
        from builder.fetch import CloneResult
        emit(experimental=(g, clone), dest=dest)

        raw = dest.read_text(encoding="utf-8")
        parsed = json.loads(raw)

        ds = parsed["experimental"]
        assert len(ds["nodes"]) > 5000
        assert len(ds["edges"]) > 20000
        assert parsed["meta"]["cdda_experimental_commit"] is not None

        size_mb = len(raw.encode()) / (1024 * 1024)
        print(f"\ngraph.json size: {size_mb:.1f} MB")
        print(f"nodes: {len(ds['nodes'])}, edges: {len(ds['edges'])}")

    finally:
        if clone is not None:
            shutil.rmtree(clone.path, ignore_errors=True)
