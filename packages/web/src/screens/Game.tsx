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

  const canAct = activatablePieces(state, state.turn);
  const blight = corrupted(state);
  const blightPct = Math.round((blight.size / blightTotal(grid.length)) * 100);
  const selected = state.pieces.find((p) => p.uid === selectedUid) ?? null;
  const selectable = new Set(canAct.map((p) => p.uid));

  const moves = selected && !hasMoved ? movesFor(state, selected) : new Map<string, number>();
  const target = selected ? targetOf(state, selected) : null;

  // Predicted outcome of the attack currently lined up, shown on the board.
  const preview = selected ? previewAttack(state, selected.uid) : null;
  const previewByUid = useMemo(() => {
    const map = new Map<number, { damage: number; lethal: boolean }>();
    if (!preview || !selected) return map;
    for (const h of preview.hits) map.set(h.uid, { damage: h.damage, lethal: h.lethal });
    if (preview.selfDamage > 0)
      map.set(selected.uid, { damage: preview.selfDamage, lethal: preview.selfLethal });
    return map;
  }, [preview, selected]);

  // E rotates the selected machine a quarter turn clockwise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "e" && e.key !== "E") return;
      if (!selected || state.winner) return;
      const next = ALL_FACINGS[(ALL_FACINGS.indexOf(selected.facing) + 1) % 4];
      setState((s) => rotatePiece(s, selected.uid, next));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, state.winner]);

  function selectPiece(uid: number) {
    if (!selectable.has(uid)) return;
    setSelectedUid(uid);
    setHasMoved(false);
  }

  function clickTile(row: number, col: number) {
    const occupant = state.pieces.find((p) => p.row === row && p.col === col);
    if (occupant && occupant.owner === state.turn && occupant.uid !== selectedUid) {
      selectPiece(occupant.uid);
      return;
    }
    if (!selected || hasMoved || !moves.has(key(row, col))) return;
    setState(movePiece(state, selected.uid, row, col));
    setHasMoved(true);
  }

  const rotate = (f: Facing) => selected && setState(rotatePiece(state, selected.uid, f));

  function attack() {
    if (!selected) return;
    // An attack ends the activation (rules 5.4).
    setState(endActivation(attackWith(state, selected.uid), selected.uid));
    setSelectedUid(null);
    setHasMoved(false);
  }

  function finishActivation() {
    if (!selected) return;
    setState(endActivation(state, selected.uid));
    setSelectedUid(null);
    setHasMoved(false);
  }

  // A null activation is illegal: a piece must change tile or attack (rules 5.3).
  // The only exception is a piece with nothing legal to do, which forfeits.
  const stuck = !hasMoved && moves.size === 0 && (!target || target.kind === "none");
  const canEndActivation = hasMoved || stuck;

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
        {selected ? <PieceCard state={state} piece={selected} /> : <div className="card-slot" />}

        <Board
          grid={grid}
          scale={64}
          pieces={state.pieces}
          corrupted={blight}
          powerOf={(p) => combatPowerOf(state, p as never)}
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
