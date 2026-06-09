"""
Item category classification derived from CDDA item type fields.
"""
from __future__ import annotations

CDDA_TYPE_TO_CATEGORY: dict[str, str] = {
    "GUN":        "weapons",
    "MELEE":      "weapons",
    "GUNMOD":     "weapons",
    "AMMO":       "ammo",
    "MAGAZINE":   "ammo",
    "ARMOR":      "armor",
    "PET_ARMOR":  "armor",
    "TOOL":       "tools",
    "TOOL_ARMOR": "tools",
    "TOOLMOD":    "tools",
    "BOOK":       "books",
    "CONTAINER":  "materials",
    "GENERIC":    "materials",
    "BIONIC_ITEM":"bionics",
    "WHEEL":      "vehicle_parts",
    "ENGINE":     "vehicle_parts",
}

_COMESTIBLE_SUBTYPE_MAP: dict[str, str] = {
    "FOOD":  "food",
    "DRINK": "food",
    "MED":   "medicine",
    "DRUG":  "medicine",
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
    """Return category key for a CDDA item dict, or None if uncategorizable."""
    cdda_type = item.get("type", "")
    if cdda_type == "COMESTIBLE":
        sub = (item.get("comestible_type") or "FOOD").upper()
        return _COMESTIBLE_SUBTYPE_MAP.get(sub, "food")
    return CDDA_TYPE_TO_CATEGORY.get(cdda_type)
