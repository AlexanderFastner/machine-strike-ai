import { useEffect, useMemo, useState } from "react";
import { Board } from "../board/Board";
import { parseBoard, type BoardFile } from "../board/terrain";
import { SPRITE } from "../data/machines";
import { PieceCard } from "./PieceCard";
import {
  FACINGS,
  MACHINE_BY_ID,
  ROUND_LIMIT,
  activatablePieces,
  attackWith,
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
  onQuit: () => void;
};

export function Game({ board, corruption, deployments, onQuit }: Props) {
  const grid = useMemo(() => parseBoard(board), [board]);
  const [state, setState] = useState<GameState>(() => newGame(grid, deployments, corruption));
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [hasMoved, setHasMoved] = useState(false);
  /** A destination the player is considering but has not committed to. */
  const [pending, setPending] = useState<{ row: number; col: number } | null>(null);

  const canAct = activatablePieces(state, state.turn);
  const blight = corrupted(state);
  const blightPct = Math.round((blight.size / blightTotal(grid.length)) * 100);
  const selected = state.pieces.find((p) => p.uid === selectedUid) ?? null;
  const selectable = new Set(canAct.map((p) => p.uid));

  const moves = selected && !hasMoved ? movesFor(state, selected) : new Map<string, number>();

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
      if (!selected || state.winner) return;
      const k = e.key.toLowerCase();
      if (k === "e") {
        const next = ALL_FACINGS[(ALL_FACINGS.indexOf(selected.facing) + 1) % 4];
        setState((s) => rotatePiece(s, selected.uid, next));
      } else if (k === "f" && pending) {
        commitMove();
      } else if (k === "escape") {
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, pending, state.winner, proposed]);

  function commitMove() {
    if (!selected || !pending) return;
    setState(proposed);
    setPending(null);
    setHasMoved(true);
  }

  function selectPiece(uid: number) {
    if (!selectable.has(uid)) return;
    setSelectedUid(uid);
    setHasMoved(false);
    setPending(null);
  }

  function clickTile(row: number, col: number) {
    const occupant = state.pieces.find((p) => p.row === row && p.col === col);
    if (occupant && occupant.owner === state.turn && occupant.uid !== selectedUid) {
      selectPiece(occupant.uid);
      return;
    }
    if (!selected || hasMoved || !moves.has(key(row, col))) return;
    // Propose the move; the player confirms with F once they have seen the outcome.
    setPending({ row, col });
  }

  const rotate = (f: Facing) => selected && setState(rotatePiece(state, selected.uid, f));

  function attack() {
    if (!selected) return;
    // Attacking from a proposed tile commits the move first. An attack ends the
    // activation either way (rules 5.4).
    setState(endActivation(attackWith(proposed, selected.uid), selected.uid));
    setSelectedUid(null);
    setHasMoved(false);
    setPending(null);
  }

  function finishActivation() {
    if (!selected) return;
    setState(endActivation(proposed, selected.uid));
    setSelectedUid(null);
    setHasMoved(false);
    setPending(null);
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
        <Score state={state} owner={1} />
        <div className="hud-mid">
          <span className="round">Round {state.round}</span>
          <span className={`turn-badge who p${state.turn}`}>
            {state.winner ? "Game over" : `Player ${state.turn} to move`}
          </span>
          <span className="round">
            {state.activationsLeft} activation{state.activationsLeft === 1 ? "" : "s"} left
          </span>
          {state.corruption.enabled ? (
            <div className="blight-bar" title={`${blight.size} of ${blightTotal(grid.length)} tiles corrupted`}>
              <div className="blight-fill" style={{ width: `${blightPct}%` }} />
              <span>Blight {blightPct}%</span>
            </div>
          ) : (
            <span className="round">Round limit {ROUND_LIMIT}</span>
          )}
        </div>
        <Score state={state} owner={2} />
      </div>

      <div className="game-layout">
        {shown ? <PieceCard state={proposed} piece={shown} /> : <div className="card-slot" />}

        <Board
          grid={grid}
          scale={64}
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
                        <img src={SPRITE[p.machineId]} alt="" draggable={false} />
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
                  disabled={!target || target.kind === "none"}
                  onClick={attack}
                >
                  Attack
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
                Press <kbd>E</kbd> to turn a quarter clockwise. Rotation is free until you attack;
                moving then attacking ends the activation.
              </p>
            </>
          )}

          <div className="actions">
            <button onClick={onQuit}>Quit</button>
            {!state.winner && (
              <button
                disabled={mustAct}
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

      <ol className="log">
        {state.log.slice(-8).reverse().map((line, i) => (
          <li key={state.log.length - i}>{line}</li>
        ))}
      </ol>
    </div>
  );
}

function Score({ state, owner }: { state: GameState; owner: Owner }) {
  const alive = state.pieces.filter((p) => p.owner === owner);
  return (
    <div className={`score who p${owner}`}>
      <b>Player {owner}</b>
      <span className="vp">{state.vp[owner]} / 7 VP</span>
      <span className="alive">{alive.length} machines</span>
    </div>
  );
}
