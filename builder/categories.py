"""
Item category classification for modern CDDA items.

CDDA unified all item sub-types under a single "ITEM" type circa 0.G.
Classification is based on field-presence heuristics: comestible_type,
gun_type, ammo_type, bionic_id, book_skill, armor_portions, etc.
"""
from __future__ import annotations

# Explicit "category" field values → our category key (many items omit this).
_CDDA_CAT_FIELD_MAP: dict[str, str] = {
    "guns": "weapons", "weapons": "weapons", "bows": "weapons",
    "knives": "weapons", "other_weapons": "weapons", "melee": "weapons",
    "ammo": "ammo", "mags": "ammo", "magazines": "ammo",
    "clothing": "armor", "armor_add": "armor", "other_armor": "armor",
    "armor": "armor",
    "tools": "tools", "tool_armor": "tools", "other_tools": "tools",
    "food": "food", "beverage": "food", "food_instant": "food",
    "drugs": "medicine", "medicine": "medicine", "meds": "medicine",
    "books": "books", "books_other": "books",
    "bionics": "bionics", "bionics_op": "bionics", "cbms": "bionics",
    "veh_parts": "vehicle_parts", "vehicle_other": "vehicle_parts",
    "raw_material": "materials", "other": "materials",
    "electronics": "materials", "storage": "materials",
    "spare_parts": "materials",
}

_COMESTIBLE_SUBTYPE_MAP: dict[str, str] = {
    "FOOD": "food", "DRINK": "food",
    "MED": "medicine", "DRUG": "medicine",
}

CATEGORY_ORDER: list[str] = [
    "weapons", "ammo", "armor", "tools",
    "food", "medicine", "books", "materials",
    "bionics", "vehicle_parts",
]

CATEGORY_LABELS: dict[str, str] = {
    "weapons":      "Weapons",
    "ammo":         "Ammo",
    "armor":        "Armor",
    "tools":        "Tools",
    "food":         "Food",
    "medicine":     "Medicine",
    "books":        "Books",
    "materials":    "Materials",
    "bionics":      "Bionics",
    "vehicle_parts":"Vehicle Parts",
}


def classify_item(item: dict) -> str | None:
    """
    Return a category key for a CDDA item dict, or None for non-items.

    Detection order (first match wins):
      1. No id field        → not a concrete item, skip
      2. comestible_type    → food / medicine
      3. gun_type           → weapons  (guns have gun_type; ammo does not)
      4. ammo_type          → ammo     (checked after gun_type to avoid misclassifying guns)
      5. bionic_id          → bionics
      6. book_skill         → books
      7. armor_portions / covers → armor
      8. Explicit category field
      9. qualities          → tools
      10. to_hit / high damage → weapons
      11. default           → materials
    """
    if not item.get("id"):
        return None

    # 2. Food / medicine
    comestible_type = item.get("comestible_type")
    if comestible_type:
        return _COMESTIBLE_SUBTYPE_MAP.get(str(comestible_type).upper(), "food")

    # 3. Guns (gun_type is only set on actual firearms, not ammo)
    if item.get("gun_type") or item.get("ranged_damage"):
        return "weapons"

    # 4. Ammo (ammo_type without gun_type = actual ammunition or magazines)
    if item.get("ammo_type"):
        return "ammo"

    # 5. Bionics
    if item.get("bionic_id"):
        return "bionics"

    # 6. Books
    if item.get("book_skill"):
        return "books"

    # 7. Armor
    if item.get("armor_portions") or item.get("covers"):
        return "armor"

    # 8. Explicit category field (many items lack this; it's a hint not a guarantee)
    cat_field = item.get("category")
    if cat_field:
        mapped = _CDDA_CAT_FIELD_MAP.get(str(cat_field).lower())
        if mapped:
            return mapped

    # 9. Tools with specific tool qualities (excludes incidental qualities on weapons)
    tool_quality_ids = {q["id"] if isinstance(q, dict) else q[0]
                        for q in item.get("qualities", [])}
    TOOL_QUALITIES = {"HAMMER", "SAW_W", "SAW_M", "DRILL", "SCREW", "WRENCH",
                      "CHISEL", "PUNCH", "BIND", "SEW", "TAN", "COOK", "BOIL",
                      "CHEM", "DISTILL", "PRESS", "PULP", "SMOKABLE", "ANVIL",
                      "WELD", "SMELT", "FORGE", "GRIND", "REPAIR", "LEATHER_CUT"}
    if tool_quality_ids & TOOL_QUALITIES:
        return "tools"

    # 10. Melee weapons: meaningful damage or explicit to_hit
    bashing = item.get("bashing") or 0
    cutting = item.get("cutting") or 0
    to_hit = item.get("to_hit")
    if to_hit is not None or bashing > 6 or cutting > 6:
        return "weapons"

    # 11. Default: raw materials, containers, generic items
    return "materials"
