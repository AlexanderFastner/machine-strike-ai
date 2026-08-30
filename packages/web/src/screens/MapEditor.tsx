import { useState } from "react";
import { Board } from "../board/Board";
import { TERRAIN } from "../board/terrain";
import { saveCustomBoard } from "../data/boards";
import { LEGEND, type BoardFile, type TerrainId } from "../data/machines";

const CODE_FOR: Record<TerrainId, string> = Object.fromEntries(
  Object.entries(LEGEND).map(([code, id]) => [id, code]),
) as Record<TerrainId, string>;

const SIZE = 8;
const BRUSHES = Object.keys(TERRAIN) as TerrainId[];

const blank = (): TerrainId[][] =>
  Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => "grassland" as TerrainId));

type Props = { onDone: () => void; startFrom?: BoardFile };

export function MapEditor({ onDone, startFrom }: Props) {
  const [grid, setGrid] = useState<TerrainId[][]>(() =>
    startFrom
      ? startFrom.rows.map((row) => [...row].map((ch) => LEGEND[ch]))
      : blank(),
  );
  const [brush, setBrush] = useState<TerrainId>("forest");
  const [symmetric, setSymmetric] = useState(true);
  const [name, setName] = useState(startFrom ? `${startFrom.name} copy` : "My board");
  const [saved, setSaved] = useState<string | null>(null);

  function paint(row: number, col: number) {
    setGrid((g) => {
      const next = g.map((r) => [...r]);
      next[row][col] = brush;
      // 180° rotation is the fairness property the generated boards use, so the
      // editor offers the same guarantee rather than leaving it to the eye.
      if (symmetric) next[SIZE - 1 - row][SIZE - 1 - col] = brush;
      return next;
    });
    setSaved(null);
  }

  const rows = grid.map((row) => row.map((id) => CODE_FOR[id]).join(""));
  const chasmInDeployRow = [0, 1, SIZE - 2, SIZE - 1].some((r) => rows[r].includes("C"));
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom";

  const board: BoardFile = {
    id: `custom-${id}`,
    name: name.trim() || "Untitled",
    description: "A board you drew yourself.",
    rows,
  };

  function save() {
    saveCustomBoard(board);
    setSaved(`Saved — "${board.name}" is now in the board list.`);
  }

  async function copyJson() {
    const text = JSON.stringify({ ...board, legend: LEGEND }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setSaved("JSON copied to the clipboard.");
    } catch {
      setSaved("Clipboard unavailable — the board is still saved locally.");
    }
  }

  return (
    <div className="screen wide">
      <h2 className="screen-title">Map editor</h2>

      <div className="deploy">
        <Board grid={grid} scale={64} onTileClick={paint} />

        <aside className="tray">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </label>

          <div className="brushes">
            <span className="tray-title">Terrain</span>
            {BRUSHES.map((id) => (
              <button
                key={id}
                className={`brush${brush === id ? " on" : ""}`}
                onClick={() => setBrush(id)}
              >
                <img src={TERRAIN[id].tile} alt="" draggable={false} />
                <b>{TERRAIN[id].name}</b>
                <span className="mod">
                  {TERRAIN[id].modifier >= 0 ? "+" : ""}
                  {TERRAIN[id].modifier}
                </span>
              </button>
            ))}
          </div>

          <label className="option compact">
            <input
              type="checkbox"
              checked={symmetric}
              onChange={(e) => setSymmetric(e.target.checked)}
            />
            <span>
              <b>Mirror edits</b>
              <em>
                Paints the rotationally opposite tile too, so both players face the same ground.
              </em>
            </span>
          </label>

          {chasmInDeployRow && (
            <p className="warn">
              There is a chasm in a deployment row. Only Swoop machines can stand there, so a set
              without one may be unable to deploy.
            </p>
          )}

          {saved && <p className="ok-note">{saved}</p>}

          <div className="actions wrap">
            <button onClick={() => setGrid(blank())}>Clear</button>
            <button onClick={copyJson}>Copy JSON</button>
            <button className="primary" onClick={save}>
              Save board
            </button>
          </div>
          <div className="actions">
            <button onClick={onDone}>Done</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
