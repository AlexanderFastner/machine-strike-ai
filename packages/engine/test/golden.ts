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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
