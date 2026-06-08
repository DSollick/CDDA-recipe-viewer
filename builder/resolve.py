"""
Mod layer resolution: resolve copy-from inheritance chains then apply the Innawood
mod layer on top of vanilla CDDA data.

Two-phase approach:
  Phase 1 — Vanilla resolution
    Resolve all copy-from chains within each vanilla bucket using a topological sort
    (Kahn's algorithm). Each object ends up fully self-contained with no copy-from.

  Phase 2 — Innawood layer application
    load.py keeps Innawood objects in data.innawood_additions rather than merging them
    into the vanilla buckets, avoiding self-referential copy-from cycles (a common
    CDDA pattern where a mod patches a vanilla entity using copy-from: <same_id>).
    The three cases handled:
      a) copy-from == own id  → merge patch onto resolved vanilla base for that id
      b) copy-from != own id  → merge from the named parent in the resolved bucket
      c) no copy-from         → full replace/add (Innawood entity wins outright)

Merge semantics (matching CDDA's own rules):
  - Normal field    : child value replaces parent value
  - extend          : child values appended to parent list
  - delete          : specified values removed from parent list
  - proportional    : parent numeric value * child factor  (string-encoded
                      measurements like "500 ml" are left untouched — they are
                      not needed for graph construction)
  - relative        : parent numeric value + child delta
  - copy-from,
    id_suffix,
    delete, extend,
    proportional,
    relative        : consumed during merge, stripped from the resolved object
"""

from __future__ import annotations

import collections
import copy
import dataclasses
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from builder.load import LoadedData

log = logging.getLogger(__name__)

_MERGE_SPECIAL = frozenset({
    "copy-from", "id_suffix",
    "delete", "extend", "proportional", "relative",
})


class CyclicDependencyError(Exception):
    pass


@dataclasses.dataclass
class ResolvedData:
    items: dict[str, dict]           # concrete (non-abstract) resolved items
    abstracts: dict[str, dict]       # abstract prototypes — not graph nodes
    recipes: dict[str, dict]
    uncrafts: dict[str, dict]
    constructions: dict[str, dict]
    practice: dict[str, dict]
    requirements: dict[str, dict]
    tool_qualities: dict[str, dict]
    item_groups: dict[str, dict]
    harvests: dict[str, dict]
    monsters: dict[str, dict]
    blacklists: list[dict]
    innawood_additions: dict[str, list[dict]]
    unresolved_count: int            # copy-from targets that could not be found


def resolve(data: "LoadedData") -> ResolvedData:
    """
    Phase 1: resolve vanilla copy-from chains.
    Phase 2: apply Innawood mod layer on top of resolved vanilla.
    """
    inn = data.innawood_additions

    # --- Phase 1: vanilla resolution ---
    items_res,   items_unres  = _resolve_bucket(data.items,          "items")
    recipes_res, rcp_unres    = _resolve_bucket(data.recipes,        "recipes")
    uncraft_res, unc_unres    = _resolve_bucket(data.uncrafts,       "uncrafts")
    constr_res,  con_unres    = _resolve_bucket(data.constructions,   "constructions")
    prac_res,    prac_unres   = _resolve_bucket(data.practice,        "practice")
    req_res,     req_unres    = _resolve_bucket(data.requirements,    "requirements")
    tq_res,      tq_unres     = _resolve_bucket(data.tool_qualities,  "tool_qualities")
    ig_res,      ig_unres     = _resolve_bucket(data.item_groups,     "item_groups")
    harv_res,    harv_unres   = _resolve_bucket(data.harvests,        "harvests")
    mon_res,     mon_unres    = _resolve_bucket(data.monsters,        "monsters")

    # --- Phase 2: Innawood layer ---
    items_res,   inn_items_u  = _apply_mod_layer(items_res,   inn.get("ITEM", []),         "items",         _item_key)
    recipes_res, inn_rcp_u    = _apply_mod_layer(recipes_res, inn.get("recipe", []),       "recipes",       _recipe_result_key)
    uncraft_res, inn_unc_u    = _apply_mod_layer(uncraft_res, inn.get("uncraft", []),      "uncrafts",      _recipe_result_key)
    constr_res,  inn_con_u    = _apply_mod_layer(constr_res,  inn.get("construction", []), "constructions", _id_key)
    prac_res,    inn_prac_u   = _apply_mod_layer(prac_res,    inn.get("practice", []),     "practice",      _recipe_result_key)
    req_res,     inn_req_u    = _apply_mod_layer(req_res,     inn.get("requirement", []),  "requirements",  _id_key)
    tq_res,      inn_tq_u     = _apply_mod_layer(tq_res,      inn.get("tool_quality", []), "tool_qualities", _id_key)
    ig_res,      inn_ig_u     = _apply_mod_layer(ig_res,      inn.get("item_group", []),   "item_groups",   _id_key)
    harv_res,    inn_harv_u   = _apply_mod_layer(harv_res,    inn.get("harvest", []),      "harvests",      _id_key)
    mon_res,     inn_mon_u    = _apply_mod_layer(mon_res,     inn.get("MONSTER", []),      "monsters",      _id_key)

    total_unresolved = (items_unres + rcp_unres + unc_unres + con_unres + prac_unres +
                        req_unres + tq_unres + ig_unres + harv_unres + mon_unres +
                        inn_items_u + inn_rcp_u + inn_unc_u + inn_con_u + inn_prac_u +
                        inn_req_u + inn_tq_u + inn_ig_u + inn_harv_u + inn_mon_u)

    abstracts = {k: v for k, v in items_res.items() if "abstract" in v}
    items_concrete = {k: v for k, v in items_res.items() if "abstract" not in v}

    return ResolvedData(
        items=items_concrete,
        abstracts=abstracts,
        recipes=recipes_res,
        uncrafts=uncraft_res,
        constructions=constr_res,
        practice=prac_res,
        requirements=req_res,
        tool_qualities=tq_res,
        item_groups=ig_res,
        harvests=harv_res,
        monsters=mon_res,
        blacklists=data.blacklists,
        innawood_additions=data.innawood_additions,
        unresolved_count=total_unresolved,
    )


# ---------------------------------------------------------------------------
# Bucket resolution
# ---------------------------------------------------------------------------

def _resolve_bucket(
    objects: dict[str, dict],
    label: str,
) -> tuple[dict[str, dict], int]:
    """
    Resolve all copy-from chains in one bucket.
    Returns (resolved_dict, unresolved_count).
    """
    if not objects:
        return {}, 0

    order = _topo_sort(objects, label)
    resolved: dict[str, dict] = {}
    unresolved_count = 0

    for key in order:
        obj = objects[key]
        parent_id = obj.get("copy-from")

        if parent_id is None:
            resolved[key] = _strip_special(copy.deepcopy(obj))
        elif parent_id in resolved:
            resolved[key] = _merge(resolved[parent_id], obj)
        else:
            # Parent not in this bucket (cross-bucket ref or missing entity).
            # Emit as-is with special fields stripped so downstream can still use
            # whatever fields are directly present.
            log.warning(
                "[%s] %r: copy-from target %r not found — fields from parent missing",
                label, key, parent_id,
            )
            resolved[key] = _strip_special(copy.deepcopy(obj))
            unresolved_count += 1

    return resolved, unresolved_count


# ---------------------------------------------------------------------------
# Topological sort (Kahn's algorithm — iterative, no recursion-depth risk)
# ---------------------------------------------------------------------------

def _topo_sort(objects: dict[str, dict], label: str) -> list[str]:
    """
    Return object keys in dependency order (parents before children).
    copy-from targets that are not in this dict are treated as satisfied
    (external or missing — handled in the resolution pass).
    Raises CyclicDependencyError if a cycle is found within the dict.
    """
    in_degree: dict[str, int] = {k: 0 for k in objects}
    dependents: dict[str, list[str]] = {k: [] for k in objects}

    for key, obj in objects.items():
        parent = obj.get("copy-from")
        if parent and parent in objects:
            in_degree[key] += 1
            dependents[parent].append(key)

    queue: collections.deque[str] = collections.deque(
        k for k, deg in in_degree.items() if deg == 0
    )
    result: list[str] = []

    while queue:
        key = queue.popleft()
        result.append(key)
        for dep in dependents[key]:
            in_degree[dep] -= 1
            if in_degree[dep] == 0:
                queue.append(dep)

    if len(result) < len(objects):
        cyclic = [k for k, deg in in_degree.items() if deg > 0]
        raise CyclicDependencyError(
            f"[{label}] {len(cyclic)} object(s) in copy-from cycle: "
            f"{cyclic[:5]!r}{'...' if len(cyclic) > 5 else ''}"
        )

    return result


# ---------------------------------------------------------------------------
# Merge logic
# ---------------------------------------------------------------------------

def _merge(parent: dict, child: dict) -> dict:
    """
    Apply a child patch onto a fully-resolved parent.
    Returns a new dict — neither parent nor child is mutated.
    """
    result = copy.deepcopy(parent)
    result.pop("copy-from", None)

    # Plain overrides first (skip all merge-control keys)
    for key, value in child.items():
        if key not in _MERGE_SPECIAL:
            result[key] = copy.deepcopy(value)

    _apply_extend(result, child.get("extend", {}))
    _apply_delete(result, child.get("delete", {}))
    _apply_proportional(result, child.get("proportional", {}))
    _apply_relative(result, child.get("relative", {}))

    return result


def _apply_extend(result: dict, extend: dict) -> None:
    for field, additions in extend.items():
        additions = additions if isinstance(additions, list) else [additions]
        if field in result and isinstance(result[field], list):
            result[field] = result[field] + additions
        else:
            result[field] = additions


def _apply_delete(result: dict, delete: dict) -> None:
    for field, removals in delete.items():
        removals = removals if isinstance(removals, list) else [removals]
        if field not in result or not isinstance(result[field], list):
            log.debug("delete: field %r is not a list in resolved parent", field)
            continue
        # Use equality comparison so both primitive and object values work
        result[field] = [v for v in result[field] if v not in removals]


def _apply_proportional(result: dict, proportional: dict) -> None:
    for field, factor in proportional.items():
        val = result.get(field)
        if isinstance(val, (int, float)):
            result[field] = val * factor
        # String-encoded measurements ("500 ml") are intentionally left as-is;
        # they are not needed for graph construction.


def _apply_relative(result: dict, relative: dict) -> None:
    for field, delta in relative.items():
        val = result.get(field)
        if isinstance(val, (int, float)):
            result[field] = val + delta


def _strip_special(obj: dict) -> dict:
    """Remove merge-control fields from a standalone (no copy-from) object."""
    for k in _MERGE_SPECIAL:
        obj.pop(k, None)
    return obj


# ---------------------------------------------------------------------------
# Innawood mod layer application
# ---------------------------------------------------------------------------

def _apply_mod_layer(
    resolved: dict[str, dict],
    mod_objects: list[dict],
    label: str,
    key_fn: "callable[[dict], str | None]",
    mod_name: str = "innawood",
) -> tuple[dict[str, dict], int]:
    """
    Overlay a list of mod objects onto an already-resolved vanilla bucket.

    Three cases:
      a) copy-from == own key  — patch onto resolved vanilla base for that key
      b) copy-from != own key  — merge from named parent in resolved
      c) no copy-from          — full replace/add (Innawood entity wins outright)
    """
    result = dict(resolved)
    unresolved_count = 0

    for obj in mod_objects:
        key = key_fn(obj)
        if key is None:
            continue

        # Tag the object with its mod source without mutating the original
        obj = {**obj, "_mod": mod_name}

        parent_id = obj.get("copy-from")

        if parent_id is None:
            # Case c: complete definition — replaces or adds with no inheritance
            result[key] = _strip_special(copy.deepcopy(obj))
        elif parent_id == key:
            # Case a: same-id patch — merge onto resolved vanilla base
            if key in resolved:
                result[key] = _merge(resolved[key], obj)
            else:
                log.warning(
                    "[%s] mod same-id patch %r: no vanilla base found — treating as standalone",
                    label, key,
                )
                result[key] = _strip_special(copy.deepcopy(obj))
                unresolved_count += 1
        else:
            # Case b: inherits from a different parent
            if parent_id in result:
                result[key] = _merge(result[parent_id], obj)
            else:
                log.warning(
                    "[%s] mod object %r: copy-from target %r not found",
                    label, key, parent_id,
                )
                result[key] = _strip_special(copy.deepcopy(obj))
                unresolved_count += 1

    return result, unresolved_count


# ---------------------------------------------------------------------------
# Key extractors for each bucket type
# ---------------------------------------------------------------------------

def _item_key(obj: dict) -> str | None:
    return obj.get("id") or obj.get("abstract")

def _id_key(obj: dict) -> str | None:
    return obj.get("id")

def _recipe_result_key(obj: dict) -> str | None:
    # Must match _recipe_key in load.py: result + "_" + id_suffix (if present),
    # or abstract for prototype recipes.
    result = obj.get("result")
    id_suffix = obj.get("id_suffix")
    if result:
        return f"{result}_{id_suffix}" if id_suffix else result
    return obj.get("abstract")
