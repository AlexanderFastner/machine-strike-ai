/**
 * The results store: every game the arena plays, one row each, in a single
 * SQLite file (results/arena.sqlite, git-ignored). Why SQLite rather than files,
 * CSV or a database server is in docs/results.md.
 *
 * A game is stored under its *identity* — everything that decides how it plays
 * out: the code version, board, blight setting, both agents, where each side's
 * machines started, and the seed. Games are deterministic, so one identity has exactly
 * one result. That makes the store a cache as well as a record: a game already
 * played is looked up rather than replayed, which is what lets a sweep be
 * stopped and resumed, extended to more opponents, or split across processes
 * that all write to the same file.
 *
 * Games are stored as outcomes, never as replays. Any stored game can be
 * regenerated from its identity, and `arena record --game <id>` does exactly that,
 * checking the replay lands on the stored final checksum.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { parseBoard, teamPoints, turned, type BoardFile, type Deployment, type Owner } from "@ms/engine";
import { arrangementKey, parseArrangement, type Agent } from "@ms/ai";
import { runGame, type GameResult, type PlayFn } from "./match";
import { parseSetKey, setKey } from "./sets";
import { chooseDeployment, type MatchSetup } from "./setup";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const DEFAULT_DB = resolve(REPO_ROOT, "results/arena.sqlite");

// ---------------------------------------------------------------------------
// Code version
// ---------------------------------------------------------------------------

/**
 * Every file that can change how a game plays out. Their combined hash is the
 * **code version** stored with each game, and results are only reused or pooled
 * within one version — so fixing a rule can never leave stale games mixed in with
 * fresh ones. That is not hypothetical: H0 found the engine playing on after a
 * win, a bug that could have changed scores.
 *
 * **If you add a file that can change the outcome of a game, add it here.** Files
 * that only run or read games (this one, cli.ts, sweep.ts, report.ts, replay.ts)
 * stay out, so editing them orphans nothing. Boards are identified per game by
 * their content, and sets by their key, so neither registry is listed.
 */
export const OUTCOME_SOURCES = [
  "packages/engine/src", //          the rules
  "packages/data/machines.json", //  the roster: stats, skills, points
  "packages/ai/src", //              the agents
  "packages/arena/src/match.ts", //  the game loop and its activation cap
  "packages/arena/src/setup.ts", //  deployment: where every machine starts
];

export function codeVersion(root = REPO_ROOT): string {
  const files: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (!f.startsWith(".")) walk(resolve(p, f));
    } else if (/\.(ts|tsx|js|json)$/.test(p)) files.push(p);
  };
  for (const src of OUTCOME_SOURCES) walk(resolve(root, src));
  const h = createHash("sha256");
  for (const f of files) h.update(relative(root, f).split(sep).join("/")).update("\0").update(readFileSync(f)).update("\0");
  return h.digest("hex").slice(0, 12);
}

/** Boards are known by what is on them, so a renamed board is the same board and an edited one is not. */
export const boardHash = (board: BoardFile) =>
  createHash("sha256").update(JSON.stringify(parseBoard(board))).digest("hex").slice(0, 16);

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- One row per arena invocation: who ran what, when, on which code.
CREATE TABLE IF NOT EXISTS runs (
  id        INTEGER PRIMARY KEY,
  started   TEXT NOT NULL,
  finished  TEXT,
  status    TEXT NOT NULL,            -- running | done | interrupted | failed
  command   TEXT NOT NULL,
  label     TEXT,
  code      TEXT NOT NULL,            -- code version: see OUTCOME_SOURCES
  git       TEXT,                     -- commit, for people; code is what results are keyed on
  dirty     INTEGER,                  -- 1 if the working tree had uncommitted changes
  node      TEXT NOT NULL,
  host      TEXT NOT NULL,
  played    INTEGER NOT NULL DEFAULT 0,
  reused    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS boards (
  id    INTEGER PRIMARY KEY,
  hash  TEXT NOT NULL UNIQUE,         -- of the terrain grid
  name  TEXT NOT NULL,                -- the file's id when first stored
  rows  TEXT NOT NULL                 -- the terrain, as JSON rows: a stored game never depends on a file still existing
);

CREATE TABLE IF NOT EXISTS sets (
  id        INTEGER PRIMARY KEY,
  key       TEXT NOT NULL UNIQUE,     -- setKey(): burrower+clawstrider+scrounger+spikesnout+stalker
  machines  INTEGER NOT NULL,
  points    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS set_machines (
  set_id   INTEGER NOT NULL REFERENCES sets(id),
  machine  TEXT NOT NULL,
  copies   INTEGER NOT NULL,
  PRIMARY KEY (set_id, machine)
) WITHOUT ROWID;

-- Where one side's machines started, from that side's own seat: the same
-- arrangement has the same key whichever side played it.
CREATE TABLE IF NOT EXISTS arrangements (
  id      INTEGER PRIMARY KEY,
  key     TEXT NOT NULL UNIQUE,       -- arrangementKey(): burrower@b1N+clawstrider@c1N+…
  set_id  INTEGER NOT NULL REFERENCES sets(id)
);

CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY,
  -- identity: everything that decides how the game plays out
  code        TEXT NOT NULL,
  board       INTEGER NOT NULL REFERENCES boards(id),
  corruption  INTEGER NOT NULL,
  agent1      TEXT NOT NULL,          -- Player 1, who moves first
  agent2      TEXT NOT NULL,
  deploy1     INTEGER NOT NULL REFERENCES arrangements(id),
  deploy2     INTEGER NOT NULL REFERENCES arrangements(id),
  seed        INTEGER NOT NULL,
  -- each side's set: what its arrangement fields, kept here to group by
  set1        INTEGER NOT NULL REFERENCES sets(id),
  set2        INTEGER NOT NULL REFERENCES sets(id),
  -- outcome
  winner      INTEGER NOT NULL,       -- 1 or 2, or 0 for a draw
  vp1         INTEGER NOT NULL,
  vp2         INTEGER NOT NULL,
  rounds      INTEGER NOT NULL,
  activations INTEGER NOT NULL,
  branching   REAL NOT NULL,
  hit_cap     INTEGER NOT NULL,
  checksum    TEXT NOT NULL,          -- of the final position
  ms          REAL NOT NULL,          -- time to play it
  -- context
  run         INTEGER NOT NULL REFERENCES runs(id),
  sweep       INTEGER,                -- the set sweep's seed, for games a sweep played
  subject     INTEGER,                -- which side (1 or 2) held the set being measured
  UNIQUE (code, board, corruption, agent1, agent2, deploy1, deploy2, seed)
);
`;

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export type Identity = {
  code: string;
  board: number;
  corruption: 0 | 1;
  agent1: string;
  agent2: string;
  /** Arrangement ids: where each side's machines started. */
  deploy1: number;
  deploy2: number;
  seed: number;
};

/** Labels on a game that are not part of what it is: which sweep asked for it, and for which side. */
export type GameContext = { sweep?: number; subject?: Owner };

type Pending = { id: Identity; sets: [number, number]; r: GameResult; ms: number; ctx: GameContext };

const identityKey = (i: Identity) =>
  [i.code, i.board, i.corruption, i.agent1, i.agent2, i.deploy1, i.deploy2, i.seed].join("|");

export class ResultStore {
  readonly db: DatabaseSync;
  readonly path: string;
  /** The code version of this process: what new games are stored under, and what lookups match. */
  readonly code: string;
  runId = 0;
  played = 0;
  reused = 0;

  private boardIds = new WeakMap<BoardFile, number>();
  private setIds = new Map<string, number>();
  private arrangementIds = new Map<string, number>();
  private pending: Pending[] = [];
  private pendingByKey = new Map<string, GameResult>();
  private lastFlush = Date.now();
  private stmt: Record<"find" | "insert" | "runCounts", StatementSync>;

  /** `:memory:` gives a throwaway store, for tests. */
  constructor(path = DEFAULT_DB, code = codeVersion()) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.code = code;
    this.db = new DatabaseSync(path);
    // WAL lets several arena processes share the file: readers never block, and
    // writers queue for a few milliseconds each instead of failing.
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 60000;");
    this.db.exec(SCHEMA);
    const v = this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined;
    if (!v) this.db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION));
    else if (Number(v.value) > SCHEMA_VERSION)
      throw new Error(`${path} was written by a newer arena (schema ${v.value}; this one knows ${SCHEMA_VERSION}).`);

    this.stmt = {
      find: this.db.prepare(
        `SELECT winner, vp1, vp2, rounds, activations, branching, hit_cap, checksum FROM games
         WHERE code = ? AND board = ? AND corruption = ?
           AND agent1 = ? AND agent2 = ? AND deploy1 = ? AND deploy2 = ? AND seed = ?`,
      ),
      insert: this.db.prepare(
        `INSERT OR IGNORE INTO games
           (code, board, corruption, agent1, agent2, deploy1, deploy2, seed, set1, set2,
            winner, vp1, vp2, rounds, activations, branching, hit_cap, checksum, ms, run, sweep, subject)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      runCounts: this.db.prepare("UPDATE runs SET played = ?, reused = ? WHERE id = ?"),
    };
  }

  // --- runs ----------------------------------------------------------------

  startRun(command: string, label?: string): number {
    const status = git("status --porcelain");
    const r = this.db
      .prepare(
        `INSERT INTO runs (started, status, command, label, code, git, dirty, node, host)
         VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(), command, label ?? null, this.code,
        git("rev-parse --short HEAD"), status === null ? null : status ? 1 : 0,
        process.version, hostname(),
      );
    this.runId = Number(r.lastInsertRowid);
    return this.runId;
  }

  finishRun(status: "done" | "interrupted" | "failed" = "done") {
    this.flush();
    if (this.runId)
      this.db.prepare("UPDATE runs SET finished = ?, status = ? WHERE id = ?").run(new Date().toISOString(), status, this.runId);
  }

  close() {
    this.flush();
    this.db.close();
  }

  // --- boards and sets -----------------------------------------------------

  boardId(board: BoardFile): number {
    const known = this.boardIds.get(board);
    if (known) return known;
    const hash = boardHash(board);
    const find = () => this.db.prepare("SELECT id FROM boards WHERE hash = ?").get(hash) as { id: number } | undefined;
    if (!find())
      this.db.prepare("INSERT OR IGNORE INTO boards (hash, name, rows) VALUES (?, ?, ?)").run(hash, board.id, JSON.stringify(board.rows));
    const id = find()!.id;
    this.boardIds.set(board, id);
    return id;
  }

  setId(team: string[]): number {
    const key = setKey(team);
    const known = this.setIds.get(key);
    if (known) return known;
    const find = () => this.db.prepare("SELECT id FROM sets WHERE key = ?").get(key) as { id: number } | undefined;
    if (!find()) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const r = this.db
          .prepare("INSERT OR IGNORE INTO sets (key, machines, points) VALUES (?, ?, ?)")
          .run(key, team.length, teamPoints(team));
        if (r.changes) {
          const id = Number(r.lastInsertRowid);
          const copies = new Map<string, number>();
          for (const m of team) copies.set(m, (copies.get(m) ?? 0) + 1);
          const row = this.db.prepare("INSERT INTO set_machines (set_id, machine, copies) VALUES (?, ?, ?)");
          for (const [m, n] of copies) row.run(id, m, n);
        }
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
    const id = find()!.id;
    this.setIds.set(key, id);
    return id;
  }

  /** Read-only lookups, for reports: undefined when nothing has been stored for it. */
  findBoardId(board: BoardFile): number | undefined {
    const row = this.db.prepare("SELECT id FROM boards WHERE hash = ?").get(boardHash(board)) as { id: number } | undefined;
    return row?.id;
  }

  findSetId(team: string[]): number | undefined {
    const row = this.db.prepare("SELECT id FROM sets WHERE key = ?").get(setKey(team)) as { id: number } | undefined;
    return row?.id;
  }

  /** One side's arrangement, stored once, under its key from that side's own seat. */
  arrangementId(deployment: Deployment[], owner: Owner, rows: number, cols: number): number {
    const side = deployment.filter((d) => d.owner === owner);
    const key = arrangementKey(side, owner, rows, cols);
    const known = this.arrangementIds.get(key);
    if (known) return known;
    const setId = this.setId(side.map((d) => d.machineId));
    const find = () => this.db.prepare("SELECT id FROM arrangements WHERE key = ?").get(key) as { id: number } | undefined;
    if (!find()) this.db.prepare("INSERT OR IGNORE INTO arrangements (key, set_id) VALUES (?, ?)").run(key, setId);
    const id = find()!.id;
    this.arrangementIds.set(key, id);
    return id;
  }

  // --- games ---------------------------------------------------------------

  identity(agent1: string, agent2: string, setup: MatchSetup, deployment: Deployment[], seed: number): Identity {
    const rows = setup.board.rows.length, cols = setup.board.rows[0].length;
    return {
      code: this.code,
      board: this.boardId(setup.board),
      corruption: setup.corruption ? 1 : 0,
      agent1,
      agent2,
      deploy1: this.arrangementId(deployment, 1, rows, cols),
      deploy2: this.arrangementId(deployment, 2, rows, cols),
      seed,
    };
  }

  find(id: Identity): GameResult | undefined {
    const pending = this.pendingByKey.get(identityKey(id));
    if (pending) return pending;
    const row = this.stmt.find.get(
      id.code, id.board, id.corruption, id.agent1, id.agent2, id.deploy1, id.deploy2, id.seed,
    ) as Record<string, number | string> | undefined;
    if (!row) return undefined;
    // Same fields in the same order as runGame builds them, so a stored result
    // is indistinguishable from a played one — even serialised.
    return {
      winner: row.winner === 0 ? "draw" : (row.winner as Owner),
      rounds: row.rounds as number,
      vp: { 1: row.vp1 as number, 2: row.vp2 as number },
      activations: row.activations as number,
      branching: row.branching as number,
      hitCap: row.hit_cap === 1,
      checksum: row.checksum as string,
    };
  }

  /**
   * The result of this game: from the store if it has been played under this
   * code version, otherwise played now and stored. The agents deploy first —
   * where the machines start is part of which game this is — and the game is
   * then played from that deployment rather than asking them twice.
   */
  play(p1: Agent, p2: Agent, setup: MatchSetup, seed: number, ctx: GameContext = {}): GameResult {
    const deployment = chooseDeployment(p1, p2, setup, seed);
    const id = this.identity(p1.name, p2.name, setup, deployment, seed);
    const known = this.find(id);
    if (known) {
      this.reused++;
      return known;
    }
    const t0 = performance.now();
    const r = runGame(p1, p2, setup, seed, {}, deployment);
    this.add(id, [this.setId(setup.teams[1]), this.setId(setup.teams[2])], r, performance.now() - t0, ctx);
    return r;
  }

  /** A drop-in PlayFn for playMatch that goes through the store. */
  player(ctx: GameContext = {}): PlayFn {
    return (p1, p2, setup, seed) => this.play(p1, p2, setup, seed, ctx);
  }

  add(id: Identity, sets: [number, number], r: GameResult, ms: number, ctx: GameContext = {}) {
    if (!this.runId) throw new Error("ResultStore.add needs a run: call startRun first.");
    this.pending.push({ id, sets, r, ms, ctx });
    this.pendingByKey.set(identityKey(id), r);
    this.played++;
    if (this.pending.length >= 500 || Date.now() - this.lastFlush > 2000) this.flush();
  }

  /**
   * Write buffered games in one short transaction. Games are played *outside*
   * any transaction, so a process never holds the write lock while it thinks —
   * which is what lets several processes share one file at full speed.
   */
  flush() {
    this.lastFlush = Date.now();
    if (!this.pending.length && !this.runId) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const { id, sets, r, ms, ctx } of this.pending)
        this.stmt.insert.run(
          id.code, id.board, id.corruption, id.agent1, id.agent2, id.deploy1, id.deploy2, id.seed, sets[0], sets[1],
          r.winner === "draw" ? 0 : r.winner, r.vp[1], r.vp[2], r.rounds, r.activations, r.branching,
          r.hitCap ? 1 : 0, r.checksum, ms, this.runId, ctx.sweep ?? null, ctx.subject ?? null,
        );
      if (this.runId) this.stmt.runCounts.run(this.played, this.reused, this.runId);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.pending = [];
    this.pendingByKey.clear();
  }

  // --- reading one game back -------------------------------------------------

  /** Everything needed to replay a stored game — including exactly where it started. */
  game(id: number) {
    const row = this.db
      .prepare(
        `SELECT g.*, b.name AS board_name, b.rows AS board_rows, s1.key AS key1, s2.key AS key2,
                a1.key AS arrangement1, a2.key AS arrangement2
         FROM games g JOIN boards b ON b.id = g.board
         JOIN sets s1 ON s1.id = g.set1 JOIN sets s2 ON s2.id = g.set2
         JOIN arrangements a1 ON a1.id = g.deploy1 JOIN arrangements a2 ON a2.id = g.deploy2
         WHERE g.id = ?`,
      )
      .get(id) as Record<string, string | number | null> | undefined;
    if (!row) return undefined;
    const name = row.board_name as string;
    const rows: string[] = JSON.parse(row.board_rows as string);
    const setup: MatchSetup = {
      board: { id: name, name, description: "", rows },
      teams: { 1: parseSetKey(row.key1 as string), 2: parseSetKey(row.key2 as string) },
      corruption: row.corruption === 1,
    };
    // Keys are in canonical order, so these come out exactly as chooseDeployment made them.
    const side = (key: string, owner: Owner): Deployment[] =>
      parseArrangement(key, rows.length)
        .map((p) => (owner === 1 ? p : turned(p, rows.length, rows[0].length)))
        .map((p) => ({ machineId: p.machineId, owner, row: p.row, col: p.col, facing: p.facing }));
    const deployment = [...side(row.arrangement1 as string, 1), ...side(row.arrangement2 as string, 2)];
    return {
      setup,
      deployment,
      seed: row.seed as number,
      agents: { 1: row.agent1 as string, 2: row.agent2 as string },
      code: row.code as string,
      winner: row.winner as number,
      checksum: row.checksum as string,
    };
  }
}
