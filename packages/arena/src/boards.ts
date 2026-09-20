/**
 * Every board in packages/data/boards, read from disk — so a new board file is
 * part of `--board all` the moment it exists, with no list to keep in step.
 * Node only: the web app finds the same files with a Vite glob import.
 *
 * Deliberately not part of the results store's code version. A game records
 * the board's *content* (store.ts, boardId), so adding a board — or renaming
 * one — leaves every stored result valid, while editing a board's terrain makes
 * it a different board.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BoardFile } from "@ms/engine";

export const BOARD_DIR = resolve(import.meta.dirname, "../../data/boards");

export const BOARDS: Record<string, BoardFile> = Object.fromEntries(
  readdirSync(BOARD_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(resolve(BOARD_DIR, f), "utf8")) as BoardFile)
    .map((b) => [b.id, b]),
);

/**
 * Boards left out of the rotation: `--board all` skips them, though they are
 * still boards, still in the game, and still run if you name one.
 *
 * **Flat** is all grassland. Terrain is the defender's entire Combat Power, so a
 * board with none of it has no position worth taking and nothing tactical to
 * measure — every result it produces is about combat maths, which the engine's
 * own tests already pin down. It stays as that baseline, and as a neutral grid
 * for tests that want terrain out of the way.
 */
export const NOT_IN_ROTATION = new Set(["flat"]);

/** The boards agent and set experiments rotate over. */
export const ROTATION = Object.keys(BOARDS).filter((id) => !NOT_IN_ROTATION.has(id));

/** `name`, `a,b,c` or `all`. Unknown names fail loudly rather than falling back to a default. */
export function resolveBoards(spec: string): string[] {
  const names = spec === "all" ? ROTATION : spec.split(",").map((s) => s.trim());
  for (const n of names)
    if (!BOARDS[n]) throw new Error(`Unknown board "${n}". Known: ${Object.keys(BOARDS).join(", ")}`);
  return names;
}
