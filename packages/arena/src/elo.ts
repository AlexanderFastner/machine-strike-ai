import type { MatchResult } from "./match";

/**
 * Elo from pairwise results, fitted with the Bradley–Terry model.
 *
 * Win rates alone are not comparable across a tournament: beating a strong
 * agent 60% of the time means more than beating a weak one 60% of the time.
 * BT solves for the ratings that best explain every result at once.
 *
 * Draws count as half a win, which is the standard treatment and matters here —
 * random play draws often enough that discarding draws would distort the table.
 */
export type Rating = {
  name: string;
  elo: number;
  /** ±95% interval, from the binomial error on that agent's total score. */
  margin: number;
  games: number;
  score: number; // wins + draws/2
  /** A clean sweep gives no information about the size of the gap, only its sign. */
  unbounded: boolean;
};

export function fitElo(results: MatchResult[], anchor = "random"): Rating[] {
  const names = [...new Set(results.flatMap((r) => [r.a, r.b]))];
  const gamma: Record<string, number> = Object.fromEntries(names.map((n) => [n, 1]));

  const score: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  const played: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  for (const r of results) {
    score[r.a] += r.wins + r.draws / 2;
    score[r.b] += r.losses + r.draws / 2;
    played[r.a] += r.games;
    played[r.b] += r.games;
  }

  // Minorisation–maximisation: converges quickly and cannot diverge.
  for (let iter = 0; iter < 500; iter++) {
    for (const n of names) {
      let denom = 0;
      for (const r of results) {
        if (r.a !== n && r.b !== n) continue;
        const opp = r.a === n ? r.b : r.a;
        denom += r.games / (gamma[n] + gamma[opp]);
      }
      if (denom > 0 && score[n] > 0) gamma[n] = score[n] / denom;
      // An agent that never scored gets a floor rather than a rating of zero,
      // which would be negative infinity in Elo.
      else if (score[n] === 0) gamma[n] = 1e-3;
    }
  }

  const toElo = (g: number) => 400 * Math.log10(g);
  const anchorElo = names.includes(anchor) ? toElo(gamma[anchor]) : 0;

  return names
    .map((name) => {
      const n = played[name];
      const p = n ? score[name] / n : 0.5;
      // Standard error on the score rate, pushed through the logistic slope
      // at that rate. Wide near 0% or 100%, which is honest.
      const se = Math.sqrt(Math.max(p * (1 - p), 1 / (4 * Math.max(n, 1))) / Math.max(n, 1));
      const slope = 400 / (Math.log(10) * Math.max(p * (1 - p), 0.01));
      return {
        name,
        elo: toElo(gamma[name]) - anchorElo,
        margin: Math.min(1.96 * se * slope, 999),
        games: n,
        score: score[name],
        unbounded: n > 0 && (score[name] === 0 || score[name] === n),
      };
    })
    .sort((x, y) => y.elo - x.elo);
}

export function formatTable(ratings: Rating[]): string {
  const w = Math.max(...ratings.map((r) => r.name.length), 5);
  const lines = [
    `${"agent".padEnd(w)}   ${"elo".padStart(7)}  ${"±95%".padStart(6)}   ${"score".padStart(9)}   win%`,
    "-".repeat(w + 40),
  ];
  let anyUnbounded = false;
  for (const r of ratings) {
    const pct = ((r.score / r.games) * 100).toFixed(1);
    if (r.unbounded) anyUnbounded = true;
    lines.push(
      `${r.name.padEnd(w)}   ${r.elo.toFixed(0).padStart(7)}  ${("±" + r.margin.toFixed(0)).padStart(6)}   ` +
        `${(r.score.toFixed(1) + "/" + r.games).padStart(9)}   ${pct.padStart(5)}%` +
        (r.unbounded ? "   *" : ""),
    );
  }
  if (anyUnbounded)
    lines.push(
      "\n  * scored 0% or 100%: the rating is a bound, not a measurement. A clean sweep\n" +
        "    says the gap is large, not how large — play a stronger opponent to place it.",
    );
  return lines.join("\n");
}
