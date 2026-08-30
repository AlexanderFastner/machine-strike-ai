#!/usr/bin/env python3
"""Generate the board library.

Boards are 180° rotationally symmetric so neither side has an advantage
(docs/rules.md 2.1): tile(r, c) == tile(7-r, 7-c). Only the top half is
authored here; the bottom half is derived, which makes the symmetry a
property of the generator rather than something to get right by hand.

Legend: C chasm · W marsh · G grassland · F forest · H hill · M mountain
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "packages/data/boards"

# Author rows 0-3; rows 4-7 are the reverse of rows 3-0.
BOARDS = [
    {
        "id": "plains-and-forests",
        "name": "Plains and Forests",
        "description": "Open ground broken by stands of forest. Gentle: a little cover, "
                       "nowhere to hide, and no terrain that stops a machine.",
        "top": ["GGGGGGGG",
                "GGFFGGGG",
                "GFFGGFGG",
                "GGGFFGGG"],
    },
    {
        "id": "mountains",
        "name": "Mountains",
        "description": "A high ridge across the middle. Whoever holds the peaks attacks at "
                       "+3 and defends at +3 — this board is decided by who climbs first.",
        "top": ["GGGGGGGG",
                "GGGHGGGG",
                "GGHMMHGG",
                "GHMHHMHG"],
    },
    {
        "id": "chasms",
        "name": "Chasms",
        "description": "Torn ground. Only Swoop machines can cross a chasm, so everything "
                       "else must go the long way round — and shoving a piece in is free.",
        "top": ["GGGGGGGG",
                "GGGGGGGG",
                "GGCCGGGG",
                "GCCGGCGG"],
    },
    {
        "id": "split-peaks",
        "name": "Split Peaks",
        "description": "Two peaks either side of a marsh channel. The high ground is "
                       "valuable and the crossing is slow: entering marsh ends your move.",
        "top": ["GGGGGGGG",
                "GHMHGGGG",
                "GGHGGGGG",
                "GGWWWWGG"],
    },
    {
        "id": "coastal",
        "name": "Coastal",
        "description": "Marsh sweeps in from opposite corners. Pull machines are at home "
                       "here — they wade through unhindered and fight at +1.",
        "top": ["WGGGGGGG",
                "WWGGGGGG",
                "WGGGFGGG",
                "GGGFGGGG"],
    },
]

LEGEND = {"C": "chasm", "W": "marsh", "G": "grassland", "F": "forest", "H": "hill", "M": "mountain"}

def mirror(top):
    """rows 4-7 are the reverse of rows 3-0, which yields 180° rotation."""
    return top + [row[::-1] for row in reversed(top)]

def check(rows, board_id):
    assert len(rows) == 8, f"{board_id}: {len(rows)} rows"
    for r, row in enumerate(rows):
        assert len(row) == 8, f"{board_id}: row {r} is {len(row)} wide"
        for ch in row:
            assert ch in LEGEND, f"{board_id}: unknown code {ch!r}"
    for r in range(8):
        for c in range(8):
            assert rows[r][c] == rows[7 - r][7 - c], f"{board_id}: not symmetric at {r},{c}"
    # Deployment rows must be enterable by every machine, not just flyers.
    for r in (0, 1, 6, 7):
        assert "C" not in rows[r], f"{board_id}: chasm in deployment row {r}"

for b in BOARDS:
    rows = mirror(b["top"])
    check(rows, b["id"])
    (OUT / f'{b["id"]}.json').write_text(json.dumps({
        "id": b["id"], "name": b["name"], "description": b["description"],
        "legend": LEGEND, "rows": rows,
    }, indent=2))
    counts = {}
    for row in rows:
        for ch in row:
            counts[LEGEND[ch]] = counts.get(LEGEND[ch], 0) + 1
    print(f'{b["name"]:22} ' + "  ".join(f"{k} {v}" for k, v in sorted(counts.items())))

print(f"\n{len(BOARDS)} boards written, all 180° symmetric")
