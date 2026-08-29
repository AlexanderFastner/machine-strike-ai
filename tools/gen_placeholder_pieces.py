#!/usr/bin/env python3
"""Generate geometric placeholder sprites for every machine, from packages/data/machines.json.

Convention (all sprites drawn FACING NORTH; the app rotates the whole sprite by the piece's facing):
  - mitred frame around the body: one edge per side, in the piece's own frame
        blue  = armored side   red = weak side   grey = neutral side
  - amber chevron above the body marks the front, so facing is readable even when F is neutral
  - centre glyph encodes the machine type (6 shapes)
Regenerate with: python3 tools/gen_placeholder_pieces.py
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/pieces/placeholder"
OUT.mkdir(parents=True, exist_ok=True)
data = json.loads((ROOT / "packages/data/machines.json").read_text())

ARMOR, WEAK, NEUTRAL = "#2f6fd0", "#d63d3d", "#49535e"
BODY, EDGE, GLYPH, FRONT = "#8a94a0", "#20262d", "#161b21", "#f2c14e"

# mitred frame polygons, one per side, in the piece's own frame (F = north)
FRAME = {
    "F": "6,8 26,8 23,11 9,11",
    "B": "6,28 26,28 23,25 9,25",
    "L": "6,8 6,28 9,25 9,11",
    "R": "26,8 26,28 23,25 23,11",
}

GLYPHS = {
    "Melee":  '<polygon points="16,14 21,19 16,24 11,19" fill="{g}"/>',
    "Gunner": '<circle cx="16" cy="19" r="5" fill="none" stroke="{g}" stroke-width="2"/>'
              '<circle cx="16" cy="19" r="1.4" fill="{g}"/>',
    "Ram":    '<polygon points="16,14 22,21 19,21 16,17.5 13,21 10,21" fill="{g}"/>',
    "Dash":   '<polygon points="16,13 21,18.5 18.6,18.5 16,15.8 13.4,18.5 11,18.5" fill="{g}"/>'
              '<polygon points="16,18.5 21,24 18.6,24 16,21.3 13.4,24 11,24" fill="{g}"/>',
    "Swoop":  '<polygon points="16,13 22.5,24 16,20.5 9.5,24" fill="{g}"/>',
    "Pull":   '<polygon points="16,24 10,17 13,17 16,20.5 19,17 22,17" fill="{g}"/>',
}

def svg(p):
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" '
        f'shape-rendering="crispEdges" role="img" aria-label="{p["name"]} ({p["type"]})">',
        f'<title>{p["name"]} — {p["type"]} · {p["health"]}HP · {p["attack"]}atk · '
        f'{p["range"]}rng · {p["movement"]}mov · {p["points"]}pts</title>',
        f'<polygon points="16,1 21,6.5 11,6.5" fill="{FRONT}"/>',              # front marker
        f'<rect x="6" y="8" width="20" height="20" rx="2" fill="{BODY}" stroke="{EDGE}" stroke-width="1"/>',
    ]
    for side, poly in FRAME.items():
        colour = ARMOR if side in p["armor"] else WEAK if side in p["weak"] else NEUTRAL
        parts.append(f'<polygon points="{poly}" fill="{colour}"/>')
    parts.append(GLYPHS[p["type"]].format(g=GLYPH))
    parts.append("</svg>")
    return "".join(parts)

for p in data["pieces"]:
    (OUT / f'{p["id"]}.svg').write_text(svg(p))
print(f'wrote {len(data["pieces"])} sprites to {OUT.relative_to(ROOT)}')

# ---- contact sheet ------------------------------------------------------
rows = "".join(
    f'<figure>{svg(p)}'
    f'<figcaption><b>{p["name"]}</b><span>{p["type"]}</span>'
    f'<span>{p["health"]}hp · {p["attack"]}atk · {p["range"]}rng · {p["movement"]}mov</span>'
    f'<span class="pts">{p["points"]} pts</span></figcaption></figure>'
    for p in sorted(data["pieces"], key=lambda x: (x["type"], x["points"], x["name"]))
)
legend = "".join(
    f'<li><span class="sw" style="background:{c}"></span>{t}</li>'
    for c, t in [(ARMOR, "armored side"), (WEAK, "weak side"),
                 (NEUTRAL, "neutral side"), (FRONT, "front / facing marker")]
)
(OUT / "contact-sheet.html").write_text(f"""<!doctype html><meta charset="utf-8">
<title>Machine Strike — placeholder pieces</title>
<style>
 :root{{color-scheme:light dark}}
 body{{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:2rem;background:#11151a;color:#e6e9ed}}
 h1{{font-size:1.3rem;margin:0 0 .25rem}} p.sub{{color:#93a0ad;margin:0 0 1.5rem}}
 ul.legend{{display:flex;gap:1.5rem;list-style:none;padding:0;margin:0 0 2rem;flex-wrap:wrap;color:#93a0ad}}
 ul.legend li{{display:flex;align-items:center;gap:.5rem}}
 .sw{{width:14px;height:14px;border-radius:3px;display:inline-block}}
 .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:1rem}}
 figure{{margin:0;padding:.9rem;background:#1a2029;border:1px solid #2a3440;border-radius:8px;text-align:center}}
 figure>svg{{width:64px;height:64px}}
 figcaption{{display:flex;flex-direction:column;gap:.15rem;margin-top:.6rem;font-size:12px}}
 figcaption b{{font-size:13px}} figcaption span{{color:#93a0ad}}
 .pts{{color:#f2c14e!important}}
</style>
<h1>Placeholder pieces — {len(data["pieces"])} machines</h1>
<p class="sub">Geometric stand-ins. Every sprite is drawn facing north; the app rotates it by the
piece's facing. Centre glyph = machine type. Regenerate with
<code>tools/gen_placeholder_pieces.py</code>.</p>
<ul class="legend">{legend}</ul>
<div class="grid">{rows}</div>
""")
print("wrote contact-sheet.html")
