"""JSON loading and schema validation for CDDA source data."""

from __future__ import annotations

import dataclasses
import json
import logging
import random
from pathlib import Path
from typing import TYPE_CHECKING, Iterator

import jsonschema
import jsonschema.validators

if TYPE_CHECKING:
    from builder.fetch import CloneResult

log = logging.getLogger(__name__)

# CDDA unified all item categories into a single "ITEM" type (circa 0.G+).
# The old per-category types (AMMO, ARMOR, etc.) no longer appear in live data.
ITEM_TYPES: frozenset[str] = frozenset({"ITEM"})

BLACKLIST_TYPES: frozenset[str] = frozenset({
    "ITEM_BLACKLIST", "RECIPE_BLACKLIST",
    "ITEM_GROUP_BLACKLIST", "SKILL_BLACKLIST",
})

_TYPE_TO_BUCKET: dict[str, str] = {
    **{t: "items" for t in ITEM_TYPES},
    "recipe": "recipes",
    "uncraft": "uncrafts",
    "construction": "constructions",
    "practice": "practice",
    "requirement": "requirements",
    "tool_quality": "tool_qualities",
    "item_group": "item_groups",
    "harvest": "harvests",
    "MONSTER": "monsters",
    **{t: "blacklists" for t in BLACKLIST_TYPES},
}


class SchemaValidationError(Exception):
    """Raised when a sampled CDDA object fails schema validation."""


@dataclasses.dataclass
class LoadedData:
    items: dict[str, dict]
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
    vanilla_file_count: int
    innawood_file_count: int
    parse_error_count: int


def load_all(clone: "CloneResult | str") -> LoadedData:
    """
    Entry point. Accepts a CloneResult or a plain path string.
    Walks vanilla and innawood directories, classifies all objects,
    validates against schemas, and returns LoadedData.
    """
    base_path = Path(clone.path if hasattr(clone, "path") else clone)
    vanilla_root = base_path / "data" / "json"
    innawood_root = base_path / "data" / "mods" / "innawood"

    buckets: dict[str, dict] = {
        "items": {},
        "recipes": {},
        "uncrafts": {},
        "constructions": {},
        "practice": {},
        "requirements": {},
        "tool_qualities": {},
        "item_groups": {},
        "harvests": {},
        "monsters": {},
    }
    blacklists: list[dict] = []
    innawood_additions: dict[str, list[dict]] = {}
    parse_error_count = 0
    vanilla_file_count = 0
    innawood_file_count = 0

    for path in _iter_json_files(vanilla_root):
        objects = _parse_file(path)
        if objects is None:
            parse_error_count += 1
            continue
        vanilla_file_count += 1
        for obj in objects:
            _dispatch(obj, buckets, blacklists)

    for path in _iter_json_files(innawood_root):
        objects = _parse_file(path)
        if objects is None:
            parse_error_count += 1
            continue
        innawood_file_count += 1
        for obj in objects:
            # Innawood objects go into innawood_additions only.
            # resolve.py applies them as a second pass on top of resolved vanilla
            # so that same-id copy-from patterns (Innawood patching a vanilla entity
            # with the same id) don't create self-referential cycles.
            obj_type = obj.get("type")
            if obj_type:
                innawood_additions.setdefault(obj_type, []).append(obj)
            # Blacklists are the only thing we dispatch directly — they don't use
            # copy-from and are needed regardless of resolution order.
            if obj_type in BLACKLIST_TYPES:
                blacklists.append(obj)

    schemas = _load_schemas()
    _validate_sample(list(buckets["recipes"].values()), schemas.get("recipe"), "recipe")
    _validate_sample(list(buckets["items"].values()), schemas.get("item"), "item")
    _validate_sample(list(buckets["constructions"].values()), schemas.get("construction"), "construction")
    _validate_sample(list(buckets["requirements"].values()), schemas.get("requirement"), "requirement")

    return LoadedData(
        items=buckets["items"],
        recipes=buckets["recipes"],
        uncrafts=buckets["uncrafts"],
        constructions=buckets["constructions"],
        practice=buckets["practice"],
        requirements=buckets["requirements"],
        tool_qualities=buckets["tool_qualities"],
        item_groups=buckets["item_groups"],
        harvests=buckets["harvests"],
        monsters=buckets["monsters"],
        blacklists=blacklists,
        innawood_additions=innawood_additions,
        vanilla_file_count=vanilla_file_count,
        innawood_file_count=innawood_file_count,
        parse_error_count=parse_error_count,
    )


def _dispatch(obj: dict, buckets: dict[str, dict], blacklists: list[dict]) -> None:
    obj_type = obj.get("type")
    if not obj_type:
        return
    bucket_name = _TYPE_TO_BUCKET.get(obj_type)
    if bucket_name is None:
        return
    if bucket_name == "blacklists":
        blacklists.append(obj)
        return
    if bucket_name in ("recipes", "uncrafts"):
        key = _recipe_key(obj, buckets[bucket_name])
    else:
        key = _entity_id(obj, bucket_name)
        if key is None:
            log.warning("Skipping %s object with no id: %s", obj_type, str(obj)[:120])
            return
    # Last-writer-wins for items (mirrors CDDA mod override semantics)
    buckets[bucket_name][key] = obj


def _iter_json_files(root: Path) -> Iterator[Path]:
    if not root.exists():
        log.warning("Directory does not exist, skipping: %s", root)
        return
    yield from root.rglob("*.json")


def _parse_file(path: Path) -> list[dict] | None:
    try:
        with path.open(encoding="utf-8") as f:
            raw = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to parse %s: %s", path, e)
        return None

    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        result = []
        for item in raw:
            if isinstance(item, dict):
                result.append(item)
            elif isinstance(item, list):
                # One level of nesting only — flatten but warn
                log.warning("Nested array in %s — flattening one level", path)
                for sub in item:
                    if isinstance(sub, dict):
                        result.append(sub)
        return result
    log.warning("Unexpected JSON root type %s in %s", type(raw).__name__, path)
    return None


def _entity_id(obj: dict, type_category: str) -> str | None:
    if type_category == "items":
        return obj.get("id") or obj.get("abstract")
    return obj.get("id")


def _recipe_key(obj: dict, existing: dict) -> str:
    # CDDA composite recipe ID: result + "_" + id_suffix (if present).
    # Recipes copy-from each other using this composite key, so we must
    # store them under it — e.g. result="threshed_wheat" + id_suffix="flail"
    # → key "threshed_wheat_flail", which is what copy-from references.
    result = obj.get("result")
    id_suffix = obj.get("id_suffix")
    if result:
        base = f"{result}_{id_suffix}" if id_suffix else result
    else:
        base = obj.get("abstract") or "unknown"
    if base not in existing:
        return base
    n = 2
    while f"{base}#{n}" in existing:
        n += 1
    return f"{base}#{n}"


def _load_schemas() -> dict[str, jsonschema.protocols.Validator]:
    schema_dir = Path(__file__).parent / "schema"
    validators: dict[str, jsonschema.protocols.Validator] = {}
    if not schema_dir.exists():
        log.warning("Schema directory not found: %s — skipping validation", schema_dir)
        return validators
    for schema_file in schema_dir.glob("*.schema.json"):
        name = schema_file.stem.replace(".schema", "")
        with schema_file.open(encoding="utf-8") as f:
            schema = json.load(f)
        cls = jsonschema.validators.validator_for(schema)
        cls.check_schema(schema)
        validators[name] = cls(schema)
    return validators


def _validate_sample(
    objects: list[dict],
    validator: jsonschema.protocols.Validator | None,
    type_name: str,
    sample_size: int = 20,
) -> None:
    if not validator or not objects:
        return
    sample = random.sample(objects, min(sample_size, len(objects)))
    for obj in sample:
        try:
            validator.validate(obj)
        except jsonschema.ValidationError as e:
            obj_id = obj.get("id") or obj.get("result") or obj.get("abstract") or "<no id>"
            raise SchemaValidationError(
                f"Schema validation failed for CDDA type '{type_name}': {e.message}\n"
                f"  Object ID: {obj_id}\n"
                f"  Failing path: {list(e.absolute_path)}"
            ) from e
