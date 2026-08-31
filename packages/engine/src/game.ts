import { attackerCP, resolveAttack } from "./combat";
import { blightDone, corruptedTiles, nextTileFor } from "./corruption";
import {
  CONVERSION,
  dist,
  facingToward,
  snapshotAuras,
  stepTerrain,
} from "./skills";
import { MACHINE_BY_ID } from "./machines";
import { reachable } from "./movement";
import { targetOf } from "./targeting";
import { flyingOnly, type TerrainId } from "./terrain";
import {
  ACTIVATIONS_PER_TURN,
  CORRUPTION_DAMAGE,
  OVERCHARGE_COST,
  DELTA,
  ROUND_LIMIT,
  VP_TO_WIN,
  at,
  inBounds,
  opposite,
  other,
  type Facing,
  type GameState,
  type Owner,
  type Piece,
} from "./types";

export type Deployment = { machineId: string; owner: Owner; row: number; col: number; facing: Facing };

export function newGame(
  grid: TerrainId[][],
  deployments: Deployment[],
  corruptionEnabled = true,
): GameState {
  const state: GameState = {
    grid,
    pieces: deployments.map((d, i) => ({
      uid: i + 1,
      machineId: d.machineId,
      owner: d.owner,
      row: d.row,
      col: d.col,
      facing: d.facing,
      hp: MACHINE_BY_ID[d.machineId].health,
      attackMod: 0,
    })),
    turn: 1,
    round: 1,
    activationsLeft: ACTIVATIONS_PER_TURN,
    activated: [],
    vp: { 1: 0, 2: 0 },
    log: ["Player 1 to move."],
    winner: null,
    turnNumber: 1,
    corruption: { enabled: corruptionEnabled, fronts: { 1: 0, 2: 0 } },
  };
  snapshotAuras(state);
  return state;
}

/** A corrupted tile counts only as corrupted: the terrain beneath stops mattering. */
export const corrupted = (s: GameState) => corruptedTiles(s.grid.length, s.corruption);
export const isCorrupted = (s: GameState, row: number, col: number) =>
  corrupted(s).has(`${row},${col}`);

const clone = (s: GameState): GameState => ({
  ...s,
  pieces: s.pieces.map((p) => ({ ...p })),
  activated: [...s.activated],
  vp: { ...s.vp },
  log: [...s.log],
  // Terrain is mutable — several skills change it — so the grid is copied too.
  grid: s.grid.map((row) => [...row]),
  corruption: { ...s.corruption, fronts: { ...s.corruption.fronts } },
});

const name = (p: Piece) => MACHINE_BY_ID[p.machineId].name;

/**
 * Which pieces this player may still activate.
 * The two activations must be different pieces — unless only one is able to act,
 * in which case that piece acts twice (rules 5.3).
 */
export function activatable(s: GameState, owner: Owner): Piece[] {
  const mine = s.pieces.filter((p) => p.owner === owner);
  const unused = mine.filter((p) => !s.activated.includes(p.uid));
  return unused.length > 0 ? unused : mine.length === 1 ? mine : [];
}

export function movesFor(s: GameState, piece: Piece, sprint = false) {
  const m = MACHINE_BY_ID[piece.machineId];
  return reachable(s, piece, m.movement + (sprint ? 1 : 0), corrupted(s));
}

export function movePiece(s0: GameState, uid: number, row: number, col: number): GameState {
  const s = clone(s0);
  const p = s.pieces.find((x) => x.uid === uid)!;
  s.log.push(`${name(p)} moves.`);
  p.row = row;
  p.col = col;
  return s;
}

export function rotatePiece(s0: GameState, uid: number, facing: Facing): GameState {
  const s = clone(s0);
  s.pieces.find((x) => x.uid === uid)!.facing = facing;
  return s;
}

/** Award VP and check the win condition immediately — ordering decides simultaneous kills. */
function kill(s: GameState, victim: Piece, scorer: Owner) {
  const pts = MACHINE_BY_ID[victim.machineId].points;
  s.vp[scorer] += pts;
  s.pieces = s.pieces.filter((p) => p.uid !== victim.uid);
  s.log.push(`${name(victim)} destroyed — ${scorer === 1 ? "P1" : "P2"} +${pts} VP.`);
  if (s.vp[scorer] >= VP_TO_WIN && !s.winner) s.winner = scorer;
}

/** Knockback: 1 tile away. Edge costs 1; a blocking piece costs both 1; a chasm is just a landing. */
function knockback(s: GameState, victim: Piece, dir: Facing, attacker: Piece) {
  const [dr, dc] = DELTA[dir];
  const r = victim.row + dr;
  const c = victim.col + dc;

  if (!inBounds(s, r, c)) {
    victim.hp -= 1;
    s.log.push(`${name(victim)} is slammed into the board edge (-1).`);
  } else {
    const blocker = at(s, r, c);
    if (blocker) {
      victim.hp -= 1;
      blocker.hp -= 1;
      s.log.push(`${name(victim)} collides with ${name(blocker)} (-1 each).`);
      if (blocker.hp <= 0) kill(s, blocker, attacker.owner);
    } else {
      victim.row = r;
      victim.col = c;
      if (flyingOnly(s.grid[r][c])) s.log.push(`${name(victim)} is shoved into a chasm.`);
    }
  }
  if (victim.hp <= 0) kill(s, victim, attacker.owner);
}

/** Terrain conversion and Alter Terrain, both after damage lands (rules 10.2, 10.3). */
function applyOnHitSkills(s: GameState, attacker: Piece, victim: Piece, victimCorrupted: boolean) {
  const m = MACHINE_BY_ID[attacker.machineId];
  if (!m.skill) return;

  const conv = CONVERSION[m.skill];
  if (conv && !victimCorrupted && s.grid[victim.row][victim.col] === conv.from) {
    s.grid[victim.row][victim.col] = conv.to;
    s.log.push(`${m.skill}: ${victim.row},${victim.col} becomes ${conv.to}.`);
  }

  if (m.skill === "Alter Terrain") {
    // Lowers the attacker's own tile, raises the target's. Deliberately double-edged.
    s.grid[attacker.row][attacker.col] = stepTerrain(s.grid[attacker.row][attacker.col], -1);
    s.grid[victim.row][victim.col] = stepTerrain(s.grid[victim.row][victim.col], +1);
    s.log.push("Alter Terrain reshapes the ground.");
  }
}

/** Retaliate: turn to face the attacker and hit back for 1, if it is in range. */
function retaliate(s: GameState, attacker: Piece, victim: Piece) {
  const vm = MACHINE_BY_ID[victim.machineId];
  if (vm.skill !== "Retaliate") return;
  victim.facing = facingToward(victim, attacker);
  if (dist(victim, attacker) > vm.range) return;
  attacker.hp -= 1;
  s.log.push(`${name(victim)} retaliates for 1.`);
  if (attacker.hp <= 0) kill(s, attacker, victim.owner);
}

export function attackWith(s0: GameState, uid: number): GameState {
  const s = clone(s0);
  const attacker = s.pieces.find((x) => x.uid === uid)!;
  const m = MACHINE_BY_ID[attacker.machineId];
  const target = targetOf(s, attacker);
  if (target.kind === "none") return s0;

  const blighted = corrupted(s);
  const terrainAt = (p: Piece) => s.grid[p.row][p.col];
  const blightedAt = (p: Piece) => blighted.has(`${p.row},${p.col}`);
  const victims = target.kind === "single" ? [target.victim] : target.victims;

  for (const v0 of victims) {
    const victim = s.pieces.find((x) => x.uid === v0.uid);
    if (!victim) continue;
    const res = resolveAttack(
      attacker,
      victim,
      terrainAt(attacker),
      terrainAt(victim),
      target.dir,
      blightedAt(attacker),
      blightedAt(victim),
      attacker.attackMod,
    );

    if (res.kind === "damage") {
      victim.hp -= res.damage;
      s.log.push(
        `${name(attacker)} hits ${name(victim)} on its ${res.sideHit} side ` +
          `(CP ${res.attackerCP} vs ${res.defenderCP}) for ${res.damage}.`,
      );
      applyOnHitSkills(s, attacker, victim, blightedAt(victim));
      if (victim.hp <= 0) kill(s, victim, attacker.owner);
      else retaliate(s, attacker, victim);
    } else {
      // Defense Break: both lose 1 and the defender is knocked back (rules 6.3).
      attacker.hp -= 1;
      victim.hp -= 1;
      s.log.push(
        `Defense Break — ${name(attacker)} CP ${res.attackerCP} vs ${res.defenderCP}. Both lose 1.`,
      );
      if (attacker.hp <= 0) kill(s, attacker, victim.owner);
      if (victim.hp > 0) knockback(s, victim, target.dir, attacker);
      else kill(s, victim, attacker.owner);
      continue;
    }

    if (target.kind === "lane") {
      // Dash spins everything it passes through.
      const f = victim.facing;
      victim.facing = (["S", "W", "N", "E"] as const)[["N", "E", "S", "W"].indexOf(f)];
    }
  }

  // Type-specific follow-through.
  if (target.kind === "single" && s.pieces.some((x) => x.uid === target.victim.uid)) {
    const victim = s.pieces.find((x) => x.uid === target.victim.uid)!;
    const [dr, dc] = DELTA[target.dir];
    if (m.type === "Ram") {
      const from = { row: victim.row, col: victim.col };
      knockback(s, victim, target.dir, attacker);
      if (!at(s, from.row, from.col)) {
        attacker.row = from.row;
        attacker.col = from.col;
        s.log.push(`${name(attacker)} advances into the vacated tile.`);
      }
    } else if (m.type === "Pull") {
      const r = victim.row - dr;
      const c = victim.col - dc;
      if (inBounds(s, r, c) && !at(s, r, c)) {
        victim.row = r;
        victim.col = c;
        s.log.push(`${name(victim)} is dragged one tile closer.`);
      }
    }
  } else if (target.kind === "lane") {
    // The landing tile was empty when the charge was declared, but resolution can
    // fill it: a Defense Break in the lane knocks that defender backwards, and
    // backwards is where the charge was going. Re-check before landing, or two
    // machines end up on one tile.
    if (!at(s, target.landing.row, target.landing.col)) {
      attacker.row = target.landing.row;
      attacker.col = target.landing.col;
      s.log.push(`${name(attacker)} charges through and lands beyond.`);
    } else {
      s.log.push(`${name(attacker)} is blocked and holds its ground.`);
    }
  }

  if (!s.winner && s.pieces.every((p) => p.owner !== other(attacker.owner)))
    s.winner = attacker.owner;
  return s;
}

/**
 * Overcharge (rules 5.5): 2 Health buys one extra tile of movement or an extra
 * attack. It needs 2 Health to declare, and **the cost is paid after the action
 * resolves** — so a machine can spend its last health landing a killing blow,
 * score the points, and only then be destroyed.
 */
export const canOvercharge = (p: Piece) => p.hp >= OVERCHARGE_COST;

export function payOverchargeCost(s0: GameState, uid: number): GameState {
  const s = clone(s0);
  const p = s.pieces.find((x) => x.uid === uid);
  if (!p) return s; // already destroyed by the exchange it just paid for
  p.hp -= OVERCHARGE_COST;
  s.log.push(`${name(p)} overcharges (-${OVERCHARGE_COST}).`);
  if (p.hp <= 0) kill(s, p, other(p.owner));
  return s;
}

/** Attack, then pay. Ordering matters: the kill is scored before the cost lands. */
export function overchargeAttack(s0: GameState, uid: number): GameState {
  return payOverchargeCost(attackWith(s0, uid), uid);
}

/** Spend one activation. An attack always ends the activation (rules 5.4). */
export function endActivation(s0: GameState, uid: number): GameState {
  const s = clone(s0);
  if (!s.activated.includes(uid)) s.activated.push(uid);
  s.activationsLeft -= 1;
  if (s.activationsLeft <= 0 || activatable(s, s.turn).length === 0) return endTurn(s);
  return s;
}

export function endTurn(s0: GameState): GameState {
  const s = clone(s0);
  const next = other(s.turn);
  if (next === 1) s.round += 1;
  s.turn = next;
  s.turnNumber += 1;
  s.activationsLeft = ACTIVATIONS_PER_TURN;
  s.activated = [];
  s.log.push(`— Player ${next} to move (round ${s.round}) —`);
  startOfTurn(s);
  return s;
}

/**
 * Start-of-turn sequence (rules 5.2). Damage comes BEFORE the spread, so a tile
 * corrupted this turn deals nothing this turn — the machine it appears under
 * always gets one turn to walk out.
 */
function startOfTurn(s: GameState) {
  startOfTurnSkills(s);
  if (!s.corruption.enabled) {
    if (s.round > ROUND_LIMIT) endOnTime(s);
    snapshotAuras(s);
    return;
  }

  const blighted = corrupted(s);
  for (const p of [...s.pieces]) {
    if (p.owner !== s.turn) continue;
    if (!blighted.has(`${p.row},${p.col}`)) continue;
    p.hp -= CORRUPTION_DAMAGE;
    s.log.push(`${name(p)} is being consumed by the blight (-${CORRUPTION_DAMAGE}).`);
    if (p.hp <= 0) kill(s, p, other(p.owner));
  }

  // No spread on the game's very first turn.
  if (s.turnNumber >= 2) {
    const tile = nextTileFor(s.grid.length, s.corruption, s.turn);
    if (tile) {
      s.corruption.fronts[s.turn] += 1;
      s.log.push(`The blight spreads.`);
    }
  }

  if (blightDone(s.grid.length, s.corruption) && !s.winner) endOnTime(s);

  // Auras are stamped on last, once deaths from the blight and Spray have settled.
  snapshotAuras(s);
}

/**
 * Spray and Whiplash fire at the start of their owner's turn (rules 10.4).
 * Both are indiscriminate: "all pieces within Attack Range", the owner's own
 * machines included.
 */
function startOfTurnSkills(s: GameState) {
  for (const src of [...s.pieces]) {
    if (src.owner !== s.turn) continue;
    const sm = MACHINE_BY_ID[src.machineId];
    if (sm.skill !== "Spray" && sm.skill !== "Whiplash") continue;

    for (const p of [...s.pieces]) {
      if (p.uid === src.uid || dist(src, p) > sm.range) continue;
      if (sm.skill === "Spray") {
        p.hp -= 1;
        s.log.push(`${name(src)} sprays ${name(p)} (-1).`);
        if (p.hp <= 0) kill(s, p, other(p.owner));
      } else {
        p.facing = opposite(p.facing);
        s.log.push(`${name(src)} whips ${name(p)} around.`);
      }
    }
  }
}

/** Nobody reached 7 VP: highest total wins, equal is a draw. */
function endOnTime(s: GameState) {
  s.winner = s.vp[1] > s.vp[2] ? 1 : s.vp[2] > s.vp[1] ? 2 : "draw";
  s.log.push(
    s.winner === "draw"
      ? "The board is consumed — level on victory points, a draw."
      : `The board is consumed — Player ${s.winner} wins on victory points.`,
  );
}

/** What an attack would do, without applying it — for the UI's damage preview. */
export type AttackPreview = {
  hits: { uid: number; damage: number; lethal: boolean; sideHit: string; defenseBreak: boolean }[];
  /** Damage the attacker would take: Defense Break and Retaliate. */
  selfDamage: number;
  selfLethal: boolean;
};

export function previewAttack(s: GameState, uid: number): AttackPreview | null {
  const attacker = s.pieces.find((x) => x.uid === uid);
  if (!attacker) return null;
  const target = targetOf(s, attacker);
  if (target.kind === "none") return null;

  const blighted = corrupted(s);
  const isBlighted = (p: Piece) => blighted.has(`${p.row},${p.col}`);
  const powerMod = attacker.attackMod;
  const victims = target.kind === "single" ? [target.victim] : target.victims;

  let selfDamage = 0;
  const hits = victims.map((victim) => {
    const res = resolveAttack(
      attacker,
      victim,
      s.grid[attacker.row][attacker.col],
      s.grid[victim.row][victim.col],
      target.dir,
      isBlighted(attacker),
      isBlighted(victim),
      powerMod,
    );
    const damage = res.kind === "damage" ? res.damage : 1;
    const lethal = victim.hp - damage <= 0;

    if (res.kind === "defenseBreak") selfDamage += 1;
    // Retaliate only fires if the target survives to swing back.
    const vm = MACHINE_BY_ID[victim.machineId];
    if (!lethal && vm.skill === "Retaliate" && dist(victim, attacker) <= vm.range) selfDamage += 1;

    return {
      uid: victim.uid,
      damage,
      lethal,
      sideHit: res.sideHit,
      defenseBreak: res.kind === "defenseBreak",
    };
  });

  return { hits, selfDamage, selfLethal: attacker.hp - selfDamage <= 0 };
}

/** Combat Power this piece would attack at from where it stands. */
export function combatPowerOf(s: GameState, piece: Piece): number {
  const m = MACHINE_BY_ID[piece.machineId];
  return attackerCP(
    m,
    s.grid[piece.row][piece.col],
    corrupted(s).has(`${piece.row},${piece.col}`),
    piece.attackMod,
  );
}

export { targetOf, activatable as activatablePieces };
