import { resolveAttack } from "./combat";
import { MACHINE_BY_ID } from "./machines";
import { reachable } from "./movement";
import { targetOf } from "./targeting";
import { flyingOnly, type TerrainId } from "./terrain";
import {
  ACTIVATIONS_PER_TURN,
  DELTA,
  VP_TO_WIN,
  at,
  inBounds,
  other,
  type Facing,
  type GameState,
  type Owner,
  type Piece,
} from "./types";

export type Deployment = { machineId: string; owner: Owner; row: number; col: number; facing: Facing };

export function newGame(grid: TerrainId[][], deployments: Deployment[]): GameState {
  return {
    grid,
    pieces: deployments.map((d, i) => ({
      uid: i + 1,
      machineId: d.machineId,
      owner: d.owner,
      row: d.row,
      col: d.col,
      facing: d.facing,
      hp: MACHINE_BY_ID[d.machineId].health,
    })),
    turn: 1,
    round: 1,
    activationsLeft: ACTIVATIONS_PER_TURN,
    activated: [],
    vp: { 1: 0, 2: 0 },
    log: ["Player 1 to move."],
    winner: null,
  };
}

const clone = (s: GameState): GameState => ({
  ...s,
  pieces: s.pieces.map((p) => ({ ...p })),
  activated: [...s.activated],
  vp: { ...s.vp },
  log: [...s.log],
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
  return reachable(s, piece, m.movement + (sprint ? 1 : 0));
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

export function attackWith(s0: GameState, uid: number): GameState {
  const s = clone(s0);
  const attacker = s.pieces.find((x) => x.uid === uid)!;
  const m = MACHINE_BY_ID[attacker.machineId];
  const target = targetOf(s, attacker);
  if (target.kind === "none") return s0;

  const terrainAt = (p: Piece) => s.grid[p.row][p.col];
  const victims = target.kind === "lane" ? target.victims : [target.victim];

  for (const v0 of victims) {
    const victim = s.pieces.find((x) => x.uid === v0.uid);
    if (!victim) continue;
    const res = resolveAttack(attacker, victim, terrainAt(attacker), terrainAt(victim), target.dir);

    if (res.kind === "damage") {
      victim.hp -= res.damage;
      s.log.push(
        `${name(attacker)} hits ${name(victim)} on its ${res.sideHit} side ` +
          `(CP ${res.attackerCP} vs ${res.defenderCP}) for ${res.damage}.`,
      );
      if (victim.hp <= 0) kill(s, victim, attacker.owner);
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
    attacker.row = target.landing.row;
    attacker.col = target.landing.col;
    s.log.push(`${name(attacker)} charges through and lands beyond.`);
  }

  if (!s.winner && s.pieces.every((p) => p.owner !== other(attacker.owner)))
    s.winner = attacker.owner;
  return s;
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
  s.activationsLeft = ACTIVATIONS_PER_TURN;
  s.activated = [];
  s.log.push(`— Player ${next} to move (round ${s.round}) —`);
  return s;
}

export { targetOf, activatable as activatablePieces };
