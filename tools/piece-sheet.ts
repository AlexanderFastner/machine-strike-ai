/**
 * Renders the piece reference sheet from the same PieceToken component the game
 * uses, so the sheet can never drift from what players actually see.
 *
 *   npm run pieces:sheet
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MACHINES, MACHINE_BY_ID, TYPE_ORDER, type Facing } from "@ms/engine";
import { ARMOUR, PieceToken, TEAM, WEAK } from "../packages/web/src/board/PieceToken";

const root = resolve(import.meta.dirname, "..");
const tile = (file: string) =>
  `data:image/png;base64,${readFileSync(resolve(root, "assets/terrain", file)).toString("base64")}`;

const TERRAIN = [
  ["Grassland", "grass.png"], ["Forest", "forest.png"], ["Hill", "hills.png"],
  ["Mountain", "mountain.png"], ["Marsh", "water.png"], ["Chasm", "chasm.png"],
  ["Corrupted", "corrupt.png"],
] as const;

// One machine of each type, so every glyph is judged against every terrain.
const SAMPLE = TYPE_ORDER.map((t) => MACHINES.find((m) => m.type === t)!);
const FACINGS: Facing[] = ["N", "E", "S", "W"];

const token = (id: string, owner?: 1 | 2, facing: Facing = "N") =>
  renderToStaticMarkup(createElement(PieceToken, { machine: MACHINE_BY_ID[id], owner, facing }));

const cell = (bg: string, inner: string) =>
  `<div class="cell" style="background-image:url(${bg})">${inner}</div>`;

// A row of the six types, alternating sides and facings, on one terrain.
const strip = (bg: string) =>
  SAMPLE.flatMap((m, i) => [
    cell(bg, token(m.id, 1, FACINGS[i % 4])),
    cell(bg, token(m.id, 2, FACINGS[(i + 2) % 4])),
  ]).join("");

const contrast = TERRAIN.map(([name, file]) => `
  <div class="row"><span class="label">${name}</span><div class="strip">${strip(tile(file))}</div>
  <div class="strip grey">${strip(tile(file))}</div></div>`).join("");

const roster = TYPE_ORDER.map((type) => `
  <h3>${type}</h3><div class="roster">${MACHINES.filter((m) => m.type === type).map((m) => `
    <figure>${cell(tile("grass.png"), token(m.id, 1))}${cell(tile("grass.png"), token(m.id, 2))}
    <figcaption><b>${m.name}</b><span>${m.health}hp · ${m.attack}atk · ${m.points}pt</span></figcaption></figure>`).join("")}
  </div>`).join("");

const swatch = (c: string, label: string) => `<li><span style="background:${c}"></span>${label}</li>`;

writeFileSync(resolve(root, "assets/pieces/sheet.html"), `<!doctype html><meta charset="utf-8">
<title>Machine Strike — pieces</title>
<style>
  body{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:2rem;background:#11151a;color:#e6e9ed}
  h1{font-size:1.3rem;margin:0 0 .3rem} h2{font-size:1rem;margin:2.2rem 0 .8rem} h3{font-size:.8rem;
  color:#93a0ad;text-transform:uppercase;letter-spacing:.08em;margin:1.4rem 0 .5rem}
  p{color:#93a0ad;max-width:52rem;margin:.2rem 0}
  ul.legend{display:flex;flex-wrap:wrap;gap:1.2rem;list-style:none;padding:0;margin:1rem 0}
  ul.legend li{display:flex;align-items:center;gap:.45rem;color:#c4ccd4}
  ul.legend span{width:14px;height:14px;border-radius:3px;display:inline-block;border:1px solid #000}
  .row{display:grid;grid-template-columns:6rem auto auto;gap:1rem;align-items:center;margin-bottom:.6rem}
  .label{color:#93a0ad;font-size:.8rem}
  .strip{display:flex;border:1px solid #2a3440}
  .grey{filter:grayscale(1)}
  .cell{width:64px;height:64px;background-size:64px 64px;image-rendering:pixelated;position:relative}
  .cell svg{position:absolute;inset:4px;width:56px;height:56px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.6))}
  .roster{display:grid;grid-template-columns:repeat(auto-fill,minmax(10rem,1fr));gap:.6rem}
  figure{margin:0;display:grid;grid-template-columns:64px 64px;gap:4px;align-items:start}
  figcaption{grid-column:1/-1;display:flex;flex-direction:column;font-size:.75rem}
  figcaption span{color:#93a0ad}
</style>
<h1>Pieces</h1>
<p>Rendered from <code>packages/web/src/board/PieceToken.tsx</code> — the same component the game draws, so
this sheet cannot drift from what players see. Regenerate with
<code>npm run pieces:sheet</code>.</p>
<ul class="legend">
  ${swatch(TEAM[1].body, "Player 1 — a light gold body")}${swatch(TEAM[2].body, "Player 2 — a dark navy body")}
  ${swatch(ARMOUR, "armoured side")}${swatch(WEAK, "weak side")}
  <li>the point of the teardrop is the front</li><li>the glyph is the machine type</li>
</ul>
<h2>Can you tell the sides apart?</h2>
<p>Each row alternates Player 1 and Player 2, one machine of every type, turned four ways. The right-hand copy is
the same row in greyscale: if the sides still separate there, they separate for colour-blind players too.</p>
${contrast}
<h2>Every machine</h2>
${roster}
`);
console.log("wrote assets/pieces/sheet.html");
