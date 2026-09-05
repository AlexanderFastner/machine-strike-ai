# The arena

Headless match runner for measuring agents against each other. This is the instrument the whole AI stage is
built on: without a trustworthy way to say *"this agent is better than that one, by this much, and here is the
error bar"*, every later result is an anecdote.

```bash
npm run arena -- tournament --pairs 50
npm run arena -- match --a heuristic --b greedy --pairs 50
npm run arena -- bench --agent heuristic --games 20
```

Flags: `--board`, `--team`, `--corruption on|off`, `--seed`, `--pairs`, `--agents a,b,c`.

---

## How a match is run

**Paired games.** Every seed is played twice, once with each agent moving first. First-player advantage then
cancels instead of masquerading as strength, and variance drops for the same number of games. This is verified,
not assumed: `random` against itself scores exactly **50.0%** over 80 paired games.

**A fixed draft book.** Both sides field the identical set, so a match measures play and nothing else. Drafting
is a separate problem — a hidden simultaneous draft is an imperfect-information game sitting on top of the
perfect-information board game, and an agent that drafts well is solving a different problem from one that plays
well. Keeping them apart means a result can only be about play.

**Mirrored deployment.** Both sides deploy in their back rows, rotated 180°, matching the symmetry the boards
themselves guarantee.

**Everything is seeded.** A match is reproducible from its seed; agents take an injected RNG rather than reading
`Math.random`. A result you cannot rerun is a result you cannot debug.

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

`anti` earns its place. If the ladder were measuring noise rather than skill, it would not sit clearly at the
bottom; that it does is evidence the instrument works.

## The ladder

1000 games, 50 pairs per matchup, `plains-and-forests`, standard team, corruption on:

```
agent            elo    ±95%       score   win%
--------------------------------------------------
heuristic       1256     ±78   380.0/400    95.0%
greedy           980     ±39   301.0/400    75.3%
aggressive       698     ±34   219.0/400    54.8%
random             0     ±39   100.0/400    25.0%
anti            -650     ±43     0.0/400     0.0%  *
```

The ordering is what it should be, and the gaps are wide relative to their error bars. The interesting one is
**heuristic beating greedy 75–25**: the difference between them is not search depth — both look exactly one
activation ahead — but *what they value*. Greedy counts damage; heuristic counts position, facing and terrain.
In a game where the defender's Combat Power is entirely terrain and facing, that is worth about 280 Elo.

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

- **An illegal team in the draft book.** The first `varied` set totalled 14 points against a budget of 10, and
  the arena played it without complaint. Teams are now validated at module load, so an illegal set fails loudly
  rather than quietly producing meaningless results.

## Known gaps

- [ ] No tactical puzzle suite — positions with a known best move, as a fast regression check that does not need
      a full tournament.
- [ ] No parallelism. 1000 games takes ~39s single-threaded; worker threads would make overnight runs practical.
- [ ] Results are printed, not stored. Reproducible runs need a results directory with the seed, git SHA and
      agent versions (plan.md §6).
- [ ] Drafting is deliberately excluded. Measuring draft strength needs a separate harness.
- [ ] The agents share the engine's `applyActivation` path — the same one the UI still does *not* use. See
      [testing.md](testing.md) §5.
