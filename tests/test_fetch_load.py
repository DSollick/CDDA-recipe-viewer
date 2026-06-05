"""Integration smoke test: sparse-clone CDDA master, parse all JSON, assert counts."""

import shutil

import pytest

from builder.fetch import experimental
from builder.load import load_all


@pytest.mark.integration
def test_fetch_and_load_experimental():
    clone = None
    try:
        clone = experimental()

        assert clone.build_type == "experimental"
        assert clone.tag is None
        assert len(clone.commit_sha) == 40, f"Unexpected SHA length: {clone.commit_sha!r}"

        data = load_all(clone)

        assert len(data.recipes) > 1000, f"Expected >1000 recipes, got {len(data.recipes)}"
        assert len(data.items) > 500, f"Expected >500 items, got {len(data.items)}"
        assert len(data.item_groups) > 100, f"Expected >100 item groups, got {len(data.item_groups)}"

        print("\n--- CDDA Load Summary ---")
        print(f"Build:            {clone.build_type}")
        print(f"Commit SHA:       {clone.commit_sha[:12]}")
        print(f"Commit date:      {clone.commit_date}")
        print(f"Items:            {len(data.items)}")
        print(f"Recipes:          {len(data.recipes)}")
        print(f"Constructions:    {len(data.constructions)}")
        print(f"Practice:         {len(data.practice)}")
        print(f"Requirements:     {len(data.requirements)}")
        print(f"Tool qualities:   {len(data.tool_qualities)}")
        print(f"Item groups:      {len(data.item_groups)}")
        print(f"Blacklists:       {len(data.blacklists)}")
        print(f"Innawood types:   {sorted(data.innawood_additions.keys())}")
        print(f"Vanilla files:    {data.vanilla_file_count}")
        print(f"Innawood files:   {data.innawood_file_count}")
        print(f"Parse errors:     {data.parse_error_count}")
        print("--- End Summary ---")

    finally:
        if clone is not None:
            shutil.rmtree(clone.path, ignore_errors=True)
