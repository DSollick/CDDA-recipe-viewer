"""
Supported mod configurations for the build pipeline.

Each entry defines a single mod layer applied on top of vanilla CDDA data.
Multi-mod stacking (e.g. xedra_evolved_innawoods) is not supported here.
"""
from __future__ import annotations
import dataclasses


@dataclasses.dataclass(frozen=True)
class ModConfig:
    id: str        # stable identifier used in filenames and manifest
    label: str     # display name shown in the UI
    dir_name: str  # directory under data/mods/ (empty string = vanilla, no mod)


VANILLA = ModConfig(id="vanilla", label="Vanilla", dir_name="")

MODS: list[ModConfig] = [
    VANILLA,
    ModConfig(id="innawood",       label="Innawood",        dir_name="innawood"),
    ModConfig(id="magiclysm",      label="Magiclysm",       dir_name="Magiclysm"),
    ModConfig(id="aftershock",     label="Aftershock",      dir_name="aftershock_exoplanet"),
    ModConfig(id="xedra",          label="Xedra Evolved",   dir_name="Xedra_Evolved"),
    ModConfig(id="mindovermatter", label="Mind Over Matter", dir_name="MindOverMatter"),
]
