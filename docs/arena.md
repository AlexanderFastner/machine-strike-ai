# The arena

Headless match runner for measuring agents against each other. This is the instrument the whole AI stage is
built on: without a trustworthy way to say *"this agent is better than that one, by this much, and here is the
error bar"*, every later result is an anecdote.

```bash
npm run arena -- tournament --pairs 50
npm run arena -- match --a heuristic --b greedy --pairs 50
npm run arena -- bench --agent heuristic --games 20
npm run arena -- record --a heuristic --b greedy
npm run arena -- health --a heuristic --b greedy --games 100
npm run arena -- sweep --agent greedy --sets sample:100 --opponents 5
npm run arena -- report sets --agent greedy
npm run arena -- record --game 1234
npm run arena -- match --a heuristic:deploy=random --b heuristic --pairs 50
```

`record` saves one random tournament game as a replay; `health` measures game-shape metrics over many games.
Both belong to the first experiment in [heuristics.md](heuristics.md), which is where the replay viewer and the
metrics are described.

`sweep` measures *sets* rather than agents — each candidate set against opponents drawn from all 147,106 legal
sets — and `report` reads results back. `match`, `tournament` and `sweep` keep every game in the **results
store**, and answer from it when a game has already been played under the same code; `record --game` turns a
stored result back into a replay. All of that is in [results.md](results.md).

Flags: `--board`, `--team` (a draft-book name, or any set written as a key such as
`burrower:4+grazer:4+scrounger:2`), `--corruption on|off`, `--seed`, `--pairs`, `--agents a,b,c`; and for the
store, `--db <file>`, `--no-store`, `--label <text>`.

---

## How a match is run

**Paired games.** Every seed is played twice, once with each agent moving first. First-player advantage then
cancels instead of masquerading as strength, and variance drops for the same number of games. This is verified,
not assumed: `random` against itself scores exactly **50.0%** over 80 paired games.

**A fixed draft book.** Both sides field the identical set, so a match measures play and nothing else. Drafting
is a separate problem — a hidden simultaneous draft is an imperfect-information game sitting on top of the
perfect-information board game, and an agent that drafts well is solving a different problem from one that plays
well. Keeping them apart means a result can only be about play. Set sweeps turn this around: the same agent
pilots both sides, so the only thing that differs is the sets.

**Deployment is the agent's choice, with a default.** An agent may place its machines anywhere in its own back
two rows, facing any way (rules §8.2), by giving itself a `deploy` method — see [below](#choosing-where-to-start).
An agent without one gets the **default rule**: its set sorted by machine id, centred in its back row and
spilling, centred, into the row in front when a set has more machines than the board is wide, all facing the
enemy. Player 2 is Player 1 rotated 180°, the symmetry the boards themselves guarantee. The default rule replaced
one that filled columns from one edge in the order a team was listed; see
[the finding below](#a-sets-arrangement-changes-results) for what that change did to the ladder, and
[what was caught](#what-was-caught-while-building-this) for why it had to go. Every deployment, chosen or not,
is checked against the rules, because the engine trusts whatever it is given.

**Everything is seeded.** A match is reproducible from its seed; agents take an injected RNG rather than reading
`Math.random`. A result you cannot rerun is a result you cannot debug.

### Choosing where to start

```ts
type Agent = {
  name: string;
  choose(state: GameState, rng: Rng): Activation | null;
  deploy?(view: DeployView, rng: Rng): Placement[];   // optional
};
// view: { owner, grid, corruption, mine, theirs } — the board, its side, the blight setting and both sets
// Placement: { machineId, row, col, facing } — one per machine, in the board's own coordinates
```

- **Both sides deploy at once**, each knowing both sets — the draft is hidden only until deployment — but not
  where the other is placing. The house rule is alternating placement, one machine at a time (rules §8.2). The
  two zones never overlap, so placing blind is a legal way to play the alternating rule: all it gives up is
  reacting to what the opponent has placed. A reactive protocol can come later, if a deployer wants to react.
- **Facing is free**, as the house rule says. (The hot-seat UI still deploys everything facing forward.)
- **An illegal choice fails loudly, naming the agent** — outside its back two rows, off the board, two machines
  on one square, a non-flyer on a chasm, a machine that isn't in its set or one left behind.
- **Choosing draws on dice of its own**, never the game's. An agent that doesn't choose plays exactly the games it
  always did: 40 varied games checked bit for bit, before and after deployment became a choice.
- **Placements are put in a canonical order**, so one arrangement is one game however an agent lists it.

Deployment can also be bolted onto any agent, so a way of starting can be tested — or evolved — with the play
held fixed. `withDeployer(agent, deployer)` in `ai/deploy.ts` does it in code; on the command line an agent's
name takes a `deploy` option:

| Name | Deploys |
|---|---|
| `heuristic` or `heuristic:deploy=centred` | By the default rule |
| `heuristic:deploy=random` | Random squares in the back two rows, random facings — the floor, and a natural first generation for an evolutionary search |
| `heuristic:deploy=burrower@a2E+clawstrider@h1W+…` | Exactly that **arrangement**, written from its owner's seat |

An arrangement is each machine as `machine@square` plus a facing, written from the owner's own seat: rank 1 is
its back row and `N` faces the enemy. So one arrangement means the same from either side of the board, and a
learned arrangement plays from both sides of a paired game. The standard team under the default rule is
`burrower@b1N+clawstrider@c1N+scrounger@d1N+spikesnout@e1N+stalker@f1N`. The results store keys every game on
both sides' arrangements, so two arrangements can never be mistaken for one game ([results.md](results.md)).

**Ratings are fitted, not averaged.** Win rates are not comparable across a tournament — beating a strong agent
60% of the time means more than beating a weak one 60% of the time. The arena fits Bradley–Terry ratings over
all results at once, anchored so `random` = 0, with draws counting half. Agents that score 0% or 100% are
flagged: a clean sweep says the gap is large, not how large.

## The agents

| Agent | What it does |
|---|---|
| `random` | Uniform over legal activations. The floor — anything that cannot beat it is broken, not weak. |
| `aggressive` | Attacks whenever it can; otherwise closes on the nearest enemy. |
| `greedy` | Maximises what a single activation gains — damage and points, minus what it costs. Blind to the reply. |
| `heuristic` | One activation deep, scored by the full evaluation: material, terrain, facing exposure, threat, blight. |
| `anti` | Deliberately picks the *worst* option by that evaluation. Not a contender — a control. |
| `heuristic-facing` | `heuristic` with facing scored against next-turn threats. The subject of [H1](heuristics.md#h1--facing-aware-evaluation) — it takes far fewer weak-side hits and loses to `heuristic`. |

`anti` earns its place. If the ladder were measuring noise rather than skill, it would not sit clearly at the
bottom; that it does is evidence the instrument works.

## The ladder

1000 games, 50 pairs per matchup, `plains-and-forests`, standard team, corruption on, the five agents above
`heuristic-facing`:

```
agent            elo    ±95%       score   win%
--------------------------------------------------
heuristic       1048     ±52   351.0/400    87.8%
greedy           917     ±39   301.0/400    75.3%
aggressive       779     ±35   248.0/400    62.0%
random             0     ±39   100.0/400    25.0%
anti            -678     ±43     0.0/400     0.0%  *
```

The ordering is what it should be, and the gaps are wide relative to their error bars. The interesting one is
**heuristic beating greedy 74–26**: the difference between them is not search depth — both look exactly one
activation ahead — but *what they value*. Greedy counts damage; heuristic counts position, facing and terrain.
In a game where the defender's Combat Power is entirely terrain and facing, that is worth about 180 Elo head to
head (131 on the fitted ladder, which weighs every opponent).

This is the ladder under the current deployment rule. Under the previous one it read heuristic 1256, greedy 980,
aggressive 698 — the same order, with wider gaps. [The finding below](#a-sets-arrangement-changes-results) is
about that difference.

---

## Findings

Things the arena has surfaced that were not obvious from the rules.

### Games are far shorter than the rules imply

Competent agents finish in **4–5 rounds**. The blight needs ~32 rounds to consume the board and the no-blight
fallback is 50. So in agent play, **corruption never happens**: the game is decided long before the endgame
mechanic engages. Turning it off changes results by less than the error bar.

This is not a bug, it follows from the rules as specified. A team is exactly 10 points and 7 wins, so losing
two or three machines loses the game — and machines die fast, because an Attack-4 machine on flat ground deals
4 damage, which one-shots most cheap machines. Random play lasts longer (14.9 rounds) purely because it is bad
at converting.

It matters for two reasons. The evaluation's corruption terms are effectively untested, and any future work on
the blight cannot be validated through agent play. It is also worth checking against the real game: if real
matches last much longer, some rule here is wrong.

### No legal set can field all six machine types

The cheapest machine of each type — Burrower 1, Grazer 1, Charger 2, Longleg 2, Glinthawk 2, Snapmaw 3 —
totals **11 points against a budget of 10**. Every legal team gives up at least one machine type. That is a real
constraint on drafting, and it is invisible until you try to build the set.

### There are 147,106 legal sets

Exactly ten points and at most four of any machine gives **147,106** sets, from a lone Slaughterspine to ten
one-point machines. That is **10.8 billion** distinct pairings. At the ~70 games/s a set sweep sustains on this
machine, playing each pairing once would take ten years per board, so which set is strongest can only ever be
*estimated*, by sampling opponents. `sweep` works that way, and [results.md](results.md) has the design. The count
is frozen in `test/sets.ts` and checked against an independent count, so a roster change that alters it is
noticed rather than absorbed.

23% of those sets have eight or more machines, which the first deployment rule could not place — see
[what was caught](#what-was-caught-while-building-this).

### A set's arrangement changes results

Same agents, same seeds, same board, and the standard team on the same five squares. The only change was the
order of the machines along the back row, when deployment went from *the order the team is listed in* to *sorted
by machine id*. (The engine also lists the pieces in a different order, which changes how agents break ties;
statistically, that alone is the same as reseeding.) The committed code from before the change reproduces the
old ladder exactly, so nothing else moved:

| Matchup, winner's score | Listed order | Sorted |
|---|---|---|
| heuristic vs aggressive | 95% | 77% |
| heuristic vs greedy | 85% | 74% |
| greedy vs aggressive | 86% | 75% |
| `heuristic` over the whole ladder | 95.0% | 87.8% |

Every gap between agents narrowed, heuristic–aggressive by 18 points — about five standard errors, far more
than reseeding moves anything. Where a machine starts, relative to its partners and to the enemy, is worth a lot
even to agents that only look one activation ahead.

Two consequences. The numbers published before the change — the old ladder, and the H0 and H1 results — hold at
the commits they name and won't reproduce at later ones. And a set's score from a sweep is its score *in this
arrangement*: deployment is part of what a set is measured with, which is why the store records the rule with
every game ([results.md](results.md#what-a-result-means-and-what-it-doesnt)).

### Starting positions already matter to `heuristic` — and depend on the board

The default rule was never meant to be good, only fixed. The first test of a chosen deployment asked how much
it costs. The same `heuristic` piloted both sides; one deployed at random, the other by the default rule, with
the standard team:

| Board | Games | Random deployment's score | 95% interval |
|---|---|---|---|
| Plains and Forests | 400 | **60.5%** | 53.6 – 67.0% |
| Mountains | 200 | 43.0% | 33.8 – 52.7% |
| Coastal | 200 | 52.5% | 42.8 – 62.0% |

On Plains and Forests a *random* arrangement beats the default by about ten points; on the other two boards
neither is clearly better. `greedy` shows no effect on Plains and Forests (45% over 100 games). So where a
set starts is worth something even to an agent that looks one activation ahead, and what it is worth depends on
the ground — and that is an average over random arrangements, so the best ones are presumably worth more. This
was a first look, not a registered experiment, but it is the case for searching for better starting positions,
board by board.

### The branching factor is ~230–290 activations per decision

Measured across every match, not estimated. That is the number the plan wanted from Phase 1, and it is
comfortable: alpha-beta over whole activations is viable at this width, and the atomic-action decomposition the
plan describes would narrow it further if depth becomes the constraint.

### Speed

The engine sustains **~685,000 activations/sec** in perft, but a `heuristic` mirror match runs at ~180
activations/sec — because each decision applies and evaluates all ~240 options. The bottleneck is the agent,
not the engine. That reinforces deferring the typed-array conversion: making state transitions faster would not
move this number much, whereas pruning and move ordering would.

---

## What was caught while building this

- **The engine kept playing after a win.** Found while building the replay tooling: a winning activation rolled
  on into the next turn and spread the blight on a finished board. Fixed in the engine — see
  [heuristics.md](heuristics.md), H0 finding 1.
- **An illegal team in the draft book.** The first `varied` set totalled 14 points against a budget of 10, and
  the arena played it without complaint. Teams are now validated at module load, so an illegal set fails loudly
  rather than quietly producing meaningless results.
- **Large sets deployed off the board.** The first deployment rule put machine *i* in column *i* + 1, so the
  eighth machine of a set stood in column 8 of a board numbered 0–7, and Player 2's in column −1. The engine
  trusts its deployment, so the game simply ran with two machines off the board and reported a winner. No
  draft-book team has more than seven machines, so it never fired — but **33,897 legal sets (23%)** have eight
  or more, and a sweep over every set would have stored a corrupt result for each of them without a murmur.
  Found while designing set sweeps, before one ran. Every placement is now checked — on the board, one machine
  per square, no chasm for a machine that can't fly — and `test/sets.ts` deploys all 147,106 sets on every
  board.

## Known gaps

- [ ] No tactical puzzle suite — positions with a known best move, as a fast regression check that does not need
      a full tournament.
- [ ] Tournaments and matches run on one core. Set sweeps split across processes with `--jobs` — 2.2× on this
      machine's two performance and four efficiency cores — but 1000 tournament games still take ~40s.
- [ ] Drafting is deliberately excluded. Measuring draft strength needs a separate harness.
- [ ] The agents share the engine's `applyActivation` path — the same one the UI still does *not* use. See
      [testing.md](testing.md) §5.
- [x] ~~No way to see what actually happens in a game.~~ The replay viewer — [heuristics.md](heuristics.md), H0.
- [x] ~~Results are printed, not stored.~~ Every game is stored with its seed, agents, sets, board, code version
      and git commit, in one SQLite file — [results.md](results.md).
