import { useState } from "react";
import { Steps } from "./BoardSelect";
import { Board, type PlacedPiece } from "../board/Board";
import { parseBoard, type BoardFile } from "../board/terrain";
import { MACHINE_BY_ID, SPRITE, type Owner, type Team } from "../data/machines";

type Props = {
  board: BoardFile;
  teams: Record<Owner, Team>;
  onDone: (placed: DeployPiece[]) => void;
  onBack: () => void;
};

export type DeployPiece = PlacedPiece & { poolIndex: number };

/** Each player deploys in their own back two rows: P1 at the bottom, P2 at the top. */
const deployRows = (owner: Owner, size: number) =>
  owner === 1 ? [size - 2, size - 1] : [0, 1];

export function Deploy({ board, teams, onDone, onBack }: Props) {
  const grid = parseBoard(board);
  const size = grid.length;

  const [placed, setPlaced] = useState<DeployPiece[]>([]);
  const [selected, setSelected] = useState<{ owner: Owner; i: number } | null>(null);

  const remainingFor = (owner: Owner) =>
    teams[owner]
      .map((id, i) => ({ id, i }))
      .filter(({ i }) => !placed.some((p) => p.owner === owner && p.poolIndex === i));

  const left = { 1: remainingFor(1), 2: remainingFor(2) } as Record<Owner, { id: string; i: number }[]>;

  // Alternate one machine at a time; skip a player who has finished, so the other
  // places all of theirs back to back.
  const turnOwner: Owner = placed.length % 2 === 0 ? 1 : 2;
  const otherOwner: Owner = turnOwner === 1 ? 2 : 1;
  const active: Owner | null =
    left[turnOwner].length > 0 ? turnOwner : left[otherOwner].length > 0 ? otherOwner : null;
  const done = active === null;

  const pool = active === null ? [] : left[active];
  const pick = selected && selected.owner === active ? selected.i : (pool[0]?.i ?? null);

  function clickTile(row: number, col: number) {
    const here = placed.find((p) => p.row === row && p.col === col);
    if (here) {
      setPlaced((ps) => ps.filter((p) => p !== here));
      setSelected({ owner: here.owner, i: here.poolIndex });
      return;
    }
    if (active === null || pick === null) return;
    if (!deployRows(active, size).includes(row)) return;

    const owner = active;
    setPlaced((ps) =>
      ps.some((p) => p.row === row && p.col === col)
        ? ps
        : [
            ...ps,
            {
              machineId: teams[owner][pick],
              row,
              col,
              facing: owner === 1 ? "N" : "S",
              owner,
              poolIndex: pick,
            },
          ],
    );
    setSelected(null);
  }

  return (
    <div className="screen wide">
      <Steps active={3} />
      <h2 className="screen-title">
        {done ? (
          "All machines deployed"
        ) : (
          <>
            <span className={`who p${active}`}>Player {active}</span> — place a machine
          </>
        )}
      </h2>

      <div className="deploy">
        <Board
          grid={grid}
          scale={64}
          pieces={placed}
          highlight={(r) => active !== null && deployRows(active, size).includes(r)}
          onTileClick={clickTile}
        />

        <aside className="tray">
          <p className="turn-note">
            {done
              ? "Click a placed machine to pick it up again."
              : "Players alternate one machine at a time. Once a side is finished, the other places the rest back to back."}
          </p>

          {([1, 2] as Owner[]).map((o) => (
            <div key={o} className="pool-group">
              <h3 className={`tray-title who p${o}`}>
                Player {o} · {left[o].length} left
              </h3>
              <ul className="pool">
                {left[o].map(({ id, i }) => {
                  const m = MACHINE_BY_ID[id];
                  const isNext = active === o && pick === i;
                  return (
                    <li key={i}>
                      <button
                        className={`pool-item${isNext ? " on" : ""}`}
                        disabled={active !== o}
                        onClick={() => setSelected({ owner: o, i })}
                      >
                        <img src={SPRITE[id]} alt="" draggable={false} />
                        <div>
                          <b>{m.name}</b>
                          <span className="stats">
                            {m.health}hp · {m.attack}atk · {m.movement}mov
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
                {left[o].length === 0 && <li className="empty">Deployed.</li>}
              </ul>
            </div>
          ))}

          <div className="actions">
            <button onClick={onBack}>Back</button>
            <button className="primary" disabled={!done} onClick={() => onDone(placed)}>
              Start game
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
