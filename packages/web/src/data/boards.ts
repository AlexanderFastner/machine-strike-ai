import type { BoardFile } from "@engine";

/** Every board file in packages/data/boards is picked up automatically. */
const modules = import.meta.glob("../../../data/boards/*.json", {
  eager: true,
  import: "default",
}) as Record<string, BoardFile>;

/** Roughly gentlest first. A board missing from this list still shows up, at the end. */
const ORDER = [
  "flat", "plains-and-forests", "coastal", "river-valley", "split-peaks",
  "mountains", "caldera", "chasms", "badlands",
];
const rank = (b: BoardFile) => (ORDER.indexOf(b.id) + 1 || ORDER.length + 1);

export const BUILT_IN_BOARDS: BoardFile[] = Object.values(modules).sort((a, b) => rank(a) - rank(b));

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
