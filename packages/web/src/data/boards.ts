import type { BoardFile } from "@engine";

/** Every board file in packages/data/boards is picked up automatically. */
const modules = import.meta.glob("../../../data/boards/*.json", {
  eager: true,
  import: "default",
}) as Record<string, BoardFile>;

const ORDER = ["flat", "plains-and-forests", "coastal", "split-peaks", "mountains", "chasms"];

export const BUILT_IN_BOARDS: BoardFile[] = Object.values(modules).sort(
  (a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id),
);

// --- boards the player has drawn themselves --------------------------------

const CUSTOM_KEY = "ms:custom-boards";

export function customBoards(): BoardFile[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as BoardFile[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomBoard(board: BoardFile) {
  const all = customBoards().filter((b) => b.id !== board.id);
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify([...all, board]));
  } catch {
    /* storage unavailable — the export button is the fallback */
  }
}

export function deleteCustomBoard(id: string) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customBoards().filter((b) => b.id !== id)));
  } catch {
    /* ignore */
  }
}

export const allBoards = () => [...BUILT_IN_BOARDS, ...customBoards()];
export const isCustom = (id: string) => customBoards().some((b) => b.id === id);
