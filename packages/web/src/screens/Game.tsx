import { PieceToken } from "../board/PieceToken";
import { useEffect, useMemo, useRef, useState } from "react";
import { makeRng, type Agent } from "@ms/ai";
import { Board } from "../board/Board";
import { parseBoard, type BoardFile } from "../board/terrain";
import { PieceCard } from "./PieceCard";
import { saveGame } from "../data/saves";
import {
  FACINGS,
  MACHINE_BY_ID,
  applyActivation,
  ROUND_LIMIT,
  activatablePieces,
  attackWith,
  canOvercharge,
  overchargeAttack,
  payOverchargeCost,
  FACINGS as ALL_FACINGS,
  attackEnvelope,
  blightTotal,
  combatPowerOf,
  corrupted,
  previewAttack,
  endActivation,
  endTurn,
  key,
  movePiece,
  movesFor,
  newGame,
  rotatePiece,
  targetOf,
  type Deployment,
  type Facing,
  type GameState,
  type Owner,
} from "../data/machines";

type Props = {
  board: BoardFile;
  corruption: boolean;
  deployments: Deployment[];
  /** Resume a saved game instead of starting from the deployment. */
  initialState?: GameState;
  /** Playing an agent: it takes this side's turns itself. */
  ai?: { owner: Owner; agent: Agent };
  onQuit: () => void;
};

export function Game({ board, corruption, deployments, initialState, ai, onQuit }: Props) {
  // Only the *starting* grid; terrain is mutable, so everything else reads state.grid.
  const startGrid = useMemo(() => parseBoard(board), [board]);
  const [state, setStateRaw] = useState<GameState>(
    () => initialState ?? newGame(startGrid, deployments, corruption),
  );
  /**
   * Undo is free because every engine transition returns a new state and never
   * mutates the old one — the history is just the states we have already seen.
   */
  const [history, setHistory] = useState<GameState[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const setState = (next: GameState) => {
    setHistory((h) => [...h.slice(-49), state]);
    setStateRaw(next);
  };

  /**
   * Undo steps back one state — but against an agent it steps back past the
   * agent's whole turn, to the last position that was yours. Stopping inside its
   * turn would only hand the move straight back to it.
   */
  function undo() {
    if (history.length === 0 || thinking) return;
    let rest = history;
    let back = rest[rest.length - 1];
    while (ai && rest.length > 1 && back.turn === ai.owner) {
      rest = rest.slice(0, -1);
      back = rest[rest.length - 1];
    }
    setStateRaw(back);
    setHistory(rest.slice(0, -1));
    clearActivation();
  }

  /**
   * The agent's turn. One activation per tick, with a pause between them, so its
   * turn can be watched rather than appearing all at once. It goes through
   * `applyActivation` — the engine path the arena and every test use — rather
   * than the move-by-move path this screen drives for a human.
   */
  const rng = useRef(makeRng(Math.floor(Math.random() * 2 ** 31)));
  const [thinking, setThinking] = useState(false);
  const aiToMove = !!ai && !state.winner && state.turn === ai.owner;

  useEffect(() => {
    if (!ai || !aiToMove) {
      setThinking(false);
      return;
    }
    setThinking(true);
    const id = setTimeout(() => {
      const act = ai.agent.choose(state, rng.current);
      setState(act ? applyActivation(state, act) : endTurn(state));
      setSelectedUid(null);
    }, 500);
    return () => clearTimeout(id);
  }, [ai, aiToMove, state]);

  function save() {
    const ok = saveGame(board, corruption, state);
    setToast(ok ? "Game saved" : "Could not save — storage unavailable");
    setTimeout(() => setToast(null), 2200);
  }
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [hasMoved, setHasMoved] = useState(false);
  /** A destination the player is considering but has not committed to. */
  const [pending, setPending] = useState<{ row: number; col: number } | null>(null);
  /** Sprinting reaches one tile further but forfeits the attack (rules 4.5). */
  const [sprinted, setSprinted] = useState(false);
  /** Overcharge spent this activation: 2 health, paid after the action. */
  const [overcharged, setOvercharged] = useState(false);

  const canAct = activatablePieces(state, state.turn);
  const blight = corrupted(state);
  const blightPct = Math.round((blight.size / blightTotal(state.grid.length)) * 100);
  const selected = state.pieces.find((p) => p.uid === selectedUid) ?? null;
  const selectable = new Set(canAct.map((p) => p.uid));

  const moves = selected && !hasMoved ? movesFor(state, selected, true) : new Map<string, number>();
  const walkMoves = selected && !hasMoved ? movesFor(state, selected) : new Map<string, number>();
  const sprintOnly = useMemo(
    () => new Set([...moves.keys()].filter((k) => !walkMoves.has(k))),
    [moves, walkMoves],
  );

  // While a destination is being considered, everything downstream is computed
  // against the state that move *would* produce — so what the player sees is the
  // real outcome, not an approximation of it.
  const proposed = useMemo(
    () => (selected && pending ? movePiece(state, selected.uid, pending.row, pending.col) : state),
    [state, selected, pending],
  );
  const shown = selected ? (proposed.pieces.find((p) => p.uid === selected.uid) ?? null) : null;

  const target = shown ? targetOf(proposed, shown) : null;
  const preview = selected ? previewAttack(proposed, selected.uid) : null;
  const envelope = shown ? attackEnvelope(proposed, shown) : null;
  const previewByUid = useMemo(() => {
    const map = new Map<number, { damage: number; lethal: boolean }>();
    if (!preview || !selected) return map;
    for (const h of preview.hits) map.set(h.uid, { damage: h.damage, lethal: h.lethal });
    if (preview.selfDamage > 0)
      map.set(selected.uid, { damage: preview.selfDamage, lethal: preview.selfLethal });
    return map;
  }, [preview, selected]);

  // E turns a quarter clockwise; F commits a proposed move; Escape drops it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "u" || (k === "z" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        return undo();
      }
      if (!selected || state.winner || aiToMove) return;
      if (k === "e") {
        const next = ALL_FACINGS[(ALL_FACINGS.indexOf(selected.facing) + 1) % 4];
        setState(rotatePiece(state, selected.uid, next));
      } else if (k === "f" && pending) {
        commitMove();
      } else if (k === "enter" && canEndActivation) {
        finishActivation();
      } else if (k === "u" || (k === "z" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        undo();
      } else if (k === "escape") {
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, pending, state, proposed, overcharged, hasMoved, history]);

  function commitMove() {
    if (!selected || !pending) return;
    setState(proposed);
    if (pendingIsSprint) setSprinted(true);
    setPending(null);
    setHasMoved(true);
  }

  function overcharge() {
    if (!selected || !canOvercharge(selected)) return;
    setOvercharged(true);
  }

  function selectPiece(uid: number) {
    if (!selectable.has(uid)) return;
    setSelectedUid(uid);
    setHasMoved(false);
    setPending(null);
    setSprinted(false);
    setOvercharged(false);
  }

  const clearActivation = () => {
    setSelectedUid(null);
    setHasMoved(false);
    setPending(null);
    setSprinted(false);
    setOvercharged(false);
  };

  function clickTile(row: number, col: number) {
    if (aiToMove) return;
    const occupant = state.pieces.find((p) => p.row === row && p.col === col);
    if (occupant && occupant.owner === state.turn && occupant.uid !== selectedUid) {
      selectPiece(occupant.uid);
      return;
    }
    if (!selected || hasMoved || !moves.has(key(row, col))) return;
    // Propose the move; the player confirms with F once they have seen the outcome.
    setPending({ row, col });
  }

  const pendingIsSprint = !!pending && sprintOnly.has(key(pending.row, pending.col));
  /** Sprinting forfeits the attack unless it is paid for with an overcharge. */
  const attackForfeit = (sprinted || pendingIsSprint) && !overcharged;

  const rotate = (f: Facing) => selected && setState(rotatePiece(state, selected.uid, f));

  function attack() {
    if (!selected || attackForfeit) return;
    // Attacking from a proposed tile commits the move first. An attack ends the
    // activation either way (rules 5.4). An overcharged attack pays its 2 health
    // afterwards, so a killing blow still scores.
    const resolved = overcharged
      ? overchargeAttack(proposed, selected.uid)
      : attackWith(proposed, selected.uid);
    setState(endActivation(resolved, selected.uid));
    clearActivation();
  }

  function finishActivation() {
    if (!selected) return;
    const settled = overcharged ? payOverchargeCost(proposed, selected.uid) : proposed;
    setState(endActivation(settled, selected.uid));
    clearActivation();
  }

  // A null activation is illegal: a piece must change tile or attack (rules 5.3).
  // The only exception is a piece with nothing legal to do, which forfeits.
  const stuck = !hasMoved && !pending && moves.size === 0 && (!target || target.kind === "none");
  const canEndActivation = hasMoved || !!pending || stuck;

  // A turn cannot be passed while any activation is still possible (rules 5.3).
  const mustAct = canAct.length > 0 && state.activationsLeft > 0;

  const machine = selected && MACHINE_BY_ID[selected.machineId];

  return (
    <div className="screen wide">
      <div className="hud">
        <Score state={state} owner={1} label={ai ? (ai.owner === 1 ? ai.agent.name : "You") : undefined} />
        <div className="hud-mid">
          <span className="round">Round {state.round}</span>
          <span className={`turn-badge who p${state.turn}`}>
            {state.winner
              ? "Game over"
              : ai
                ? aiToMove
                  ? `${ai.agent.name} is thinking…`
                  : "Your move"
                : `Player ${state.turn} to move`}
          </span>
          <span className="round">
            {state.activationsLeft} activation{state.activationsLeft === 1 ? "" : "s"} left
          </span>
          {state.corruption.enabled ? (
            <div className="blight-bar" title={`${blight.size} of ${blightTotal(state.grid.length)} tiles corrupted`}>
              <div className="blight-fill" style={{ width: `${blightPct}%` }} />
              <span>Blight {blightPct}%</span>
            </div>
          ) : (
            <span className="round">Round limit {ROUND_LIMIT}</span>
          )}
        </div>
        <Score state={state} owner={2} label={ai ? (ai.owner === 2 ? ai.agent.name : "You") : undefined} />
      </div>

      <div className="game-layout">
        {shown ? <PieceCard state={proposed} piece={shown} /> : <div className="card-slot" />}

        <Board
          grid={proposed.grid}
          scale={64}
          sprintTiles={sprintOnly}
          pieces={pending ? state.pieces : proposed.pieces}
          ghost={pending && selected ? { ...selected, ...pending } : undefined}
          attackTiles={envelope?.tiles}
          threatTiles={envelope?.threats}
          corrupted={blight}
          powerOf={(p) => combatPowerOf(proposed, p as never)}
          preview={previewByUid}
          selectedUid={selectedUid ?? undefined}
          highlight={(r, c) => moves.has(key(r, c))}
          onTileClick={clickTile}
        />

        <aside className="tray">
          {state.winner ? (
            <>
              <h3 className="tray-title">
                {state.winner === "draw" ? "Draw" : `Player ${state.winner} wins`}
              </h3>
              <div className="actions">
                <button onClick={onQuit}>New game</button>
              </div>
            </>
          ) : !selected ? (
            <>
              <h3 className="tray-title">Select a machine to activate</h3>
              <ul className="pool">
                {canAct.map((p) => {
                  const m = MACHINE_BY_ID[p.machineId];
                  return (
                    <li key={p.uid}>
                      <button className="pool-item" onClick={() => selectPiece(p.uid)}>
                        <PieceToken className="thumb" machine={m} owner={p.owner} facing={p.facing} />
                        <div>
                          <b>{m.name}</b>
                          <span className="stats">
                            {p.hp}/{m.health}hp · {m.attack}atk · {m.movement}mov
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              <h3 className="tray-title">{machine!.name}</h3>

              <div className="facing-row">
                <span className="label">Facing</span>
                {FACINGS.map((f) => (
                  <button
                    key={f}
                    className={`facing${selected.facing === f ? " on" : ""}`}
                    onClick={() => rotate(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <div className="target-box">
                {target && target.kind !== "none" && preview ? (
                  <>
                    {preview.hits.map((h) => {
                      const v = state.pieces.find((p) => p.uid === h.uid);
                      return (
                        <div key={h.uid} className="hit-line">
                          <span className={h.lethal ? "kill" : "hit"}>
                            {v ? MACHINE_BY_ID[v.machineId].name : "?"} −{h.damage}
                            {h.lethal ? " (destroyed)" : ""}
                          </span>
                          <em>
                            {h.defenseBreak ? "defense break" : `${h.sideHit} side`}
                          </em>
                        </div>
                      );
                    })}
                    {preview.selfDamage > 0 && (
                      <div className="hit-line">
                        <span className="self">
                          You take −{preview.selfDamage}
                          {preview.selfLethal ? " (destroyed)" : ""}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <span className="miss">
                    {target && target.kind === "none" ? target.reason : "No target"}
                  </span>
                )}
              </div>

              {(sprinted || pendingIsSprint) && (
                <div className={`sprint-note${attackForfeit ? "" : " paid"}`}>
                  <b>Sprinting</b>
                  <span>
                    {attackForfeit
                      ? "One tile further, but no attack this activation — unless you overcharge."
                      : "Overcharged, so the attack is still available."}
                  </span>
                </div>
              )}

              {pending && (
                <div className="confirm-box">
                  <b>Move here?</b>
                  <span>
                    Press <kbd>F</kbd> to confirm, <kbd>Esc</kbd> to cancel.
                  </span>
                  <div className="confirm-actions">
                    <button className="primary" onClick={commitMove}>
                      Confirm
                    </button>
                    <button onClick={() => setPending(null)}>Cancel</button>
                  </div>
                </div>
              )}

              <div className="actions column">
                <button
                  className="primary"
                  disabled={!target || target.kind === "none" || attackForfeit}
                  title={attackForfeit ? "Sprinting forfeits the attack — overcharge to keep it" : undefined}
                  onClick={attack}
                >
                  Attack
                </button>
                <button
                  className={overcharged ? "overcharged" : ""}
                  disabled={overcharged || !canOvercharge(selected)}
                  title={
                    overcharged
                      ? "Already overcharged this activation"
                      : canOvercharge(selected)
                        ? "Spend 2 health — paid after the action resolves"
                        : "Needs at least 2 health"
                  }
                  onClick={overcharge}
                >
                  {overcharged ? "Overcharged −2 ♥" : "Overcharge −2 ♥"}
                </button>
                <button
                  onClick={finishActivation}
                  disabled={!canEndActivation}
                  title={
                    canEndActivation
                      ? undefined
                      : "A machine must move or attack — it cannot stand still"
                  }
                >
                  {stuck ? "Forfeit activation" : "End activation"}
                </button>
              </div>
              <p className="rule-note">
                <kbd>E</kbd> turn · <kbd>F</kbd> confirm a move · <kbd>Enter</kbd> end activation ·{" "}
                <kbd>Esc</kbd> cancel. Blue-outlined tiles are sprint range.
              </p>
            </>
          )}

          <div className="actions wrap">
            <button onClick={undo} disabled={history.length === 0} title="Undo (U)">
              Undo
            </button>
            <button onClick={save} title="Save this game">
              Save
            </button>
            <button onClick={onQuit}>Quit</button>
            {!state.winner && (
              <button
                disabled={mustAct || aiToMove}
                title={mustAct ? "You must use every activation you can" : undefined}
                onClick={() => {
                  setState(endTurn(state));
                  setSelectedUid(null);
                }}
              >
                End turn
              </button>
            )}
          </div>
        </aside>
      </div>

      {toast && <div className="toast">{toast}</div>}

      <ol className="log">
        {state.log.slice(-8).reverse().map((line, i) => (
          <li key={state.log.length - i}>{line}</li>
        ))}
      </ol>
    </div>
  );
}

function Score({ state, owner, label }: { state: GameState; owner: Owner; label?: string }) {
  const alive = state.pieces.filter((p) => p.owner === owner);
  return (
    <div className={`score who p${owner}`}>
      <b>{label ?? `Player ${owner}`}</b>
      <span className="vp">{state.vp[owner]} / 7 VP</span>
      <span className="alive">{alive.length} machines</span>
    </div>
  );
}
