import { TERRAIN, type TerrainId } from "./terrain";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

type Props = {
  grid: TerrainId[][];
  /** Rendered tile size in px. Keep it a multiple of 32 — the art is 32x32 pixel art. */
  scale?: 32 | 64 | 96;
};

export function Board({ grid, scale = 64 }: Props) {
  const size = grid.length;

  return (
    <div className="board-wrap" style={{ "--tile": `${scale}px` } as React.CSSProperties}>
      {/* rank labels down the left */}
      <div className="ranks">
        {grid.map((_, r) => (
          <span key={r}>{size - r}</span>
        ))}
      </div>

      <div className="board" role="grid" aria-label="Machine Strike board">
        {grid.map((row, r) =>
          row.map((id, c) => {
            const t = TERRAIN[id];
            return (
              <div
                key={`${r}-${c}`}
                className="tile"
                role="gridcell"
                aria-label={`${FILES[c]}${size - r}, ${t.name}`}
                title={`${FILES[c]}${size - r} · ${t.name} (${t.modifier >= 0 ? "+" : ""}${t.modifier})`}
              >
                <img src={t.tile} alt="" draggable={false} />
              </div>
            );
          }),
        )}
      </div>

      {/* file labels along the bottom */}
      <div className="files">
        {FILES.slice(0, size).map((f) => (
          <span key={f}>{f}</span>
        ))}
      </div>
    </div>
  );
}

export function TerrainLegend() {
  return (
    <div className="legend">
      {(Object.keys(TERRAIN) as TerrainId[]).map((id) => {
        const t = TERRAIN[id];
        return (
          <div key={id} className="legend-item">
            <img src={t.tile} alt="" draggable={false} />
            <div>
              <b>{t.name}</b>
              <span className={t.modifier === 0 ? "mod zero" : t.modifier > 0 ? "mod up" : "mod down"}>
                {t.modifier >= 0 ? "+" : ""}
                {t.modifier}
              </span>
              {t.note && <em>{t.note}</em>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
