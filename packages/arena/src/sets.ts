import { MACHINE_BY_ID, MAX_COPIES, TEAM_POINTS, teamPoints } from "@ms/engine";
import { deploymentOrder } from "./setup";

/**
 * A fixed draft book. Both sides field the same set, so a match measures play
 * and nothing else — drafting is a separate problem, and mixing the two would
 * make every result ambiguous (plan.md, Stage 2 rung 5).
 */
export const TEAMS: Record<string, string[]> = {
  // 3 + 4 + 1 + 1 + 1
  standard: ["clawstrider", "stalker", "burrower", "scrounger", "spikesnout"],
  // 4 + 3 + 2 + 1: fewer, tougher machines
  heavy: ["ravager", "clawstrider", "charger", "grazer"],
  // Five of the six machine types. Not six, because they do not fit: the
  // cheapest machine of each type totals 11 points against a budget of 10
  // (Burrower 1, Grazer 1, Charger 2, Longleg 2, Glinthawk 2, Snapmaw 3).
  // No legal set can field every type — this one drops Pull.
  varied: ["leaplasher", "longleg", "grazer", "charger", "glinthawk", "burrower", "spikesnout"],
  // The same idea keeping Pull and dropping Swoop.
  amphibious: ["snapmaw", "longleg", "grazer", "charger", "burrower", "spikesnout"],
};

export { teamPoints };

/**
 * A team that breaks the drafting rules would make every result meaningless, so
 * it fails loudly rather than quietly playing an illegal position. The first
 * draft of the draft book shipped a 14-point "varied" set and the arena played
 * it without complaint.
 */
export function assertLegalTeam(name: string, team: string[]) {
  for (const id of team)
    if (!MACHINE_BY_ID[id]) throw new Error(`Team "${name}" fields "${id}", which is not a machine.`);
  const pts = teamPoints(team);
  if (pts !== TEAM_POINTS)
    throw new Error(`Team "${name}" totals ${pts} points; a legal set is exactly ${TEAM_POINTS}.`);
  for (const id of new Set(team)) {
    const n = team.filter((x) => x === id).length;
    if (n > MAX_COPIES)
      throw new Error(`Team "${name}" fields ${n} copies of ${id}; the limit is ${MAX_COPIES}.`);
  }
}

for (const [name, team] of Object.entries(TEAMS)) assertLegalTeam(name, team);

// ---------------------------------------------------------------------------
// Set keys
// ---------------------------------------------------------------------------

/**
 * A set's key: its machine ids in deployment order, joined by "+", with a count
 * on repeats — `burrower:4+grazer:4+scrounger:2`, or simply
 * `burrower+clawstrider+scrounger+spikesnout+stalker` when every machine differs.
 * Every ordering of the same machines has the same key.
 *
 * The results store identifies sets by this key, so **don't change the format**:
 * games already stored under the old form would stop matching the new one.
 */
export function setKey(team: string[]): string {
  const counts = new Map<string, number>();
  for (const id of deploymentOrder(team)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, n]) => (n > 1 ? `${id}:${n}` : id)).join("+");
}

export function parseSetKey(key: string): string[] {
  const team: string[] = [];
  for (const part of key.split("+")) {
    const [id, count = "1"] = part.split(":");
    const n = Number(count);
    if (!MACHINE_BY_ID[id]) throw new Error(`"${id}" in set "${key}" is not a machine.`);
    if (!Number.isInteger(n) || n < 1) throw new Error(`"${part}" in set "${key}" has a bad count.`);
    for (let i = 0; i < n; i++) team.push(id);
  }
  return team;
}

/** A draft-book name or any set written as a key, checked for legality either way. */
export function resolveTeam(nameOrKey: string): string[] {
  const team = TEAMS[nameOrKey] ?? parseSetKey(nameOrKey);
  assertLegalTeam(nameOrKey, team);
  return team;
}

// ---------------------------------------------------------------------------
// The space of sets
// ---------------------------------------------------------------------------

let everySet: string[] | null = null;

/**
 * Every legal set, as keys: exactly TEAM_POINTS points and at most MAX_COPIES of
 * any machine. With the current roster that is 147,106 sets — so 10.8 billion
 * distinct pairings, which is why set-vs-set results come from sampling
 * opponents rather than playing every pair (docs/results.md).
 *
 * The order is fixed by the roster, and sampling indexes into it, so a sweep
 * draws the same opponents every time it runs. The count is frozen in
 * test/sets.ts: a roster change that alters it is then noticed, not absorbed.
 */
export function allSetKeys(): string[] {
  if (everySet) return everySet;
  const ids = deploymentOrder(Object.keys(MACHINE_BY_ID));
  const out: string[] = [];
  const parts: string[] = [];
  const walk = (i: number, left: number) => {
    if (left === 0) return void out.push(parts.join("+"));
    if (i === ids.length) return;
    const pts = MACHINE_BY_ID[ids[i]].points;
    for (let n = Math.min(MAX_COPIES, Math.floor(left / pts)); n >= 1; n--) {
      parts.push(n > 1 ? `${ids[i]}:${n}` : ids[i]);
      walk(i + 1, left - n * pts);
      parts.pop();
    }
    walk(i + 1, left);
  };
  walk(0, TEAM_POINTS);
  everySet = out;
  return out;
}

/**
 * A 32-bit hash of the parts, for deriving reproducible randomness from names
 * rather than from a counter — so a sweep's draws depend on *what* they are for,
 * not on how many draws came before. FNV-1a, as the engine's checksum uses.
 */
export function hash32(...parts: (string | number)[]): number {
  const s = parts.join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A uniform draw in [0, 1) from the parts — the same parts always give the same draw. */
export function unitDraw(...parts: (string | number)[]): number {
  // One mulberry32 step over the hash, to spread FNV's weak low bits.
  let t = (hash32(...parts) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** n distinct sets, uniform over every legal set, reproducible from the seed. */
export function sampleSets(n: number, seed: number): string[] {
  const all = allSetKeys();
  if (n >= all.length) return [...all];
  const picked = new Set<number>();
  for (let draw = 0; picked.size < n; draw++)
    picked.add(Math.floor(unitDraw("sample", seed, draw) * all.length));
  return [...picked].map((i) => all[i]);
}
