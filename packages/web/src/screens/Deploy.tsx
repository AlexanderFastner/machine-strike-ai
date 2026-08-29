import { useState } from "react";
import { Steps } from "./BoardSelect";
import { Board, type PlacedPiece } from "../board/Board";
import { parseBoard, type BoardFile } from "../board/terrain";
import { MACHINE_BY_ID, SPRITE, type Team } from "../data/machines";

type Props = { board: BoardFile; team: Team; onBack: () => void };

/** During deployment every placed piece is tied to a slot in the drafted set. */
type DeployPiece = PlacedPiece & { poolIndex: number };

/** Player 1 deploys in their own back two rows: the bottom two rows of the grid. */
const isDeployRow = (row: number, size: number) => row >= size - 2;

export function Deploy({ board, team, onBack }: Props) {
  const grid = parseBoard(board);
  const size = grid.length;

  const [placed, setPlaced] = useState<DeployPiece[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  const placedIndices = new Set(placed.map((p) => p.poolIndex));
  const remaining = team.map((id, i) => ({ id, i })).filter(({ i }) => !placedIndices.has(i));
  const done = remaining.length === 0;

  function clickTile(row: number, col: number) {
    const here = placed.find((p) => p.row === row && p.col === col);
    if (here) {
      // pick it back up
      setPlaced((ps) => ps.filter((p) => p !== here));
      setSelected(here.poolIndex);
      return;
    }
    if (selected === null || !isDeployRow(row, size)) return;

    setPlaced((ps) =>
      ps.some((p) => p.row === row && p.col === col)
        ? ps
        : [...ps, { machineId: team[selected], row, col, facing: "N", owner: 1, poolIndex: selected }],
    );
    const next = remaining.find(({ i }) => i !== selected);
    setSelected(next ? next.i : null);
  }

  return (
    <div className="screen wide">
      <Steps active={3} />
      <h2 className="screen-title">Deploy your machines</h2>

      <div className="deploy">
        <Board
          grid={grid}
          scale={64}
          pieces={placed}
          highlight={(r) => selected !== null && isDeployRow(r, size)}
          onTileClick={clickTile}
        />

        <aside className="tray">
          <h3 className="tray-title">
            {done ? "All machines deployed" : "Pick a machine, then a highlighted tile"}
          </h3>

          <ul className="pool">
            {remaining.map(({ id, i }) => {
              const m = MACHINE_BY_ID[id];
              return (
                <li key={i}>
                  <button
                    className={`pool-item${selected === i ? " on" : ""}`}
                    onClick={() => setSelected(i)}
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
            {done && <li className="empty">Click a placed machine to pick it up again.</li>}
          </ul>

          <p className="rule-note">
            Machines deploy anywhere in your <b>back two rows</b>. All face north for now — choosing a
            starting facing comes with the turn loop.
          </p>

          <div className="actions">
            <button onClick={onBack}>Back</button>
            {/* Enabled only once the turn loop exists — a button that does nothing is worse
                than one that says so. */}
            <button className="primary" disabled title="The turn loop is not built yet">
              Start game
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
