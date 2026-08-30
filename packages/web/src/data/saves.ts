import type { BoardFile, GameState } from "@engine";

/**
 * A saved game is the whole engine state plus the board it was played on.
 * The state is a plain object by construction, so JSON round-trips it exactly —
 * no custom serialiser to drift out of step with the engine.
 */
export type SaveFile = {
  version: 1;
  savedAt: string;
  board: BoardFile;
  corruption: boolean;
  state: GameState;
};

const KEY = "ms:save";

export function saveGame(board: BoardFile, corruption: boolean, state: GameState): boolean {
  try {
    const save: SaveFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      board,
      corruption,
      state,
    };
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): SaveFile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as SaveFile;
    return save.version === 1 && save.state?.pieces ? save : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const hasSave = () => loadGame() !== null;
