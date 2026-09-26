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

Flags: `--board` (a name, a comma-separated list, or `all` — the eight boards with terrain; **Flat** is all
grassland and sits out the rotation, though naming it still runs it), `--team` (a draft-book name, or any set written as a key such as
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

## Reading the error bars

Three intervals appear in this project, computed three different ways, because they are asked three different
questions. Every number quoted with a ± or a range comes from one of these.

**1. Experiment matchups** — H0, H1, H1b, H2, and anything in `experiments/`. A normal interval on the mean of
**pair** scores, since the two games of a pair share a seed and an opponent and are not independent of each
other:

```
score  = mean(pairScores)                     each pair scores 0, ¼, ½, ¾ or 1
sd     = sample standard deviation of pairScores, with n − 1 in the denominator
half   = 1.96 × sd / √n                       n = number of pairs, not games
interval = [score − half, score + half]       clamped to [0, 1]
```

So "46.5% (39.5 – 53.5%)" over 200 games means 100 pairs, a sample standard deviation across those 100 pair
scores, and ±1.96 standard errors. It is a *t*-free approximation: at n = 100 the difference from a *t*
interval is under 2% of the half-width, and no entry has fewer than 50 pairs.

**2. Set leaderboards** — `arena report sets`, in [results.md](results.md). A **Wilson score interval**, again
with the pair as the unit:

```
d      = 1 + z²/n
centre = (p + z²/2n) / d
half   = z × √( p(1−p)/n + z²/4n² ) / d
interval = [centre − half, centre + half]     z = 1.96
```

Wilson rather than the normal interval because a leaderboard is full of sets measured over a handful of pairs,
often at 0% or 100%, where the normal interval runs past the ends of the scale or collapses to ±0. Wilson never
does either. A pair's score lies in [0, 1], so its variance is at most p(1−p) whatever the correlation inside
the pair, which makes this interval conservative rather than optimistic.

**3. Elo ratings** — the ladder below. The standard error on the agent's overall score rate, pushed through the
slope of the logistic curve at that rate:

```
se     = √( max(p(1−p), 1/4n) / n )           n = games; the floor keeps a clean sweep finite
slope  = 400 / (ln 10 × max(p(1−p), 0.01))    Elo points per unit of score rate
margin = 1.96 × se × slope                    capped at ±999
```

The slope is why Elo error bars widen near 0% and 100%: the same uncertainty in score rate is worth far more
rating points out there. An agent that scored 0% or 100% is flagged rather than rated — its interval is a
bound, not a measurement.

All three use z = 1.96, the two-sided 95% normal quantile. The code is `matchup()` in each experiment's
`run.ts`, `wilson()` in [report.ts](../packages/arena/src/report.ts), and `fitElo()` in
[elo.ts](../packages/arena/src/elo.ts).

## The agents

| Agent | What it does |
|---|---|
| `random` | Uniform over legal activations. The floor — anything that cannot beat it is broken, not weak. |
| `aggressive` | Attacks whenever it can; otherwise closes on the nearest enemy. |
| `greedy` | Maximises what a single activation gains — damage and points, minus what it costs. Blind to the reply. |
| `heuristic` | One activation deep, scored by the full evaluation: material, terrain, facing exposure, threat, blight. |
| `anti` | Deliberately picks the *worst* option by that evaluation. Not a contender — a control. |
| `heuristic-facing` | `heuristic` with facing scored against next-turn threats. The subject of [H1](heuristics.md#h1--facing-aware-evaluation) — it takes far fewer weak-side hits and loses to `heuristic`. |
| `heuristic-facing-own` | The same, with the half that guards *enemy* facing dropped. [H1b](heuristics.md#h1b--facing-for-own-machines-only) — level with `heuristic` on Plains and Forests, behind it on Mountains and Coastal. |

All seven are playable in the browser: **Play vs AI** on the landing page, where you pick the opponent and one
of the draft-book sets, deploy your own machines against its, and it answers through the same
`applyActivation` path the arena and every test use.

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

Competent agents finish in **4–5 rounds** on the boards this was first measured on. The blight needs ~32 rounds
to consume the board and the no-blight fallback is 50. So in agent play, **corruption usually never happens**:
the game is decided long before the endgame mechanic engages, and turning it off changes results by less than
the error bar. The exception is boards where each player owns high ground — those run three times as long and
the blight does reach them; see [below](#where-the-high-ground-sits-decides-how-long-a-game-lasts).

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

### Where the high ground sits decides how long a game lasts

Adding three boards made a pattern visible that one board could never show. The same `heuristic` on both sides,
standard team, corruption on, 30 games each — point estimates from a single sample, not intervals, which is
enough when the spread is fourfold:

| Board | High ground | Average rounds | Branching |
|---|---|---|---|
| Coastal | none | 4.3 | 215 |
| Mountains | a ridge **between** the players | 4.5 | 249 |
| Plains and Forests | none above forest | 5.7 | 261 |
| Caldera | a rim between them, ringing a chasm | 5.7 | 227 |
| Flat | none | 6.1 | 214 |
| River Valley | a bluff **behind** each player's own river bank | 6.9 | 257 |
| Chasms | none | 9.9 | 162 |
| Split Peaks | a peak in **each player's own** half | 14.5 | 235 |
| Badlands | a spur in **each player's own** half | 16.7 | 189 |

**Peaks in the middle make games short; peaks at home make them long.** Mountains — the board most made of high
ground — is the *fastest* board here, because the ground worth having is the ground between the two sides, so
both walk into the same fight. Split Peaks and Badlands give each player a peak of their own, and both agents
climb their own and stay there: three times the game length, and the blight ends up deciding a share of it.

Checked directly on Badlands, by regenerating it with one feature removed at a time:

| Badlands variant | Average rounds |
|---|---|
| as published | 16.7 |
| chasms → grassland | 17.1 |
| marsh → grassland | 9.9 |
| **the two mountains → grassland** | **7.3** |

The rift is not what slows the board down; two mountains are. Removing six chasm tiles changes nothing, removing
two mountain tiles more than halves the game.

**Corrected by [H4](heuristics.md#h4--the-threat-term-on-high-ground).** This was first written up as a fight
between two weights — high ground pays `terrain` × the tile's modifier, standing in an enemy's reach costs a
flat −5, so the threat term was charging an agent to come down off its own peak. H4 measured that directly and
it is wrong: switching the threat term off entirely leaves Badlands at 14.8 rounds against a 15.4 baseline, and
Split Peaks at 16.8 against 17.3. What keeps an agent on its peak is what **pays** it to sit there, not what
charges it to leave. The stand-off is the `terrain` term on its own.

The two weights do fight, though — just over the score rather than over the clock.
[H4b](heuristics.md#h4b--flat-against-mountains-properly-powered) put `threat=0` on Mountains and on Flat over a
thousand games each: **+13.5** points on the board made of high ground, **+0.0** on the board with no terrain at
all. Where there is height to be paid for, the threat term costs its owner fourteen points; where there is none,
it costs nothing.

Two consequences. Board choice is a bigger lever on a measurement than it looks — a sweep over `all` is
averaging 4-round games with 17-round ones, and the long boards cost ~5× the compute per game. And any
experiment about terrain weights should name its boards in advance, because "is the high ground in the middle
or at home" changes the answer.

### Facing is real, and small: being hit on a weak side costs about four points

Three experiments priced the evaluation's facing term from every side, and the number that settles it is a
control from [H2](heuristics.md#h2--weights-for-a-term-that-now-fires-constantly). An agent with **no facing
term at all** takes **44.5%** of its hits on a weak side — nearly double plain `heuristic`'s 23.6%, five times
what the facing-aware agent allows — and still scores **46.0%** (39.7 – 52.3) against `heuristic`. Doubling how
often you are hit where it hurts most is worth about **four points of score**.

That one number explains the whole line. [H1](heuristics.md#h1--facing-aware-evaluation) built a next-turn
threat map: it worked, cutting weak-side hits from 30.6% to 10.7%, and lost at 28.0%.
[H1b](heuristics.md#h1b--facing-for-own-machines-only) found half of it was imaginary — guarding an enemy's
weak side, which that enemy turns away from before you move again — and recovered twenty points, to level.
H2 then found the weights were already the best of six scales tried. Each entry removed one explanation, and
what they leave is that the term measures something real and small. In a game that ends in five rounds, where
an Attack-4 machine one-shots most cheap machines, **striking first decides more than being struck well.**

The practical consequence: the next gain is depth, not another term (plan.md phase 5). And the same one-line
scale that H2 used would price every other weight the same way — cheap, and worth knowing before anyone tunes
them.

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
