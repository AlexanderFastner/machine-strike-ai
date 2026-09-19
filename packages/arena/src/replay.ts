import {
  MACHINE_BY_ID, VP_TO_WIN, checksum, corruptedTiles, endActivation, endTurn,
  legalActivations, movePiece, other, resolveActivation, rotatePiece, sameActivation,
  sideHitBy, targetOf,
  type Activation, type BoardFile, type GameState, type Owner, type Piece,
} from "@ms/engine";
import type { Agent } from "@ms/ai";
import { runGame, type GameResult } from "./match";
import { startPosition, type MatchSetup } from "./setup";

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * A replay stores the setup and every decision, never the states themselves.
 * Viewing one re-executes the engine from scratch, and each step's checksum
 * proves the re-execution landed exactly where the original game did. A replay
 * that only stored states would show what happened; this one shows that the
 * engine *reproduces* what happened, which is the stronger claim.
 */
export type ReplayStep = {
  player: Owner;
  round: number;
  /** Legal options the agent was offered — the real branching factor here. */
  optionCount: number;
  /** null means the player passed the turn instead of acting. */
  activation: Activation | null;
  checksum: string;
};

export type Replay = {
  version: 1;
  seed: number;
  agents: Record<Owner, string>;
  setup: { board: BoardFile; team: string[]; corruption: boolean };
  initialChecksum: string;
  steps: ReplayStep[];
  result: GameResult;
};

export function recordGame(p1: Agent, p2: Agent, setup: MatchSetup, seed: number): Replay {
  const steps: ReplayStep[] = [];
  let initialChecksum = "";
  const result = runGame(p1, p2, setup, seed, {
    start: (s) => {
      initialChecksum = checksum(s);
    },
    step: (before, after, activation, optionCount) => {
      steps.push({ player: before.turn, round: before.round, optionCount, activation, checksum: checksum(after) });
    },
  });
  return {
    version: 1,
    seed,
    agents: { 1: p1.name, 2: p2.name },
    setup: { board: setup.board, team: [...setup.team], corruption: setup.corruption },
    initialChecksum,
    steps,
    result,
  };
}

// ---------------------------------------------------------------------------
// Re-execution
// ---------------------------------------------------------------------------

export type Frame = {
  /** The state once this step is fully over. Frame 0 is the starting position. */
  state: GameState;
  /** The state straight after the activation, before any start-of-turn effects. */
  mid: GameState;
  /** Recomputed from the position, never read from the file. */
  optionCount: number;
  attackAvailable: boolean;
  /** Anything that did not check out. Empty means this step is sound. */
  problems: string[];
};

export function rebuild(replay: Replay): Frame[] {
  let s = startPosition({ ...replay.setup });
  const frames: Frame[] = [
    {
      state: s,
      mid: s,
      optionCount: 0,
      attackAvailable: false,
      problems:
        checksum(s) === replay.initialChecksum
          ? []
          : ["the starting position does not match the recording"],
    },
  ];

  for (const step of replay.steps) {
    const options = legalActivations(s);
    const problems: string[] = [];
    if (step.player !== s.turn)
      problems.push(`recorded as Player ${step.player}'s move, but it is Player ${s.turn}'s turn`);
    if (options.length !== step.optionCount)
      problems.push(`the recording offered ${step.optionCount} options; re-execution finds ${options.length}`);

    let mid = s;
    let next: GameState;
    if (step.activation) {
      if (!options.some((o) => sameActivation(o, step.activation!)))
        problems.push("the chosen activation was not legal in this position");
      mid = resolveActivation(s, step.activation);
      next = endActivation(mid, step.activation.uid);
      if (mid.winner && next.turn !== mid.turn)
        problems.push("the engine carried on into the next turn after the game was already won");
    } else {
      if (options.length > 0) problems.push(`passed the turn with ${options.length} legal options available`);
      next = endTurn(s);
    }
    if (checksum(next) !== step.checksum)
      problems.push("the state differs from the recording — the replay has diverged");

    frames.push({
      state: next,
      mid,
      optionCount: options.length,
      attackAvailable: options.some((o) => o.attack),
      problems,
    });
    s = next;
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Battle report
// ---------------------------------------------------------------------------

export type Effect = {
  kind: "damage" | "destroyed" | "moved" | "turned" | "terrain" | "blight" | "score" | "result";
  text: string;
  owner?: Owner;
};

export type StepReport = {
  headline: string;
  actor?: { uid: number; from: [number, number]; to: [number, number] };
  activation: { effects: Effect[]; log: string[] };
  /** What the start of the next turn did. null if the turn did not pass. */
  turnChange: { title: string; effects: Effect[]; log: string[] } | null;
  note?: string;
};

const FACING_WORD = { N: "north", E: "east", S: "south", W: "west" } as const;

export const square = (size: number, row: number, col: number) =>
  "abcdefghijklmnop"[col] + String(size - row);

export const pieceLabel = (p: Piece) => `${MACHINE_BY_ID[p.machineId].name} (P${p.owner})`;

/**
 * Every effect is read off the difference between two states — not from the
 * engine's own log. That makes the report an independent second account of the
 * step: if the log claims a hit for 3 and the health changed by 2, the two will
 * visibly disagree instead of one quietly echoing the other.
 */
export function diffStates(
  before: GameState,
  after: GameState,
  actor?: { uid: number; intended: [number, number] },
): Effect[] {
  const size = before.grid.length;
  const sq = (r: number, c: number) => square(size, r, c);
  const out: Effect[] = [];

  for (const b of before.pieces) {
    const a = after.pieces.find((x) => x.uid === b.uid);
    if (!a) {
      out.push({ kind: "destroyed", owner: b.owner, text: `${pieceLabel(b)} destroyed on ${sq(b.row, b.col)}` });
      continue;
    }
    if (a.hp !== b.hp)
      out.push({
        kind: "damage",
        owner: b.owner,
        text:
          a.hp < b.hp
            ? `${pieceLabel(b)} takes ${b.hp - a.hp} — ${b.hp} → ${a.hp} health`
            : `${pieceLabel(b)} recovers ${a.hp - b.hp} — ${b.hp} → ${a.hp} health`,
      });

    if (actor && b.uid === actor.uid) {
      const [ir, ic] = actor.intended;
      if (a.row !== ir || a.col !== ic)
        out.push({ kind: "moved", owner: b.owner, text: `${pieceLabel(b)} is carried on to ${sq(a.row, a.col)} by its attack` });
    } else {
      if (a.row !== b.row || a.col !== b.col)
        out.push({ kind: "moved", owner: b.owner, text: `${pieceLabel(b)} forced ${sq(b.row, b.col)} → ${sq(a.row, a.col)}` });
      if (a.facing !== b.facing)
        out.push({ kind: "turned", owner: b.owner, text: `${pieceLabel(b)} spun from ${FACING_WORD[b.facing]} to ${FACING_WORD[a.facing]}` });
    }
  }

  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (before.grid[r][c] !== after.grid[r][c])
        out.push({ kind: "terrain", text: `${sq(r, c)} changes from ${before.grid[r][c]} to ${after.grid[r][c]}` });

  const blightBefore = corruptedTiles(size, before.corruption);
  const spread = [...corruptedTiles(size, after.corruption)]
    .filter((k) => !blightBefore.has(k))
    .map((k) => {
      const [r, c] = k.split(",").map(Number);
      return sq(r, c);
    });
  if (spread.length) out.push({ kind: "blight", text: `The blight spreads to ${spread.join(", ")}` });

  for (const o of [1, 2] as Owner[])
    if (after.vp[o] !== before.vp[o])
      out.push({
        kind: "score",
        owner: o,
        text: `Player ${o} ${after.vp[o] > before.vp[o] ? "+" : ""}${after.vp[o] - before.vp[o]} VP — now ${after.vp[o]} of ${VP_TO_WIN}`,
      });

  if (after.winner && !before.winner)
    out.push({
      kind: "result",
      text: after.winner === "draw" ? "The game ends in a draw" : `Player ${after.winner} wins`,
    });

  return out;
}

export function describeStep(replay: Replay, frames: Frame[], index: number): StepReport {
  const size = replay.setup.board.rows.length;
  const sq = (r: number, c: number) => square(size, r, c);

  if (index === 0) {
    const first = frames[0].state.turn;
    return {
      headline: "Starting position",
      activation: { effects: [], log: [] },
      turnChange: null,
      note:
        `${replay.agents[1]} plays Player 1, ${replay.agents[2]} plays Player 2. ` +
        `Both field the same set; Player ${first} moves first.`,
    };
  }

  const step = replay.steps[index - 1];
  const before = frames[index - 1].state;
  const { mid, state: after } = frames[index];
  const who = `Player ${step.player} (${replay.agents[step.player]})`;

  if (!step.activation) {
    return {
      headline:
        step.optionCount > 0
          ? `${who} passes, despite ${step.optionCount} legal options`
          : `${who} has no legal activation and passes`,
      activation: { effects: [], log: [] },
      turnChange: turnSection(mid, after, size),
    };
  }

  const a = step.activation;
  const actor = before.pieces.find((p) => p.uid === a.uid)!;
  const from: [number, number] = [actor.row, actor.col];
  const to: [number, number] = a.dest ? [a.dest.row, a.dest.col] : from;
  const move = a.dest
    ? `${a.sprint ? "sprints" : "moves"} ${sq(...from)} → ${sq(...to)}`
    : `holds ${sq(...from)}`;
  const strike = a.attack ? (a.overcharge ? ", overcharges and attacks" : " and attacks") : "";

  const activationLog = mid.log.slice(before.log.length);
  const gameOver = !!mid.winner;

  return {
    headline: `${pieceLabel(actor)} ${move}, faces ${FACING_WORD[a.facing]}${strike}`,
    actor: { uid: a.uid, from, to },
    activation: {
      effects: diffStates(before, mid, { uid: a.uid, intended: to }),
      log: activationLog,
    },
    turnChange: gameOver ? null : turnSection(mid, after, size),
    note: gameOver
      ? "The game is over."
      : after.turn === mid.turn
        ? `Player ${after.turn} has ${after.activationsLeft} activation${after.activationsLeft === 1 ? "" : "s"} left this turn.`
        : undefined,
  };
}

function turnSection(mid: GameState, after: GameState, _size: number) {
  if (after.turn === mid.turn && after.round === mid.round) return null;
  return {
    title: `Start of Player ${after.turn}'s turn · round ${after.round}`,
    effects: diffStates(mid, after),
    // The "— Player N to move —" marker is what this section's title already says.
    log: after.log.slice(mid.log.length).filter((l) => !l.startsWith("—")),
  };
}

// ---------------------------------------------------------------------------
// Game health
// ---------------------------------------------------------------------------

export type GameMetrics = {
  rounds: number;
  activations: number;
  passes: number;
  endedBy: string;
  firstAttackRound: number | null;
  attacks: Record<Owner, number>;
  /** An attack was on offer and the agent chose not to take it. */
  declinedAttacks: Record<Owner, number>;
  machinesLost: Record<Owner, number>;
  sprints: number;
  overcharges: number;
  defenseBreaks: number;
  collisions: number;
  terrainChanges: number;
  blightTiles: number;
  averageOptions: number;
  /** Machines that were never activated while alive. */
  idle: string[];
  /** A machine stepping straight back to the square it left the move before. */
  oscillations: number;
  /**
   * Where each side leaves its machines facing after a move that does not attack,
   * relative to the enemy's end of the board. Chance is 25 / 50 / 25.
   */
  facing: Record<Owner, { forward: number; sideways: number; backward: number }>;
  /**
   * Enemy blows each side's machines took, by the side they landed on. Classified
   * by re-running the engine's targeting at the moment of the attack, so collision
   * damage and an attacker's own overcharge cost are never counted as a hit on a side.
   */
  hitsTaken: Record<Owner, { weak: number; armour: number; neutral: number }>;
  problems: { step: number; text: string }[];
};

export function gameMetrics(replay: Replay, frames: Frame[]): GameMetrics {
  const start = frames[0].state;
  const final = frames[frames.length - 1].state;
  const size = start.grid.length;

  const attacks = { 1: 0, 2: 0 } as Record<Owner, number>;
  const facing = {
    1: { forward: 0, sideways: 0, backward: 0 },
    2: { forward: 0, sideways: 0, backward: 0 },
  } as GameMetrics["facing"];
  const hitsTaken = {
    1: { weak: 0, armour: 0, neutral: 0 },
    2: { weak: 0, armour: 0, neutral: 0 },
  } as GameMetrics["hitsTaken"];
  const declined = { 1: 0, 2: 0 } as Record<Owner, number>;
  let firstAttackRound: number | null = null;
  let sprints = 0, overcharges = 0, passes = 0, terrainChanges = 0, optionSum = 0, decisions = 0;
  const acted = new Set<number>();
  const trail = new Map<number, string[]>(
    start.pieces.map((p) => [p.uid, [`${p.row},${p.col}`]]),
  );

  replay.steps.forEach((step, i) => {
    const frame = frames[i + 1];
    if (!step.activation) {
      passes++;
    } else {
      const a = step.activation;
      acted.add(a.uid);
      optionSum += frame.optionCount;
      decisions++;
      if (a.attack) {
        attacks[step.player]++;
        firstAttackRound ??= step.round;
        classifyHits(frames[i].state, a, step.player, hitsTaken);
      } else {
        if (frame.attackAvailable) declined[step.player]++;
        const forward = step.player === 1 ? "N" : "S";
        const backward = step.player === 1 ? "S" : "N";
        facing[step.player][a.facing === forward ? "forward" : a.facing === backward ? "backward" : "sideways"]++;
      }
      if (a.sprint) sprints++;
      if (a.overcharge) overcharges++;
      const moved = frame.mid.pieces.find((p) => p.uid === a.uid);
      if (moved) trail.get(a.uid)?.push(`${moved.row},${moved.col}`);
    }
    const prev = frames[i].state.grid;
    const next = frame.state.grid;
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) if (prev[r][c] !== next[r][c]) terrainChanges++;
  });

  let oscillations = 0;
  for (const t of trail.values())
    for (let i = 2; i < t.length; i++) if (t[i] === t[i - 2] && t[i] !== t[i - 1]) oscillations++;

  const idle = start.pieces
    .filter((p) => !acted.has(p.uid))
    .map((p) => {
      const survived = final.pieces.some((q) => q.uid === p.uid);
      return `${pieceLabel(p)}${survived ? " — alive all game" : " — destroyed before acting"}`;
    });

  const lost = { 1: 0, 2: 0 } as Record<Owner, number>;
  for (const p of start.pieces) if (!final.pieces.some((q) => q.uid === p.uid)) lost[p.owner]++;

  const log = final.log;
  const count = (re: RegExp) => log.filter((l) => re.test(l)).length;

  return {
    rounds: final.round,
    activations: replay.result.activations,
    passes,
    endedBy: howItEnded(replay, final),
    firstAttackRound,
    attacks,
    declinedAttacks: declined,
    machinesLost: lost,
    sprints,
    overcharges,
    defenseBreaks: count(/Defense Break/),
    collisions: count(/collides|slammed/),
    terrainChanges,
    blightTiles: corruptedTiles(size, final.corruption).size,
    averageOptions: decisions ? optionSum / decisions : 0,
    idle,
    oscillations,
    facing,
    hitsTaken,
    problems: frames.flatMap((f, i) => f.problems.map((text) => ({ step: i, text }))),
  };
}

/** Which side each enemy blow of this attack landed on, per the engine's own targeting. */
function classifyHits(
  before: GameState,
  a: Activation,
  attackerOwner: Owner,
  into: GameMetrics["hitsTaken"],
) {
  let pre = a.dest ? movePiece(before, a.uid, a.dest.row, a.dest.col) : before;
  pre = rotatePiece(pre, a.uid, a.facing);
  const attacker = pre.pieces.find((p) => p.uid === a.uid);
  if (!attacker) return;
  const t = targetOf(pre, attacker);
  if (t.kind === "none") return;
  for (const v of t.kind === "single" ? [t.victim] : t.victims) {
    if (v.owner === attackerOwner) continue; // a Dash lane can clip its own side; not an enemy blow
    const m = MACHINE_BY_ID[v.machineId];
    const side = sideHitBy(v.facing, t.dir);
    into[v.owner][m.weak.includes(side) ? "weak" : m.armor.includes(side) ? "armour" : "neutral"]++;
  }
}

function howItEnded(replay: Replay, final: GameState): string {
  if (replay.result.hitCap) return "hit the activation cap — not a real ending";
  if (!final.winner) return "unfinished";
  if (final.winner === "draw") return "draw on time";
  const w = final.winner;
  if (final.vp[w] >= VP_TO_WIN) return `Player ${w} reached ${VP_TO_WIN} VP`;
  if (!final.pieces.some((p) => p.owner === other(w))) return `Player ${w} destroyed every enemy machine`;
  return `Player ${w} won on time — ahead on VP when the ${replay.setup.corruption ? "blight consumed the board" : "round limit arrived"}`;
}
