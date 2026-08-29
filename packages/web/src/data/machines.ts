export * from "@engine";

/** Placeholder sprites, keyed by machine id. Every sprite is drawn facing north. */
const sprites = import.meta.glob("../../../../assets/pieces/placeholder/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export const SPRITE: Record<string, string> = Object.fromEntries(
  Object.entries(sprites).map(([path, url]) => [path.split("/").pop()!.replace(".svg", ""), url]),
);
