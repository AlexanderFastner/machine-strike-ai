/**
 * Perft — leaf counts at fixed depths from fixed positions.
 *
 * These numbers have no meaning in themselves. Their value is that they move
 * the instant any rule changes: movement, targeting, sprint, overcharge, the
 * no-null-activation rule, corruption timing. A hand-written test only catches
 * what its author thought to check; perft catches everything that alters the
 * shape of the legal action space.
 *
 * If a number here changes, either you meant to change a rule — update it and
 * say so in the commit — or you have just introduced a bug.
 */
import {
  legalActivations, perft, newGame, parseBoard, endTurn,
  type BoardFile, type Deployment, type GameState,
} from "../src/index.ts";

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const board = (rows: string[]): BoardFile => ({ id: "t", name: "t", description: "", rows });
const FLAT = board(Array(8).fill("GGGGGGGG"));

const game = (deployments: Deployment[], corruption = false, rows?: string[]): GameState =>
  newGame(parseBoard(rows ? board(rows) : FLAT), deployments, corruption);

// ---------------------------------------------------------------------------
// Positions are deliberately tiny. Branching is roughly
// pieces x reachable tiles x 4 facings, so anything larger explodes.
// ---------------------------------------------------------------------------

/**
 * One Burrower alone in a corner: movement 2, range 1, nothing to attack.
 * By hand: from a corner with sprint range 3 there are 9 reachable tiles
 * (2 at distance 1, 3 at 2, 4 at 3). Staying put is not an activation without
 * an attack, and there is nothing to attack, so it is 9 x 4 facings = 36.
 */
const solo = game([{ machineId: "burrower", owner: 1, row: 7, col: 0, facing: "N" }]);
eq("solo: activations available", legalActivations(solo).length, 36);
eq("solo perft(1)", perft(solo, 1), 36);

/**
 * Two machines a tile apart — attacks, facings that matter, and deaths.
 * By hand: the enemy blocks one direction, leaving 21 reachable tiles, so
 * 21 x 4 = 84 move-only activations. Three positions can attack: staying put
 * facing north, or stepping to either flank tile beside the target. 84 + 3 = 87.
 */
const duel = game([
  { machineId: "burrower", owner: 1, row: 4, col: 3, facing: "N" },
  { machineId: "burrower", owner: 2, row: 3, col: 3, facing: "S" },
]);
eq("duel perft(1)", perft(duel, 1), 87);
eq("duel perft(2)", perft(duel, 2), 7221);

/**
 * A Gunner fires at exactly maximum range, so its attacking positions are a
 * different set from the melee case above, not a subset.
 * By hand: same 21 reachable tiles = 84 move-only. Three tiles sit exactly two
 * away from the target along a ray — one within normal movement, two only by
 * sprinting, which needs an overcharge to keep the attack. 84 + 3 = 87.
 * The identical total to the duel is a coincidence of geometry, not a bug.
 */
const gunner = game([
  { machineId: "scrapper", owner: 1, row: 4, col: 3, facing: "N" },
  { machineId: "burrower", owner: 2, row: 3, col: 3, facing: "S" },
]);
eq("gunner perft(1)", perft(gunner, 1), 87);

/** Movement 4 plus sprint reaches far more ground — the tree grows fast. */
const sprinter = game([{ machineId: "leaplasher", owner: 1, row: 4, col: 3, facing: "N" }]);
eq("sprinter perft(1)", perft(sprinter, 1), 200);

/**
 * Terrain that stops movement shrinks the tree sharply.
 * By hand: both neighbours of the corner are marsh, and entering marsh ends
 * movement, so only those 2 tiles are reachable. 2 x 4 facings = 8.
 */
const marsh = game([{ machineId: "burrower", owner: 1, row: 7, col: 0, facing: "N" }], false, [
  "GGGGGGGG", "GGGGGGGG", "GGGGGGGG", "GGGGGGGG",
  "GGGGGGGG", "GGGGGGGG", "WWGGGGGG", "GWGGGGGG",
]);
eq("marsh perft(1)", perft(marsh, 1), 8);

/** Chasms are impassable for everything but Swoop. */
const chasm = game([{ machineId: "burrower", owner: 1, row: 7, col: 0, facing: "N" }], false, [
  "GGGGGGGG", "GGGGGGGG", "GGGGGGGG", "GGGGGGGG",
  "GGGGGGGG", "GGGGGGGG", "CCGGGGGG", "GCGGGGGG",
]);
eq("chasm walls a machine in", legalActivations(chasm).length, 0);

/** A flyer ignores that wall entirely. */
const flyer = game([{ machineId: "glinthawk", owner: 1, row: 7, col: 0, facing: "N" }], false, [
  "GGGGGGGG", "GGGGGGGG", "GGGGGGGG", "GGGGGGGG",
  "GGGGGGGG", "GGGGGGGG", "CCGGGGGG", "GCGGGGGG",
]);
eq("a flyer is not walled in", legalActivations(flyer).length > 0, true);

/** A player with no legal activation forfeits rather than deadlocking. */
eq("a walled-in player still passes the turn", endTurn(chasm).turn, 2);
eq("perft recurses past a forfeit", perft(chasm, 1), 1);

// --- speed ------------------------------------------------------------------
// Recorded, not asserted: the number tells us whether the engine needs the
// typed-array conversion before self-play, rather than guessing (plan.md 2.1).
const t0 = performance.now();
const nodes = perft(duel, 2);
const ms = performance.now() - t0;
console.log(`\nperft(duel, 2) = ${nodes} in ${ms.toFixed(0)}ms  ` +
            `(~${Math.round(nodes / (ms / 1000)).toLocaleString()} activations/sec)`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
