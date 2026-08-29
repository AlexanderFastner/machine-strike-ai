import { useMemo, useState } from "react";
import { Board } from "../board/Board";
import { parseBoard, TERRAIN, type BoardFile } from "../board/terrain";
import { SPRITE } from "../data/machines";
import {
  FACINGS,
  MACHINE_BY_ID,
  activatablePieces,
  attackWith,
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

type Props = { board: BoardFile; deployments: Deployment[]; onQuit: () => void };

export function Game({ board, deployments, onQuit }: Props) {
  const grid = useMemo(() => parseBoard(board), [board]);
  const [state, setState] = useState<GameState>(() => newGame(grid, deployments));
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [hasMoved, setHasMoved] = useState(false);

  const canAct = activatablePieces(state, state.turn);
  const selected = state.pieces.find((p) => p.uid === selectedUid) ?? null;
  const selectable = new Set(canAct.map((p) => p.uid));

  const moves = selected && !hasMoved ? movesFor(state, selected) : new Map<string, number>();
  const target = selected ? targetOf(state, selected) : null;

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
  const terrain = selected && TERRAIN[grid[selected.row][selected.col]];

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
        </div>
        <Score state={state} owner={2} />
      </div>

      <div className="deploy">
        <Board
          grid={grid}
          scale={64}
          pieces={state.pieces}
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
              <h3 className="tray-title">
                {machine!.name} · {selected.hp}/{machine!.health} hp
              </h3>
              <p className="turn-note">
                {machine!.type} · on {terrain!.name} ({terrain!.modifier >= 0 ? "+" : ""}
                {terrain!.modifier}) · CP {machine!.attack + terrain!.modifier}
              </p>

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
                {target && target.kind !== "none" ? (
                  <span className="hit">
                    Target:{" "}
                    {target.kind === "single"
                      ? MACHINE_BY_ID[target.victim.machineId].name
                      : `${target.victims.length} in the lane`}
                  </span>
                ) : (
                  <span className="miss">{target?.reason ?? "No target"}</span>
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
                Rotation is free until you attack. Moving then attacking ends the activation.
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
