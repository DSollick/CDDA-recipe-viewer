"""Tests for resolve.py — unit tests for merge logic, integration smoke test."""

import shutil

import pytest

from builder.resolve import (
    CyclicDependencyError,
    _apply_delete,
    _apply_extend,
    _apply_proportional,
    _apply_relative,
    _merge,
    _topo_sort,
    resolve,
)


# ---------------------------------------------------------------------------
# Unit tests — merge operators
# ---------------------------------------------------------------------------

def test_merge_plain_override():
    parent = {"id": "base", "weight": "100 g", "flags": ["A"]}
    child = {"id": "child", "copy-from": "base", "weight": "200 g"}
    result = _merge(parent, child)
    assert result["weight"] == "200 g"
    assert result["flags"] == ["A"]         # inherited
    assert "copy-from" not in result


def test_merge_extend():
    parent = {"flags": ["A", "B"]}
    child = {"copy-from": "x", "extend": {"flags": ["C"]}}
    result = _merge(parent, child)
    assert result["flags"] == ["A", "B", "C"]


def test_merge_extend_creates_list_when_absent():
    parent = {}
    child = {"copy-from": "x", "extend": {"flags": ["NEW"]}}
    result = _merge(parent, child)
    assert result["flags"] == ["NEW"]


def test_merge_delete():
    parent = {"flags": ["A", "B", "C"]}
    child = {"copy-from": "x", "delete": {"flags": ["B"]}}
    result = _merge(parent, child)
    assert result["flags"] == ["A", "C"]


def test_merge_delete_missing_value_is_noop():
    parent = {"flags": ["A"]}
    child = {"copy-from": "x", "delete": {"flags": ["Z"]}}
    result = _merge(parent, child)
    assert result["flags"] == ["A"]


def test_merge_proportional_numeric():
    parent = {"volume": 100}
    child = {"copy-from": "x", "proportional": {"volume": 1.5}}
    result = _merge(parent, child)
    assert result["volume"] == 150.0


def test_merge_proportional_string_passthrough():
    # String-encoded measurements must not be touched
    parent = {"weight": "500 g"}
    child = {"copy-from": "x", "proportional": {"weight": 2.0}}
    result = _merge(parent, child)
    assert result["weight"] == "500 g"


def test_merge_relative_numeric():
    parent = {"fun": 0}
    child = {"copy-from": "x", "relative": {"fun": -2}}
    result = _merge(parent, child)
    assert result["fun"] == -2


def test_merge_strips_special_keys():
    parent = {"id": "p", "val": 1}
    child = {"id": "c", "copy-from": "p", "id_suffix": "variant",
             "extend": {}, "delete": {}, "proportional": {}, "relative": {}}
    result = _merge(parent, child)
    for k in ("copy-from", "id_suffix", "extend", "delete", "proportional", "relative"):
        assert k not in result


def test_merge_deep_chain():
    grandparent = {"id": "gp", "color": "red", "weight": 10, "flags": ["BASE"]}
    parent_resolved = _merge(grandparent, {"id": "p", "copy-from": "gp", "color": "blue", "extend": {"flags": ["MID"]}})
    child = {"id": "c", "copy-from": "p", "extend": {"flags": ["LEAF"]}, "weight": 99}
    result = _merge(parent_resolved, child)
    assert result["color"] == "blue"
    assert result["weight"] == 99
    assert result["flags"] == ["BASE", "MID", "LEAF"]


# ---------------------------------------------------------------------------
# Unit tests — topo sort
# ---------------------------------------------------------------------------

def test_topo_sort_simple_chain():
    objects = {
        "child": {"copy-from": "parent"},
        "parent": {},
    }
    order = _topo_sort(objects, "test")
    assert order.index("parent") < order.index("child")


def test_topo_sort_external_ref_is_ok():
    # copy-from target not in dict — treated as satisfied root
    objects = {
        "item": {"copy-from": "external_abstract"},
    }
    order = _topo_sort(objects, "test")
    assert order == ["item"]


def test_topo_sort_cycle_raises():
    objects = {
        "a": {"copy-from": "b"},
        "b": {"copy-from": "a"},
    }
    with pytest.raises(CyclicDependencyError):
        _topo_sort(objects, "test")


def test_topo_sort_no_copy_from():
    objects = {"a": {}, "b": {}, "c": {}}
    order = _topo_sort(objects, "test")
    assert set(order) == {"a", "b", "c"}


# ---------------------------------------------------------------------------
# Integration smoke test
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_resolve_experimental():
    from builder.fetch import experimental
    from builder.load import load_all

    clone = None
    try:
        clone = experimental()
        data = load_all(clone)
        resolved = resolve(data)

        # No abstract items in concrete items dict
        assert all("abstract" not in v for v in resolved.items.values()), \
            "Abstract items leaked into resolved.items"

        # No copy-from remaining in any resolved object
        for bucket_name, bucket in [
            ("items", resolved.items),
            ("recipes", resolved.recipes),
            ("constructions", resolved.constructions),
        ]:
            leaking = [k for k, v in bucket.items() if "copy-from" in v]
            assert not leaking, \
                f"{bucket_name}: {len(leaking)} objects still have copy-from: {leaking[:5]}"

        # Counts should be >= loaded counts (abstracts are separated, not dropped)
        assert len(resolved.items) + len(resolved.abstracts) >= len(data.items)
        assert len(resolved.recipes) >= len(data.recipes)

        # Uncrafts now properly loaded (previously all skipped)
        assert len(resolved.uncrafts) > 50, \
            f"Expected >50 uncrafts, got {len(resolved.uncrafts)}"

        print("\n--- CDDA Resolve Summary ---")
        print(f"Resolved items (concrete): {len(resolved.items)}")
        print(f"Resolved items (abstract): {len(resolved.abstracts)}")
        print(f"Resolved recipes:          {len(resolved.recipes)}")
        print(f"Resolved uncrafts:         {len(resolved.uncrafts)}")
        print(f"Resolved constructions:    {len(resolved.constructions)}")
        print(f"Resolved requirements:     {len(resolved.requirements)}")
        print(f"Unresolved (missing parent): {resolved.unresolved_count}")
        print("--- End Summary ---")

    finally:
        if clone is not None:
            shutil.rmtree(clone.path, ignore_errors=True)
