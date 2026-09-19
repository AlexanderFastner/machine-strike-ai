# AI heuristics — experiment design

A running list of heuristics and ideas to test on the AI agents, each with **its own metrics**.

Every entry gets metrics of its own because Elo alone can't tell a good idea from a lucky one. An agent can climb
the ladder for the wrong reason — exploiting a bug, or beating a baseline that has an unrelated weakness — and
the rating looks the same either way. Each experiment therefore names what it expects to change, how that will be
measured, and what result would falsify it.

Tooling shared by every entry: the [arena](arena.md) for ratings, and the **replay viewer and game-health
metrics** built for H0 below.

---

## Template for a new entry

```markdown
## Hn — <short name>

**Question.** What are we trying to find out, in one sentence?
**Hypothesis.** What do we expect, and why?
**Method.** Agents, boards, teams, number of games, seeds.
**Metrics.** What gets measured, what counts as success, and what would falsify the hypothesis.
**Status.** Checklist.
**Results.** Numbers, with error bars, and the commit they were measured at.
**Findings.** What we learned, including anything unexpected.
```

---

## H0 — Are the games real?

**Question.** Are the games the arena plays actually the games we think they are — or is something going wrong
behind the scenes that the ratings are hiding?

**Why first.** Every later entry trusts the arena. If games are degenerate — agents never engaging, rules not
firing, the engine doing something it shouldn't — then every rating built on them is measuring the bug. This
entry is the foundation the rest stand on.

**Method.** Pull a game at random from the ones the arena plays, and watch it move by move with a battle report
of what happened. Then measure the same things across many games so one odd replay can be told apart from a
pattern.

### How to use it

**In the browser** — landing page → **Watch an AI game**. A random game loads straight away.

| Key | |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> | Back or forward one move |
| <kbd>↑</kbd> <kbd>↓</kbd> | Jump to the previous or next attack |
| <kbd>Home</kbd> <kbd>End</kbd> | First or last move |

**Random game** picks a seed from 1–50 and a random side to move first, so it is literally one of the games
`arena tournament --pairs 50` plays. **Game options** changes the agents, board, team and corruption.

**From the command line:**

```bash
npm run arena -- record --a heuristic --b greedy
npm run arena -- health --a heuristic --b greedy --games 100
```

`record` saves a random game to `replays/` (git-ignored — any game can be regenerated from its seed), which
the viewer opens with **Load replay file**. `health` runs the metrics below over many games.

### What the battle report shows

For each move: who acted, where they went, the direction they ended up facing, whether they attacked or
overcharged, and how many legal options they chose from. Then every consequence, in two sections:

1. **What happened** — the effects of the activation itself.
2. **Start of Player N's turn** — what the turn change did afterwards: blight spreading, corruption damage,
   Spray, Whiplash.

Keeping these separate matters. Without it, corruption damage at the start of a turn reads as if the previous
attack caused it.

**The effects are not copied from the engine's log.** They are worked out by comparing the board before and
after the move, so the report is a second, independent account. If the log says *"hits for 3"* and the health
bar moved by 2, the two will visibly disagree instead of one repeating the other. The raw engine log is still
there, collapsed under each section.

On the board: the acting machine's start and end squares are lit, a faded copy marks where it started, damage
shows as red **−N** badges, and destroyed machines stay faded and greyed where they fell.

### Why you can trust what you see

A replay file doesn't store board states — only the setup and every decision made. Viewing one **re-runs the
engine from scratch**, and each step carries a fingerprint (checksum) of the state the original game reached. So
the viewer doesn't just show what happened — it proves the engine *reproduces* it. It checks every step for:

- the state differing from the recording — **the replay has diverged**
- a chosen activation that was not legal in that position
- a different number of legal options than the agent was offered
- a player passing while it had legal moves
- the engine carrying on after the game was already won

Any problem turns that step red in the list and raises a banner in the report. These checks have been seen to
fire: the test suite tampers with recordings on purpose and confirms each one is caught. A detector that has
never been seen to go off proves nothing.

A replay recorded on the command line and opened in the browser re-executes **exactly** — so the Node engine and
the browser engine agree, step for step.

### Metrics

| Metric | What it measures | Healthy | Red flag |
|---|---|---|---|
| **Re-execution** | Replay reproduces the recording at every step | exact | any problem at all |
| **First attack** | Round agents first make contact | round 1–3 | never, or very late — agents are not engaging |
| **Attacks P1 / P2** | Aggression per side | both sides attack | one side never attacks |
| **Declined attacks** | An attack was on offer and not taken | occasional | frequent from `greedy`, which should almost always take them |
| **Machines lost** | Attrition per side | — | pieces vanishing without an attack or blight to explain it |
| **Options per decision** | Real branching factor | ~200–300 | near 0 (something is walling agents in) |
| **Passes** | Turns passed | 0 | any pass made while legal moves existed |
| **Idle machines** | Alive all game, never activated | rare | common — agents are using a fraction of their set |
| **Oscillations** | A machine stepping straight back to where it was | ~0 | frequent — the evaluation has flat spots and the agent is dithering |
| **Sprints / overcharges** | Use of those mechanics | some | zero — the mechanic is effectively dead in agent play |
| **Defense breaks** | Attacks into equal-or-higher Combat Power | — | — (information) |
| **Terrain changes** | Terrain skills firing | depends on the team | zero when the team has terrain skills |
| **Blight at end** | How far corruption got | — | — (information) |
| **How it ended** | 7 VP, elimination, or time | — | hitting the activation cap — not a real ending |

### Status

- [x] Games recorded through the same code path the tournament uses, not a parallel copy
- [x] Replay format: setup plus decisions, with a checksum per step
- [x] Re-execution checks, each tested by tampering on purpose
- [x] Replay viewer in the web app, with arrow-key stepping and a battle report
- [x] Random game from the tournament's own seed range, one click
- [x] Command line: `arena record` and `arena health`
- [x] Command-line recordings re-execute exactly in the browser
- [x] Baseline measured over 100 games
- [ ] Watch a sample of games by eye and note anything the metrics don't capture
- [ ] Repeat the baseline on every board and team, not just the defaults

### Results — baseline

`heuristic` vs `greedy`, 100 games, sides alternating, Plains and Forests, standard team, corruption on:

```
re-execution problems   0
rounds                  4.7 average
first attack            round 1.6 average
options per decision    229
attacks declined        2.7 per game
games with a pass       0 of 100
games with idle machines 56 of 100
oscillations            0.2 per game
sprints / overcharges   6.8 / 2.7 per game
defense breaks          0.1 per game
terrain changes         0.0 per game
blight tiles at end     7.8 of 64
how games ended:        100 of 100 by reaching 7 VP
```

**The short answer: the games are real.** They re-execute exactly, the agents engage early, and every game ends
in a genuine win. But H0 found one real bug and three things that aren't what you'd imagine.

### Findings

**1. The engine kept playing after the game was won — fixed.** Found while designing the battle report, before the
viewer even worked. In 57 of 198 games, after the winning blow landed, the engine rolled straight on into the next
player's turn and spread the blight across a finished board. The score happened not to change in that sample, but
it could have: corruption damage or a Spray kill after the win would have awarded points to a game already
decided. A finished game now stays finished. It has a regression test, and the viewer checks for it on every step.

**2. The heuristic agent doesn't manage its facing.** When moving without attacking, it ends up facing forward
24% of the time, sideways 47%, and backward 29% — statistically what a coin toss gives (25 / 50 / 25). And its
machines are struck on a weak side 30% of the time, barely better than `random`'s 36%.

The cause is in the evaluation: it only scores facing against enemies that can reach a machine *right now*. On
an approach move nothing can reach it yet, so all four facings score the same and the tie is broken at random —
which is how, on move 1 of the first replay watched, a Stalker marched forward and turned its weak back towards
the enemy. **So `heuristic`'s 95% win rate is not coming from facing play at all**, in a game where facing is the
entire defence. That makes it the most obvious thing to test next.

**3. Agents use a fraction of their machines.** In 56 of 100 games, at least one machine stays alive the whole game
and is never activated. With games lasting under five rounds there are only about ten activations per side, so
some concentration is rational — but more than half of all games is high enough to watch for.

**4. Some mechanics never happen with the default team.** Terrain changes: **0.0** per game, because the standard
team has no terrain skills. Defense breaks: 0.1 per game. The blight reaches about 8 of 64 tiles before the game
is over. Any conclusion about those mechanics drawn from default arena games is drawn from almost no data. Testing
them needs teams built around them.

### Candidates this surfaced

Not scheduled — listed so they aren't lost:

- **Facing-aware evaluation** — score facing against enemies that could reach a machine *next turn*, not only
  right now (finding 2). **→ now [H1](#h1--facing-aware-evaluation).**
- **Spreading activations** — does using more of the set win more, or are idle machines a correct choice
  (finding 3)?
- **Mechanic-focused teams** — draft-book sets built around terrain skills, Pull and Swoop, so their effect on
  play can be measured at all (finding 4).

---

## H1 — Facing-aware evaluation

**Question.** Does the heuristic agent get stronger if its evaluation scores facing against the enemies that could
strike a machine *next turn*, instead of only the ones that can strike it from where they stand right now?

**Background.** H0 found that `heuristic` chooses its facing at chance level — 24% forward, 47% sideways, 29%
backward on non-attacking moves, against the 25 / 50 / 25 a coin would give — and that its machines are hit on a
weak side 30% of the time, barely better than `random`'s 36%.

The cause is precise. The facing term in `packages/ai/src/evaluate.ts` counts an enemy only if its attack
envelope *from its current square* already covers the machine. **Movement is not considered.** But movement is 2–4
and range 1–3, so nearly every blow that actually lands comes from a machine that moved first — and the term
cannot see any of them. It is scoring facing against almost none of the threats that matter.

For a one-activation-deep agent, "next turn" is the right horizon: it is exactly the opponent's reply, the only
future this agent can reason about at all.

### The change — one variable

For each of the agent's own machines, work out **every direction it could be struck from next turn**. An enemy
threatens a direction if it can move to a square from which its attack, facing the machine, would connect — using
the real targeting rules, so a Gunner's exact range, friendly pieces blocking a ray and Sweep areas are all
respected. Reach includes sprint squares when the enemy has the 2 health to overcharge, since H0 measured 2.7
overcharges per game — too common to leave as a blind spot.

The existing weights then apply to the side facing each threatened direction: **−8** for a weak side, **+4** for an
armoured one.

**Only the facing term changes.** The weights stay the same, and the separate `threatened` / `threatening` counts
keep using current reach. Making those counts next-turn-aware as well would be a second variable, and a result
could not then say which change caused it. That is a candidate for a later entry, not part of this one.

### Hypothesis

Keeping weak sides away from the machines that are about to arrive should cut weak-side hits sharply and win
games. **30 of the 43 machines have a weak back** — 24 of them armoured in front and weak behind — so the obvious
failure, walking towards the enemy with the back turned, should mostly disappear. Weak-side hits will not reach zero: attacking
locks a machine's facing towards its target, which can turn its back on a second enemy.

### Method

- **New agent** `heuristic-facing`: identical to `heuristic` except for the facing term above.
- **Head-to-head:** `heuristic-facing` vs `heuristic`, 100 paired games (200 total), seeds 1–100. This is the
  primary test.
- **Against the ladder:** each against `greedy`, 100 pairs, so a gain can't be specific to one opponent.
- **Terrain check:** head-to-head repeated on Mountains and Coastal, 50 pairs each — high ground and marsh change
  how much facing matters relative to position.
- **Fixed:** standard team, corruption on, arena defaults otherwise.

### Metrics

Written down before any code or results exist, so the result can't be rationalised afterwards. If it misses these,
it is reported as a miss — the thresholds don't get re-derived.

| Metric | What it measures | Success | Falsified if |
|---|---|---|---|
| **Head-to-head score** (primary) | `heuristic-facing` vs `heuristic`, with 95% interval | lower bound above **50%** | interval includes 50% or sits below it |
| **Weak-side hits suffered** | Share of hits landing on a weak side — the outcome, measured independently of the eval | below **20%** (from 30%) | not clearly below 30% — the term is not doing what it claims |
| **Score vs `greedy`** | No regression elsewhere | at least `heuristic`'s 75% | clearly below it |
| **Facing on approach moves** | Forward / sideways / backward, as in H0 | backward well under 25% | still at chance |
| Declined attacks | A more careful agent may refuse attacks that expose its back | *reported* | — |
| Game length, first attack | Caution can turn into stalling | *reported* | — |
| Decisions per second | The threat map costs time; that matters once search depth depends on it | *reported*; flag if over 10× slower | — |

The weak-side hit rate is the metric to trust, because it is measured from what actually happens in games rather
than from the evaluation's own model of threats. A facing measure computed with the same threat model the agent
uses would partly be grading its own homework.

### How to read the result

| Weak-side hits | Wins | Meaning |
|---|---|---|
| ↓ | ↑ | Facing matters, and a cheap evaluation term captures it. |
| ↓ | flat | Facing matters less than assumed at this strength, or the caution costs tempo elsewhere — check declined attacks and game length. |
| flat | any | **The term isn't working.** Debug before concluding anything: replay a game and check the approach move, the way H0 caught the Stalker. |
| flat | ↑ | The gain came from something other than facing. Find out what before crediting H1. |

### Known simplifications

- **Every enemy is treated as able to strike.** In reality only two machines activate per turn, so the threat map
  is an upper bound. That is a reasonable bias for a defensive term: over-protecting is cheaper than being hit on
  a weak side.
- **Enemies are considered one at a time.** Two can't end on the same square, but the map doesn't model that.
- **This is a stand-in for search.** An alpha-beta agent would find good facing on its own by looking at the
  reply. H1 therefore also measures how much of that value one cheap evaluation term can capture — useful to know
  before paying for depth.

### Implementation notes — written before any results

Three decisions the design's wording left open, settled and committed before the matchups were run:

- **The term stays symmetric.** The design says *"for each of the agent's own machines"*, but the existing facing
  term scores both sides' machines — an enemy showing its weak side is good for you. Scoring only its own
  machines would have deleted half the existing term: a second change. So both sides are scored, against next-turn
  strike directions.
- **One term per direction, not per enemy.** The old term added one exposure term per enemy already in reach. The
  new one adds one per *direction* a blow could come from next turn, as the design specifies — so a weak back
  that three enemies could reach scores −8 once, not −24. Some change in counting comes with moving from "which
  enemies can reach" to "which directions are open"; it is recorded so the result is read with it in mind.
- **Measured weak-side hits with a better instrument.** H0's 30% came from a throwaway script that inferred hits
  from health changes. The permanent metric classifies each blow by re-running the engine's own targeting at the
  moment of the attack, so collision damage and an attacker's own overcharge cost can't be miscounted as a hit on
  a side. The same run re-measures `heuristic`'s baseline with the new instrument, and that is what H1 is
  compared against. The success threshold stays at **below 20%**, as registered.

The threat map is built on the engine's own targeting rules rather than a copy of them — `targetOf` was split so
the same rules can be asked about a hypothetical position. Perft counts were unchanged by the split.

Cost, measured before running: **26 activations/sec against `heuristic`'s 192 — 7.4× slower**, under the 10×
flag.

### Status

- [x] Designed, with success and falsification criteria written before any code or results
- [x] Move facing distribution and weak-side hit rate into `gameMetrics`, so H0's throwaway measurement becomes a
      permanent instrument that H0 and H1 share
- [x] Next-turn threat map in the engine — `strikeDirections()`, with six golden tests
- [x] `heuristic-facing` agent
- [ ] Run the matchups
- [ ] Watch a sample of replays: does the approach move now keep the back away from the enemy?
- [ ] Record results and findings

### Results

Not yet run.

