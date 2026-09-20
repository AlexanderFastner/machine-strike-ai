import { useEffect, useMemo, useRef, useState } from "react";
import { AGENTS, agentByName } from "@ms/ai";
import {
  REPLAY_VERSION, TEAMS, describeStep, gameMetrics, mirror, rebuild, recordGame, setKey, square,
  type Effect, type Replay,
} from "@ms/arena";
import { MACHINE_BY_ID, corruptedTiles, type GameState } from "@ms/engine";
import { Board, type PlacedPiece } from "../board/Board";
import { BUILT_IN_BOARDS } from "../data/boards";

const BOARDS = Object.fromEntries(BUILT_IN_BOARDS.map((b) => [b.id, b]));

type Props = { onQuit: () => void };

type Options = { a: string; b: string; board: string; team: string; corruption: boolean };

/** Defaults match `arena tournament`, so a random pick is one of the games it plays. */
const DEFAULTS: Options = {
  a: "heuristic",
  b: "greedy",
  board: "plains-and-forests",
  team: "standard",
  corruption: true,
};

export function ReplayViewer({ onQuit }: Props) {
  const [opts, setOpts] = useState<Options>(DEFAULTS);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [frame, setFrame] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeRow = useRef<HTMLLIElement>(null);

  function generate(seed?: number) {
    setBusy(true);
    setError(null);
    // Yield a frame so "Playing…" paints before the agents start thinking.
    setTimeout(() => {
      const s = seed ?? 1 + Math.floor(Math.random() * 50);
      const aFirst = Math.random() < 0.5;
      const setup = { board: BOARDS[opts.board], teams: mirror(TEAMS[opts.team]), corruption: opts.corruption };
      const A = agentByName(opts.a);
      const B = agentByName(opts.b);
      setReplay(aFirst ? recordGame(A, B, setup, s) : recordGame(B, A, setup, s));
      setFrame(0);
      setBusy(false);
    }, 30);
  }

  async function load(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Replay;
      if (!Array.isArray(parsed.steps)) throw new Error("not a replay file");
      if (parsed.version !== REPLAY_VERSION)
        throw new Error(
          `it is a version ${parsed.version} replay, from an older arena that deployed machines differently. ` +
            `Record it again from its seed.`,
        );
      setReplay(parsed);
      setFrame(0);
      setError(null);
    } catch (e) {
      setError(`Could not load ${file.name}: ${(e as Error).message}`);
    }
  }

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frames = useMemo(() => (replay ? rebuild(replay) : []), [replay]);
  const metrics = useMemo(() => (replay ? gameMetrics(replay, frames) : null), [replay, frames]);
  const report = useMemo(
    () => (replay && frames.length ? describeStep(replay, frames, frame) : null),
    [replay, frames, frame],
  );
  const last = frames.length - 1;

  /** Steps where something was hit or destroyed — what ↑/↓ jump between. */
  const eventful = useMemo(
    () =>
      frames.map(
        (f, i) =>
          i > 0 &&
          (!!replay?.steps[i - 1].activation?.attack ||
            f.state.pieces.length < frames[i - 1].state.pieces.length),
      ),
    [frames, replay],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!replay) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const next = (dir: 1 | -1) => {
        for (let i = frame + dir; i >= 0 && i <= last; i += dir) if (eventful[i]) return i;
        return frame;
      };
      switch (e.key) {
        case "ArrowRight": setFrame((f) => Math.min(last, f + 1)); break;
        case "ArrowLeft": setFrame((f) => Math.max(0, f - 1)); break;
        case "ArrowDown": setFrame(next(1)); break;
        case "ArrowUp": setFrame(next(-1)); break;
        case "Home": setFrame(0); break;
        case "End": setFrame(last); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay, frame, last, eventful]);

  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [frame]);

  if (!replay || !frames.length || !report || !metrics) {
    return (
      <div className="centred">
        <p className="sub">{busy ? "Playing a game…" : error ?? "Loading…"}</p>
      </div>
    );
  }

  const size = replay.setup.board.rows.length;
  const sq = (r: number, c: number) => square(size, r, c);
  const current = frames[frame];
  const before: GameState = frames[Math.max(0, frame - 1)].state;
  const state = current.state;

  // --- what to draw on the board for this step --------------------------------
  const ghosts: PlacedPiece[] = [];
  const damage = new Map<number, { damage: number; lethal: boolean }>();
  const hurt = new Set<string>();
  if (frame > 0) {
    if (report.actor) {
      const [fr, fc] = report.actor.from;
      const [tr, tc] = report.actor.to;
      const actor = before.pieces.find((p) => p.uid === report.actor!.uid);
      if (actor && (fr !== tr || fc !== tc)) ghosts.push({ ...actor, row: fr, col: fc });
    }
    for (const b of before.pieces) {
      const a = state.pieces.find((p) => p.uid === b.uid);
      if (!a) {
        // Where it fell: its position after the activation if it lived that long.
        const lastSeen = current.mid.pieces.find((p) => p.uid === b.uid) ?? b;
        ghosts.push({ ...lastSeen, fallen: true });
        damage.set(b.uid, { damage: b.hp, lethal: true });
        hurt.add(`${lastSeen.row},${lastSeen.col}`);
      } else if (a.hp < b.hp) {
        damage.set(b.uid, { damage: b.hp - a.hp, lethal: false });
        hurt.add(`${a.row},${a.col}`);
      }
    }
  }
  const path = report.actor ? [report.actor.from, report.actor.to] : [];

  const set = <K extends keyof Options>(k: K, v: Options[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const problemsHere = current.problems;

  return (
    <div className="screen replay">
      <header className="replay-head">
        <div>
          <h2 className="screen-title">
            <span className="who p1">{replay.agents[1]}</span> vs{" "}
            <span className="who p2">{replay.agents[2]}</span>
          </h2>
          <p className="sub">
            Seed {replay.seed} · {replay.setup.board.name} ·{" "}
            {setKey(replay.setup.teams[1]) === setKey(replay.setup.teams[2])
              ? `${replay.setup.teams[1].length} machines each`
              : `${replay.setup.teams[1].length} machines against ${replay.setup.teams[2].length}`}{" "}
            ·
            blight {replay.setup.corruption ? "on" : "off"} · {metrics.endedBy} in {metrics.rounds}{" "}
            rounds
          </p>
        </div>
        <div className="actions wrap">
          <button className="primary" onClick={() => generate()} disabled={busy}>
            {busy ? "Playing…" : "Random game"}
          </button>
          <button onClick={() => fileInput.current?.click()}>Load replay file</button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
          />
          <button onClick={onQuit}>Back</button>
        </div>
      </header>

      {error && <p className="warn">{error}</p>}

      <div className="replay-layout">
        {/* ----------------------------------------------------- battle report */}
        <aside className="card-panel report">
          <div className="report-meta">
            {frame === 0
              ? "Before the first move"
              : `Step ${frame} of ${last} · round ${replay.steps[frame - 1].round} · ` +
                `Player ${replay.steps[frame - 1].player} (${replay.agents[replay.steps[frame - 1].player]})`}
          </div>
          <h3 className="report-headline">{report.headline}</h3>

          {problemsHere.length > 0 && (
            <div className="warn">
              <b>Re-execution problem</b>
              {problemsHere.map((p) => (
                <div key={p}>{p}</div>
              ))}
            </div>
          )}

          {frame > 0 && replay.steps[frame - 1].activation && (
            <p className="report-choice">
              Chose 1 of {current.optionCount} legal activations
              {current.attackAvailable && !replay.steps[frame - 1].activation!.attack
                ? " — an attack was available and not taken"
                : ""}
            </p>
          )}

          {report.note && frame === 0 && <p className="report-note">{report.note}</p>}

          {frame > 0 && <Section title="What happened" effects={report.activation.effects} log={report.activation.log} />}
          {report.turnChange && (
            <Section title={report.turnChange.title} effects={report.turnChange.effects} log={report.turnChange.log} />
          )}
          {report.note && frame > 0 && <p className="report-note">{report.note}</p>}

          {frame === 0 && (
            <ul className="effects">
              {state.pieces
                .filter((p) => p.owner === 1)
                .map((p) => (
                  <li key={p.uid} className="effect">
                    {MACHINE_BY_ID[p.machineId].name} — {p.hp} health, on {sq(p.row, p.col)}
                  </li>
                ))}
            </ul>
          )}
        </aside>

        {/* ------------------------------------------------------------- board */}
        <div className="replay-board">
          <Board
            grid={state.grid}
            scale={64}
            pieces={state.pieces}
            corrupted={corruptedTiles(size, state.corruption)}
            ghosts={ghosts}
            preview={damage}
            threatTiles={hurt}
            highlight={(r, c) => path.some(([pr, pc]) => pr === r && pc === c)}
            selectedUid={report.actor?.uid}
          />
          <div className="scrubber">
            <button onClick={() => setFrame(0)} disabled={frame === 0} title="First (Home)">⏮</button>
            <button onClick={() => setFrame(Math.max(0, frame - 1))} disabled={frame === 0} title="Previous (←)">◀</button>
            <input
              type="range"
              min={0}
              max={last}
              value={frame}
              onChange={(e) => setFrame(Number(e.target.value))}
            />
            <button onClick={() => setFrame(Math.min(last, frame + 1))} disabled={frame === last} title="Next (→)">▶</button>
            <button onClick={() => setFrame(last)} disabled={frame === last} title="Last (End)">⏭</button>
          </div>
          <p className="rule-note">
            <kbd>←</kbd> <kbd>→</kbd> one move · <kbd>↑</kbd> <kbd>↓</kbd> previous / next attack · <kbd>Home</kbd>{" "}
            <kbd>End</kbd> first / last. Faded pieces show where a machine started or where one fell.
          </p>
        </div>

        {/* -------------------------------------------------------- side panel */}
        <aside className="tray replay-side">
          <Health metrics={metrics} />

          <ol className="step-list">
            <li className={frame === 0 ? "on" : ""} ref={frame === 0 ? activeRow : undefined}>
              <button onClick={() => setFrame(0)}>
                <span className="n">0</span> start
              </button>
            </li>
            {replay.steps.map((step, i) => {
              const at = frames[i].state;
              const actor = step.activation && at.pieces.find((p) => p.uid === step.activation!.uid);
              const died = frames[i + 1].state.pieces.length < at.pieces.length;
              const bad = frames[i + 1].problems.length > 0;
              const label = !step.activation
                ? "passes"
                : `${actor ? MACHINE_BY_ID[actor.machineId].name : "?"} ${
                    step.activation.dest
                      ? `${sq(actor!.row, actor!.col)}→${sq(step.activation.dest.row, step.activation.dest.col)}`
                      : "holds"
                  }`;
              return (
                <li
                  key={i}
                  className={`${frame === i + 1 ? "on" : ""}${bad ? " bad" : ""}`}
                  ref={frame === i + 1 ? activeRow : undefined}
                >
                  <button onClick={() => setFrame(i + 1)}>
                    <span className="n">{i + 1}</span>
                    <span className={`who p${step.player}`}>P{step.player}</span> {label}
                    {step.activation?.attack && <span className="tag-atk">⚔</span>}
                    {died && <span className="tag-kill">✕</span>}
                  </button>
                </li>
              );
            })}
          </ol>

          <details className="gen-options">
            <summary>Game options</summary>
            <label className="field">
              <span>Agent A</span>
              <select value={opts.a} onChange={(e) => set("a", e.target.value)}>
                {Object.keys(AGENTS).map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Agent B</span>
              <select value={opts.b} onChange={(e) => set("b", e.target.value)}>
                {Object.keys(AGENTS).map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Board</span>
              <select value={opts.board} onChange={(e) => set("board", e.target.value)}>
                {Object.keys(BOARDS).map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Team</span>
              <select value={opts.team} onChange={(e) => set("team", e.target.value)}>
                {Object.keys(TEAMS).map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label className="option compact">
              <input type="checkbox" checked={opts.corruption} onChange={(e) => set("corruption", e.target.checked)} />
              <span><b>Corruption</b></span>
            </label>
            <p className="rule-note">
              A random game picks a seed from 1–50 and a random side to move first — the same games
              <code> arena tournament --pairs 50 </code> plays.
            </p>
          </details>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, effects, log }: { title: string; effects: Effect[]; log: string[] }) {
  return (
    <section className="report-section">
      <h4>{title}</h4>
      {effects.length ? (
        <ul className="effects">
          {effects.map((e, i) => (
            <li key={i} className={`effect ${e.kind}${e.owner ? ` p${e.owner}` : ""}`}>
              {e.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="report-note">No change to the board.</p>
      )}
      {log.length > 0 && (
        <details className="engine-log">
          <summary>Engine log ({log.length})</summary>
          <ul>
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Health({ metrics: m }: { metrics: ReturnType<typeof gameMetrics> }) {
  const aliveIdle = m.idle.filter((x) => x.includes("alive"));
  const rows: [string, string, boolean?][] = [
    ["Re-execution", m.problems.length ? `${m.problems.length} problem(s)` : "exact", m.problems.length > 0],
    ["First attack", m.firstAttackRound ? `round ${m.firstAttackRound}` : "never", !m.firstAttackRound],
    ["Attacks P1 / P2", `${m.attacks[1]} / ${m.attacks[2]}`],
    ["Declined attacks", `${m.declinedAttacks[1]} / ${m.declinedAttacks[2]}`],
    ["Machines lost", `${m.machinesLost[1]} / ${m.machinesLost[2]}`],
    ["Options / decision", m.averageOptions.toFixed(0)],
    ["Passes", String(m.passes), m.passes > 0],
    ["Idle machines", aliveIdle.length ? String(aliveIdle.length) : "none", aliveIdle.length > 0],
    ["Oscillations", String(m.oscillations), m.oscillations > 2],
    ["Sprints / overcharges", `${m.sprints} / ${m.overcharges}`],
    ["Defense breaks", String(m.defenseBreaks)],
    ["Terrain changes", String(m.terrainChanges)],
    ["Blight at end", `${m.blightTiles} / 64`],
  ];
  return (
    <section className="health">
      <h3 className="tray-title">Game health</h3>
      <dl>
        {rows.map(([k, v, flag]) => (
          <div key={k} className={flag ? "flag" : ""}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {aliveIdle.length > 0 && <p className="rule-note">Never activated: {aliveIdle.join("; ")}</p>}
    </section>
  );
}
