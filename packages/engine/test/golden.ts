import { blockedReason, teamPoints, copiesOf, MACHINE_BY_ID, MAX_COPIES,
         attackerCP, defenderCP, sideHitBy, resolveAttack } from "../src/index.ts";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// --- 4-copy limit ---------------------------------------------------------
const burrower = MACHINE_BY_ID["burrower"]; // 1 pt
let team = [];
for (let i = 0; i < 4; i++) { eq(`add #${i+1}`, blockedReason(team, burrower), null); team.push("burrower"); }
eq("5th copy blocked", blockedReason(team, burrower), `Limit ${MAX_COPIES} per set`);
eq("4 copies counted", copiesOf(team, "burrower"), 4);
eq("points so far", teamPoints(team), 4);

// budget rule still applies independently
const slaughter = MACHINE_BY_ID["slaughterspine"]; // 10 pts
eq("over budget blocked", blockedReason(team, slaughter), "Not enough points left");

// --- combat: the worked table from docs/rules.md 6.2 (attacker Attack 3) ---
const A3 = { type: "Melee", attack: 3 };
const dm = (armor, weak) => ({ type: "Melee", armor, weak });
const cases = [
  ["grass->grass neutral", "grassland", "grassland", "F", [], [], 3],
  ["grass->grass armored", "grassland", "grassland", "F", ["F"], [], 2],
  ["grass->grass weak",    "grassland", "grassland", "F", [], ["F"], 4],
  ["hill->grass neutral",  "hill",      "grassland", "F", [], [], 5],
  ["grass->hill neutral",  "grassland", "hill",      "F", [], [], 1],
  ["grass->mountain weak", "grassland", "mountain",  "F", [], ["F"], 1],
  ["hill->mountain",       "hill",      "mountain",  "F", [], [], 2],
  ["grass->chasm neutral", "grassland", "chasm",     "F", [], [], 5],
];
for (const [label, at_, dt, side, armor, weak, want] of cases) {
  const a = attackerCP(A3, at_), d = defenderCP(dm(armor, weak), dt, side);
  eq(label, a - d, want);
}
// defense break cases
eq("grass->hill armored = break", attackerCP(A3,"grassland") <= defenderCP(dm(["F"],[]),"hill","F"), true);
eq("grass->mountain neutral = break", attackerCP(A3,"grassland") <= defenderCP(dm([],[]),"mountain","F"), true);

// --- side hit geometry ----------------------------------------------------
eq("attack S onto N-facing = front", sideHitBy("N", "S"), "F");
eq("attack N onto N-facing = back",  sideHitBy("N", "N"), "B");
eq("attack E onto N-facing = left",  sideHitBy("N", "E"), "L");
eq("attack W onto N-facing = right", sideHitBy("N", "W"), "R");

// --- type modifiers -------------------------------------------------------
eq("Swoop in chasm: penalty ignored, +1", attackerCP({type:"Swoop",attack:3},"chasm"), 4);
eq("Swoop on mountain keeps bonus",       attackerCP({type:"Swoop",attack:3},"mountain"), 7);
eq("Pull on marsh +1 offsets penalty",    attackerCP({type:"Pull",attack:3},"marsh"), 3);
eq("Melee on marsh takes penalty",        attackerCP({type:"Melee",attack:3},"marsh"), 2);

// --- integration: a real board, attacks, knockback, VP -------------------
const { parseBoard, newGame, movesFor, movePiece, rotatePiece, attackWith,
        endActivation, endTurn, targetOf, activatablePieces, key } =
  await import("../src/index.ts");

const flatBoard = { id: "t", name: "t", description: "", rows: Array(8).fill("GGGGGGGG") };
const grid = parseBoard(flatBoard);

// Scrapper (Gunner, atk 3, range 2) at d4 facing N; Burrower (Melee, 4hp) at d6 facing S.
const g0 = newGame(grid, [
  { machineId: "scrapper", owner: 1, row: 4, col: 3, facing: "N" },
  { machineId: "burrower", owner: 2, row: 2, col: 3, facing: "S" },
]);
const gunner = g0.pieces[0], prey = g0.pieces[1];

// Gunner fires at EXACTLY max range: 2 tiles away is a target...
eq("gunner target at exact range", targetOf(g0, gunner).kind, "single");
// ...but nothing closer. Slide the prey one tile in and it becomes unhittable.
const gClose = newGame(grid, [
  { machineId: "scrapper", owner: 1, row: 4, col: 3, facing: "N" },
  { machineId: "burrower", owner: 2, row: 3, col: 3, facing: "S" },
]);
eq("gunner cannot hit adjacent", targetOf(gClose, gClose.pieces[0]).kind, "none");

// Damage: attacker CP 3 (grass), defender CP 0 + facing. Burrower is armor F / weak B,
// and it faces S into an attack travelling N, so its FRONT takes the hit: CP 1 -> 2 damage.
const afterHit = attackWith(g0, gunner.uid);
eq("front armour reduces the hit", afterHit.pieces.find(p => p.uid === prey.uid).hp, 4 - 2);

// Turn its back and the same shot hits harder: weak side, CP -1 -> 4 damage, lethal.
const gBack = rotatePiece(g0, prey.uid, "N");
const killed = attackWith(gBack, gunner.uid);
eq("weak side is lethal here", killed.pieces.some(p => p.uid === prey.uid), false);
eq("VP awarded to attacker", killed.vp[1], MACHINE_BY_ID["burrower"].points);

// Defense Break: attack into equal-or-higher CP. Leaplasher (atk 1) into a neutral side
// on grass: CP 1 vs 0 would damage, so put the defender's armour toward it instead.
const gBreak = newGame(grid, [
  { machineId: "leaplasher", owner: 1, row: 4, col: 3, facing: "N" }, // atk 1
  { machineId: "burrower", owner: 2, row: 3, col: 3, facing: "S" },   // armour F => CP 1
]);
const broke = attackWith(gBreak, gBreak.pieces[0].uid);
eq("defense break costs the attacker 1", broke.pieces.find(p => p.owner === 1).hp, 3 - 1);
eq("defense break costs the defender 1", broke.pieces.find(p => p.owner === 2).hp, 4 - 1);
eq("defender is knocked back a tile", broke.pieces.find(p => p.owner === 2).row, 2);

// Knockback into the board edge costs an extra 1.
const gEdge = newGame(grid, [
  { machineId: "leaplasher", owner: 1, row: 1, col: 3, facing: "N" },
  { machineId: "burrower", owner: 2, row: 0, col: 3, facing: "S" },
]);
const edge = attackWith(gEdge, gEdge.pieces[0].uid);
eq("edge knockback costs an extra 1", edge.pieces.find(p => p.owner === 2).hp, 4 - 1 - 1);

// Activations: two per turn, and they must be different pieces.
const twoUp = newGame(grid, [
  { machineId: "burrower", owner: 1, row: 7, col: 0, facing: "N" },
  { machineId: "scrounger", owner: 1, row: 7, col: 1, facing: "N" },
  { machineId: "burrower", owner: 2, row: 0, col: 0, facing: "S" },
]);
const oneDone = endActivation(twoUp, twoUp.pieces[0].uid);
eq("one activation left", oneDone.activationsLeft, 1);
eq("the used piece cannot act again", activatablePieces(oneDone, 1).map(p => p.uid), [twoUp.pieces[1].uid]);
const turnOver = endActivation(oneDone, twoUp.pieces[1].uid);
eq("turn passes after two activations", turnOver.turn, 2);
eq("still round 1 after P1", turnOver.round, 1);
eq("round advances when P1 comes back", endTurn(turnOver).round, 2);

// Sole surviving piece may act twice.
const solo = newGame(grid, [
  { machineId: "burrower", owner: 1, row: 7, col: 0, facing: "N" },
  { machineId: "burrower", owner: 2, row: 0, col: 0, facing: "S" },
]);
const soloUsed = { ...solo, activated: [solo.pieces[0].uid], activationsLeft: 1 };
eq("lone piece may act twice", activatablePieces(soloUsed, 1).length, 1);

// Movement: friendly pieces are passable, enemies are not.
const block = newGame(grid, [
  { machineId: "clawstrider", owner: 1, row: 7, col: 0, facing: "N" }, // move 2
  { machineId: "burrower", owner: 1, row: 7, col: 1, facing: "N" },    // friendly, passable
]);
const through = movesFor(block, block.pieces[0]);
eq("passes through a friendly", through.has(key(7, 2)), true);
eq("cannot stop on a friendly", through.has(key(7, 1)), false);

const wall = newGame(grid, [
  { machineId: "clawstrider", owner: 1, row: 7, col: 0, facing: "N" },
  { machineId: "burrower", owner: 2, row: 7, col: 1, facing: "S" },    // enemy blocks
]);
eq("an enemy blocks the path", movesFor(wall, wall.pieces[0]).has(key(7, 2)), false);


// --- corruption: the blight schedule (rules 2.5) --------------------------
const { corruptionOrder, corruptedTiles, blightDone, isCorrupted } = await import("../src/index.ts");

const coord = ([r, c]) => "abcdefgh"[c] + (8 - r);
const p1Order = corruptionOrder(8, 1);
const p2Order = corruptionOrder(8, 2);

// Each front takes exactly half the board.
eq("P1 front covers half", p1Order.length, 32);
eq("P2 front covers half", p2Order.length, 32);

// P1 starts on the row closest to them (rank 1) and fills right to left from
// their own point of view: facing north, their right is the high columns.
eq("P1 first six tiles", p1Order.slice(0, 6).map(coord), ["h1", "g1", "f1", "e1", "d1", "c1"]);
// Serpentine: the next row reverses.
eq("P1 second row reverses", p1Order.slice(8, 12).map(coord), ["a2", "b2", "c2", "d2"]);
eq("P1 third row reverses back", p1Order.slice(16, 19).map(coord), ["h3", "g3", "f3"]);

// P2 sits opposite: their closest row is rank 8, and facing south their right
// is the low columns.
eq("P2 first six tiles", p2Order.slice(0, 6).map(coord), ["a8", "b8", "c8", "d8", "e8", "f8"]);
eq("P2 second row reverses", p2Order.slice(8, 12).map(coord), ["h7", "g7", "f7", "e7"]);

// The fronts meet exactly in the middle and never overlap.
const all = new Set([...p1Order, ...p2Order].map(coord));
eq("the two fronts tile the whole board", all.size, 64);
eq("P1 never crosses the midline", p1Order.every(([r]) => r >= 4), true);
eq("P2 never crosses the midline", p2Order.every(([r]) => r <= 3), true);

eq("full board ends the game", blightDone(8, { enabled: true, fronts: { 1: 32, 2: 32 } }), true);
eq("half a board does not", blightDone(8, { enabled: true, fronts: { 1: 32, 2: 31 } }), false);
eq("disabled blight never ends it", blightDone(8, { enabled: false, fronts: { 1: 32, 2: 32 } }), false);
eq("disabled blight corrupts nothing", corruptedTiles(8, { enabled: false, fronts: { 1: 9, 2: 9 } }).size, 0);

// --- corruption in play ---------------------------------------------------
// A machine standing in the blight loses 2 at the start of its OWNER's turn,
// and nothing on the turn the blight arrives underneath it.
let g = newGame(grid, [
  { machineId: "clawstrider", owner: 1, row: 7, col: 7, facing: "N" }, // h1: P1's very first blight tile
  { machineId: "burrower", owner: 2, row: 0, col: 0, facing: "S" },
], true);
eq("nothing corrupted at kickoff", corruptedTiles(8, g.corruption).size, 0);

g = endTurn(g);                       // -> P2's turn: turnNumber 2, P2's front opens
eq("P2 front opened", g.corruption.fronts[2], 1);
eq("P1 front still closed", g.corruption.fronts[1], 0);

g = endTurn(g);                       // -> P1's turn: P1's front takes h1, under the Clawstrider
eq("P1 front opened", g.corruption.fronts[1], 1);
eq("blight is under the Clawstrider", isCorrupted(g, 7, 7), true);
eq("but it took no damage this turn", g.pieces.find(p => p.owner === 1).hp, 8);

g = endTurn(g); g = endTurn(g);       // back round to P1
eq("now it burns for 2", g.pieces.find(p => p.owner === 1).hp, 6);

// Corruption replaces the terrain modifier entirely: -2 either way.
eq("corrupted attacker CP", attackerCP({ type: "Melee", attack: 3 }, "mountain", true), 1);
eq("corrupted defender CP", defenderCP(dm([], []), "mountain", "F", true), -2);

// With corruption off the 50-round limit applies instead.
let off = newGame(grid, [
  { machineId: "burrower", owner: 1, row: 7, col: 0, facing: "N" },
  { machineId: "burrower", owner: 2, row: 0, col: 0, facing: "S" },
], false);
eq("no blight when switched off", off.corruption.enabled, false);
off = { ...off, round: 50, vp: { 1: 3, 2: 1 } };
eq("game runs at the limit", endTurn(off).winner, null);
off = { ...off, round: 50, turn: 2, vp: { 1: 3, 2: 1 } };
eq("higher VP wins on time", endTurn(off).winner, 1);


// --- skills (rules 10) ----------------------------------------------------
const { stepTerrain, rotateOffset, sweepTiles, attackPowerMod, previewAttack,
        combatPowerOf, terrainSkillBonus, shieldBonus } = await import("../src/index.ts");

// 1. Attack-from-terrain bonuses: one per tier, +1 CP, only on that terrain.
eq("Gallop on grassland", terrainSkillBonus({ skill: "Gallop" }, "grassland", false), 1);
eq("Gallop elsewhere", terrainSkillBonus({ skill: "Gallop" }, "forest", false), 0);
eq("Stalk on forest", terrainSkillBonus({ skill: "Stalk" }, "forest", false), 1);
eq("Climb on hill", terrainSkillBonus({ skill: "Climb" }, "hill", false), 1);
eq("High Ground on mountain", terrainSkillBonus({ skill: "High Ground" }, "mountain", false), 1);
eq("no terrain bonus while corrupted", terrainSkillBonus({ skill: "Climb" }, "hill", true), 0);

// 2/3. The ladder clamps, and skills can never dig a chasm.
eq("marsh is the skill floor", stepTerrain("marsh", -1), "marsh");
eq("mountain is the ceiling", stepTerrain("mountain", +1), "mountain");
eq("grassland steps up", stepTerrain("grassland", +1), "forest");
eq("forest steps down", stepTerrain("forest", -1), "grassland");

// Burn converts the TARGET's forest tile.
let burn = newGame(parseBoard({ id:"b", name:"b", description:"",
  rows: ["GGGGGGGG","GGGFGGGG","GGGGGGGG","GGGGGGGG","GGGGGGGG","GGGGGGGG","GGGGGGGG","GGGGGGGG"] }), [
  { machineId: "fireclaw", owner: 1, row: 3, col: 3, facing: "N" },   // atk 4, range 2, Burn
  { machineId: "burrower", owner: 2, row: 1, col: 3, facing: "N" },   // stands on forest
]);
eq("target starts on forest", burn.grid[1][3], "forest");
burn = attackWith(burn, burn.pieces[0].uid);
eq("Burn scorches the target's tile", burn.grid[1][3], "grassland");

// Alter Terrain lowers the attacker's tile and raises the target's.
let alter = newGame(grid, [
  { machineId: "rockbreaker", owner: 1, row: 4, col: 3, facing: "N" }, // Alter Terrain, range 2
  { machineId: "burrower", owner: 2, row: 2, col: 3, facing: "N" },
]);
alter = attackWith(alter, alter.pieces[0].uid);
eq("attacker's own ground sinks", alter.grid[4][3], "marsh");
eq("target's ground rises", alter.grid[2][3], "forest");

// 4. Empower and Blind stack, and apply only to the right side.
const aura = newGame(grid, [
  { machineId: "longleg", owner: 1, row: 4, col: 3, facing: "N" },     // Empower, range 2
  { machineId: "leaplasher", owner: 1, row: 4, col: 4, facing: "N" },  // Empower, range 1
  { machineId: "burrower", owner: 1, row: 4, col: 2, facing: "N" },
  { machineId: "redeye-watcher", owner: 2, row: 3, col: 2, facing: "S" }, // Blind, range 2
]);
const ally = aura.pieces[2];
// +1 from Longleg (dist 1), +1 from Leaplasher (dist 2 > range 1, so no), -1 from Blind (dist 1)
eq("auras stack and cancel", attackPowerMod(aura, ally), 0);
const farAlly = { ...ally, row: 5, col: 3 };
eq("out of the enemy's blind range", attackPowerMod({ ...aura, pieces: [...aura.pieces.slice(0,2), farAlly] }, farAlly), 1);

// 5. Shield adds to the defender's Combat Power.
eq("Shield defends", shieldBonus({ skill: "Shield" }), 1);
eq("no shield, no bonus", shieldBonus({ skill: null }), 0);

// 6. Retaliate: the target turns to face its attacker and hits back for 1.
let ret = newGame(grid, [
  { machineId: "burrower", owner: 1, row: 4, col: 3, facing: "N" },        // atk 2, range 1
  { machineId: "rollerback", owner: 2, row: 3, col: 3, facing: "N" },      // Retaliate, range 2
]);
const before = ret.pieces[0].hp;
ret = attackWith(ret, ret.pieces[0].uid);
eq("retaliation costs the attacker 1", ret.pieces.find(p => p.owner === 1).hp, before - 1);
eq("retaliator turns to face", ret.pieces.find(p => p.owner === 2).facing, "S");

// 7. Sweep: the area rotates with facing.
eq("sweep offset facing north", rotateOffset("N", 1, 1), [-1, 1]);
eq("sweep offset facing east", rotateOffset("E", 1, 1), [1, 1]);
eq("sweep offset facing south", rotateOffset("S", 1, 1), [1, -1]);
eq("sweep offset facing west", rotateOffset("W", 1, 1), [-1, -1]);
eq("Thunderjaw sweeps three tiles", sweepTiles({ row: 4, col: 3, facing: "N" }, MACHINE_BY_ID["thunderjaw"]).length, 3);
eq("Stormbird sweeps nine", sweepTiles({ row: 5, col: 3, facing: "N" }, MACHINE_BY_ID["stormbird"]).length, 9);

// A Sweep hits everything in the area, both sides.
let sweep = newGame(grid, [
  { machineId: "tremortusk", owner: 1, row: 4, col: 3, facing: "N" },  // 1x3 directly ahead
  { machineId: "burrower", owner: 2, row: 3, col: 2, facing: "S" },
  { machineId: "burrower", owner: 2, row: 3, col: 4, facing: "S" },
]);
const sweepPreview = previewAttack(sweep, sweep.pieces[0].uid);
eq("sweep hits both enemies at once", sweepPreview.hits.length, 2);

// --- preview matches what actually happens --------------------------------
const pv = newGame(grid, [
  { machineId: "scrapper", owner: 1, row: 4, col: 3, facing: "N" },
  { machineId: "burrower", owner: 2, row: 2, col: 3, facing: "S" },
]);
const predicted = previewAttack(pv, pv.pieces[0].uid);
const actual = attackWith(pv, pv.pieces[0].uid);
const survivor = actual.pieces.find(p => p.owner === 2);
eq("preview damage matches the real hit", predicted.hits[0].damage, 4 - survivor.hp);
eq("preview reports no self damage here", predicted.selfDamage, 0);

// Preview also predicts self-damage from retaliation.
const retPreview = previewAttack(newGame(grid, [
  { machineId: "burrower", owner: 1, row: 4, col: 3, facing: "N" },
  { machineId: "rollerback", owner: 2, row: 3, col: 3, facing: "N" },
]), 1);
eq("preview warns about retaliation", retPreview.selfDamage, 1);

eq("combat power reads off the board", combatPowerOf(pv, pv.pieces[0]), 3);


// --- auras are snapshotted at the start of a turn (rules 10.4) ------------
const { attackEnvelope, snapshotAuras } = await import("../src/index.ts");

let snap = newGame(grid, [
  { machineId: "longleg", owner: 1, row: 7, col: 3, facing: "N" },   // Empower, range 2
  { machineId: "burrower", owner: 1, row: 7, col: 0, facing: "N" },  // far away at kickoff
  { machineId: "burrower", owner: 2, row: 0, col: 0, facing: "S" },
]);
eq("no aura at range 3", snap.pieces[1].attackMod, 0);

// Walk into the aura mid-turn: the snapshot does not change until next turn.
snap = movePiece(snap, snap.pieces[1].uid, 7, 2);
eq("still unbuffed the turn it moves in", snap.pieces.find(p => p.uid === 2).attackMod, 0);
snap = endTurn(snap);   // P2
snap = endTurn(snap);   // back to P1 — auras restamped
eq("buff lands at the start of the next turn", snap.pieces.find(p => p.uid === 2).attackMod, 1);

// Blind is stamped on the victim too, so it bites on the victim's own turn.
let blind = newGame(grid, [
  { machineId: "redeye-watcher", owner: 1, row: 4, col: 3, facing: "N" }, // Blind, range 2
  { machineId: "burrower", owner: 2, row: 3, col: 3, facing: "S" },
]);
blind = endTurn(blind);  // P2's turn begins, snapshot taken
eq("blinded on its own turn", blind.pieces.find(p => p.owner === 2).attackMod, -1);

// --- attack envelope ------------------------------------------------------
const envState = newGame(grid, [
  { machineId: "clawstrider", owner: 1, row: 4, col: 3, facing: "N" },  // Melee, range 2
  { machineId: "burrower", owner: 2, row: 2, col: 3, facing: "S" },
]);
const env = attackEnvelope(envState, envState.pieces[0]);
eq("melee range 2 in four directions", env.tiles.size, 8);
eq("the enemy two tiles north is a threat", env.threats.has("2,3"), true);
eq("only one threat", env.threats.size, 1);

// A Gunner can only reach its exact maximum range.
const gunEnv = attackEnvelope(newGame(grid, [
  { machineId: "scrapper", owner: 1, row: 4, col: 3, facing: "N" },     // Gunner range 2
]), { uid: 1, machineId: "scrapper", owner: 1, row: 4, col: 3, facing: "N", hp: 5, attackMod: 0 });
eq("gunner envelope is a ring of four", gunEnv.tiles.size, 4);
eq("gunner cannot reach one tile away", gunEnv.tiles.has("3,3"), false);
eq("gunner reaches exactly two away", gunEnv.tiles.has("2,3"), true);


// --- sprint and overcharge (rules 4.5, 5.5) -------------------------------
const { canOvercharge, payOverchargeCost, overchargeAttack, SPRINT_BONUS } =
  await import("../src/index.ts");

// Sprint reaches exactly one tile further than a normal move.
const runner = newGame(grid, [
  { machineId: "clawstrider", owner: 1, row: 7, col: 0, facing: "N" }, // movement 2
]);
const normal = movesFor(runner, runner.pieces[0]);
const sprint = movesFor(runner, runner.pieces[0], true);
eq("sprint reaches further", sprint.size > normal.size, true);
eq("sprint is exactly +1 tile of reach", Math.max(...sprint.values()), Math.max(...normal.values()) + SPRINT_BONUS);
eq("every normal tile is still reachable", [...normal.keys()].every(k => sprint.has(k)), true);

// Overcharge needs 2 health to declare.
eq("healthy machine may overcharge", canOvercharge({ hp: 2 }), true);
eq("a 1-health machine may not", canOvercharge({ hp: 1 }), false);

// The cost is paid after the action: a 2-health machine still lands its kill.
let sac = newGame(grid, [
  { machineId: "stalker", owner: 1, row: 4, col: 3, facing: "N" },   // atk 4, range 2
  { machineId: "burrower", owner: 2, row: 3, col: 3, facing: "N" },  // 4hp, weak back
]);
sac.pieces[0].hp = 2;
const sacked = overchargeAttack(sac, sac.pieces[0].uid);
eq("the victim still dies", sacked.pieces.some(p => p.owner === 2), false);
eq("and the attacker scores it", sacked.vp[1], MACHINE_BY_ID["burrower"].points);
eq("before the cost destroys it", sacked.pieces.some(p => p.owner === 1), false);
eq("the opponent scores the overcharged machine", sacked.vp[2], MACHINE_BY_ID["stalker"].points);

// A healthy machine just loses 2.
let fine = newGame(grid, [
  { machineId: "clawstrider", owner: 1, row: 4, col: 3, facing: "N" },
  { machineId: "burrower", owner: 2, row: 0, col: 0, facing: "S" },
]);
fine = payOverchargeCost(fine, fine.pieces[0].uid);
eq("overcharge costs 2 health", fine.pieces.find(p => p.owner === 1).hp, 8 - 2);

// --- terrain changes are visible in state.grid ----------------------------
// Regression: the board must render state.grid, not the grid parsed at setup.
let slither = newGame(grid, [
  { machineId: "slitherfang", owner: 1, row: 4, col: 3, facing: "N" }, // Dash, Alter Terrain
  { machineId: "burrower", owner: 2, row: 3, col: 3, facing: "N" },
]);
const beforeGrid = slither.grid[4][3];
slither = attackWith(slither, slither.pieces[0].uid);
eq("Alter Terrain really changes state.grid", slither.grid[4][3] !== beforeGrid, true);
eq("the attacker's tile sinks to marsh", slither.grid[4][3], "marsh");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
