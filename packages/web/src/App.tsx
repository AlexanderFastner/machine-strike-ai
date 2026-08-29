import flat from "@data/boards/flat.json";
import { Board, TerrainLegend } from "./board/Board";
import { parseBoard, type BoardFile } from "./board/terrain";

const grid = parseBoard(flat as BoardFile);

export function App() {
  return (
    <main className="shell">
      <header>
        <h1>Machine Strike</h1>
        <p className="sub">Hot-seat player vs player · in development</p>
      </header>

      <section>
        <Board grid={grid} scale={64} />
        <p className="caption">
          <b>{flat.name}</b> — {flat.description}
        </p>
      </section>

      <section>
        <h2>Terrain</h2>
        <TerrainLegend />
      </section>

      <footer>
        <span className="tag">Stage 1 · Phase 1</span>
        <span>board renders · engine not yet wired up</span>
      </footer>
    </main>
  );
}
