/**
 * Fuzz — thousands of random legal games, checking invariants after every step.
 *
 * Golden tests check what their author thought to check. Perft catches changes
 * to the shape of the action space. This catches the third thing: states that
 * are individually legal but collectively impossible — two machines on a tile,
 * victory points appearing from nowhere, a game that never ends.
 *
 * Everything is seeded, so a failure prints a seed that reproduces it exactly.
 */
import {
  MACHINE_BY_ID, applyActivation, corruptedTiles, endTurn, legalActivations,
  newGame, parseBoard, ROUND_LIMIT, type BoardFile, type Deployment, type GameState,
} from "../src/index.ts";

let failures = 0;
const fail = (seed: number, msg: string) => {
  failures++;
  if (failures <= 10) console.log(`FAIL [seed ${seed}] ${msg}`);
};

/** mulberry32 — small, fast, and reproducible across runs and machines. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROSTER = ["burrower", "scrounger", "spikesnout", "clawstrider", "scrapper", "grazer",
                "charger", "glinthawk", "fanghorn", "plowhorn", "longleg", "redeye-watcher",
                "rollerback", "shell-walker", "snapmaw", "widemaw", "tremortusk", "lancehorn"];

const BOARDS: Record<string, string[]> = {
  flat: Array(8).fill("GGGGGGGG"),
  mixed: ["GGGGGGGG", "GGFFGGGG", "GHMWGGGG", "GGCCGGGG",
          "GGGGCCGG", "GGGGWMHG", "GGGGFFGG", "GGGGGGGG"],
};

function randomGame(seed: number, corruption: boolean): GameState {
  const r = rng(seed);
  const rows = r() < 0.5 ? BOARDS.flat : BOARDS.mixed;
  const grid = parseBoard({ id: "f", name: "f", description: "", rows } as BoardFile);
  const deployments: Deployment[] = [];
  const taken = new Set<string>();

  for (const owner of [1, 2] as const) {
    const rowsFor = owner === 1 ? [7, 6] : [0, 1];
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const row = rowsFor[Math.floor(r() * rowsFor.length)];
        const col = Math.floor(r() * 8);
        if (taken.has(`${row},${col}`) || grid[row][col] === "chasm") continue;
        taken.add(`${row},${col}`);
        deployments.push({
          machineId: ROSTER[Math.floor(r() * ROSTER.length)],
          owner, row, col, facing: owner === 1 ? "N" : "S",
        });
        break;
      }
    }
  }
  return newGame(grid, deployments, corruption);
}

function checkInvariants(s: GameState, seed: number, prevVp: { 1: number; 2: number }) {
  const size = s.grid.length;
  const occupied = new Set<string>();

  for (const p of s.pieces) {
    const m = MACHINE_BY_ID[p.machineId];
    if (!m) return fail(seed, `unknown machine ${p.machineId}`);
    if (p.hp <= 0) return fail(seed, `${m.name} is on the board at ${p.hp} health`);
    if (p.hp > m.health) return fail(seed, `${m.name} has ${p.hp} of ${m.health} health`);
    if (p.row < 0 || p.col < 0 || p.row >= size || p.col >= size)
      return fail(seed, `${m.name} is off the board at ${p.row},${p.col}`);
    const key = `${p.row},${p.col}`;
    if (occupied.has(key)) return fail(seed, `two machines share ${key}`);
    occupied.add(key);
  }

  for (const owner of [1, 2] as const) {
    if (s.vp[owner] < prevVp[owner]) return fail(seed, `player ${owner} lost victory points`);
  }

  // Points only ever come from destroyed machines, so the two totals must equal
  // the value of everything missing from the board.
  const alive = s.pieces.reduce((n, p) => n + MACHINE_BY_ID[p.machineId].points, 0);
  const scored = s.vp[1] + s.vp[2];
  if (scored + alive !== s.startingPoints)
    return fail(seed, `points do not balance: ${scored} scored + ${alive} alive != ${s.startingPoints}`);

  for (const row of s.grid)
    for (const t of row)
      if (!["chasm", "marsh", "grassland", "forest", "hill", "mountain"].includes(t))
        return fail(seed, `invalid terrain ${t}`);

  if (s.corruption.enabled) {
    const blight = corruptedTiles(size, s.corruption);
    if (blight.size > size * size) return fail(seed, `blight covers ${blight.size} of ${size * size}`);
  }
}

// ---------------------------------------------------------------------------

const GAMES = Number(process.env.FUZZ_GAMES ?? 400);
let totalRounds = 0, longest = 0, decided = 0, draws = 0, steps = 0;
const t0 = performance.now();

for (let seed = 1; seed <= GAMES; seed++) {
  const corruption = seed % 2 === 0;
  let s = randomGame(seed, corruption);
  const startingPoints = s.pieces.reduce((n, p) => n + MACHINE_BY_ID[p.machineId].points, 0);
  (s as GameState & { startingPoints: number }).startingPoints = startingPoints;

  const r = rng(seed * 7919);
  const cap = 400;
  let turns = 0;

  while (!s.winner && turns < cap) {
    const prevVp = { ...s.vp };
    const acts = legalActivations(s);
    s = acts.length === 0 ? endTurn(s) : applyActivation(s, acts[Math.floor(r() * acts.length)]);
    (s as GameState & { startingPoints: number }).startingPoints = startingPoints;
    checkInvariants(s, seed, prevVp);
    turns++;
    steps++;
  }

  if (!s.winner) fail(seed, `game did not finish within ${cap} activations (round ${s.round})`);
  else if (s.winner === "draw") draws++;
  else decided++;

  // Termination: the blight ends it in ~32 rounds; without it, the 50-round cap.
  const limit = corruption ? 40 : ROUND_LIMIT + 2;
  if (s.round > limit) fail(seed, `ran to round ${s.round}, past the ${limit} expected`);

  totalRounds += s.round;
  longest = Math.max(longest, s.round);
}

// --- replay determinism ------------------------------------------------------
function playout(seed: number): string {
  let s = randomGame(seed, true);
  const r = rng(seed * 7919);
  for (let i = 0; i < 60 && !s.winner; i++) {
    const acts = legalActivations(s);
    s = acts.length === 0 ? endTurn(s) : applyActivation(s, acts[Math.floor(r() * acts.length)]);
  }
  return JSON.stringify({ pieces: s.pieces, vp: s.vp, round: s.round, grid: s.grid, c: s.corruption });
}
for (const seed of [11, 222, 3333]) {
  if (playout(seed) !== playout(seed)) fail(seed, "the same seed produced two different games");
}

const ms = performance.now() - t0;
console.log(
  `${GAMES} games, ${steps} activations in ${ms.toFixed(0)}ms ` +
  `(~${Math.round(steps / (ms / 1000)).toLocaleString()}/sec)\n` +
  `decided ${decided}, drawn ${draws}, average ${(totalRounds / GAMES).toFixed(1)} rounds, longest ${longest}`,
);
console.log(failures === 0 ? "no invariant violations" : `${failures} invariant violations`);
process.exit(failures ? 1 : 0);
