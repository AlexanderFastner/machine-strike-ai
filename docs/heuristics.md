# AI heuristics — experiment design

A running list of heuristics and ideas to test on the AI agents, each with **its own metrics**.

Every entry gets metrics of its own because Elo alone can't tell a good idea from a lucky one. An agent can climb
the ladder for the wrong reason — exploiting a bug, or beating a baseline that has an unrelated weakness — and
the rating looks the same either way. Each experiment therefore names what it expects to change, how that will be
measured, and what result would falsify it.

Tooling shared by every entry: the [arena](arena.md) for ratings, and the **replay viewer and game-health
metrics** built for H0 below. Every interval quoted in these entries is ±1.96 standard errors on the mean of
**pair** scores — the formula, and the two others this project uses, are in
[arena.md](arena.md#reading-the-error-bars).

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
  right now (finding 2). **→ tested as [H1](#h1--facing-aware-evaluation): falsified — the term worked, the agent
  lost.**
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
- [x] Run the matchups — 1,000 games, 0 replay problems
- [x] Watch a sample of replays: does the approach move now keep the back away from the enemy? **Yes** — see
      finding 2
- [x] Record results and findings

### Results

**H1 is falsified on its primary criterion.** The facing term does exactly what it was built to do — and the
agent that uses it is worse.

Measured at commit `0835efc`, which holds the implementation and these notes as they stood before the run. Full
per-agent tables: [`experiments/h1-facing/results.md`](../experiments/h1-facing/results.md), regenerated with
`npx tsx experiments/h1-facing/run.ts`.

| Criterion | Registered | Result | Verdict |
|---|---|---|---|
| **Head-to-head score** (primary) | lower bound above 50% | **28.0%** (21.7 – 34.3%), ≈ −164 Elo | **Falsified** |
| **Weak-side hits suffered** | below 20% (from 30%) | **10.7%**, against `heuristic`'s re-measured 30.6% | Met |
| **Score vs `greedy`** | at least 75% | **72.0%** (65.7 – 78.3%) — the control scored 81.0% (75.3 – 86.7%) | Missed |
| **Facing on approach moves** | backward well under 25% | **6%** backward, 66% forward — from 25% / 24% | Met |

Reported, not scored:

| Guard | `heuristic-facing` | `heuristic` |
|---|---|---|
| Attacks declined per game — head-to-head | 5.3 | 4.9 |
| Attacks declined per game — against `greedy` | **3.4** | 1.7 |
| Game length against `greedy` | 5.5 rounds | 4.7 rounds |
| First attack against `greedy` | round 2.0 | round 1.7 |
| Decisions per second | 23–25 | 139–156 — so ~6× slower, under the 10× flag |

Terrain check, head-to-head:

| Board | Score | Weak-side hits: new / old |
|---|---|---|
| Plains and Forests | 28.0% (21.7 – 34.3%) | 10.7% / 30.6% |
| Mountains | 43.0% (33.3 – 52.7%) | 15.2% / 29.8% |
| Coastal | 49.0% (38.7 – 59.3%) | 8.1% / 23.5% |

### Findings

**1. The term works.** Weak-side hits fell by about two-thirds on every board — 30.6% to 10.7% head-to-head, and
under the 20% bar everywhere — and backward facing all but vanished. The model of where blows come from is
sound, which rules out the table's *"the term isn't working"* row: whatever went wrong, it isn't the threat map.

**2. The agent loses anyway — the outcome the reading table didn't list.** Weak-side hits down, wins *down*. The
nearest row was *"↓ / flat — the caution costs tempo elsewhere"*, and this is a stronger version of it: the caution
costs more than the facing gains. The tempo cost is visible in every guard. Games run nearly a round longer, first
contact comes later, and against `greedy` it turns down twice as many attacks. And in head-to-head games it
**took 1,008 hits and landed 725** — in the same games, its opponent out-hit it by 39%. It is protecting its weak
sides from blows it then receives on its other sides, because the time spent turning is time not spent striking.

On H0's replay seed the difference is plain. The old agent turns its Stalker's back to the enemy on move 1, then
attacks on moves 3 and 4. The new one never faces backward — and spends its first four moves repositioning without
a single attack. (The positions diverge after move 1, so that comparison is an illustration, not a controlled
one.)

**3. Terrain shrinks the loss.** On Mountains it scores 43% and on Coastal 49%, and both intervals reach 50%.
Where high ground or marsh already dominates positioning, the facing bias costs less. With 100 games per board,
don't read more into it than that.

### Why — exploratory, not pre-registered

Everything in this section came *after* the results, so it is a hypothesis to test, not a finding.

Across 275 of `heuristic-facing`'s decisions in 24 head-to-head games:

- The facing term accounts for a median **37%** of the difference between the options the agent weighs. It is
  now a major driver of nearly every move.
- Its **enemy half** — rewarding positions from which the agent could hit an *enemy's* weak side next turn —
  **changes the chosen move in 43% of decisions** when dropped.

That enemy half is the one H1's implementation notes chose to keep, arguing symmetry was "one variable". But the
two halves aren't equally real. **The opponent moves next, and turning is free.** A threat against the agent's
own weak side is real: the enemy is about to move and can use it. A threat against an enemy's weak side mostly
isn't: the enemy gets to turn away before the agent's next turn arrives. So nearly half the time, the agent may be
spending its move setting up a threat that will simply be turned away from — instead of hitting something now.

If that's right, **the design's original wording — score the agent's own machines only — was the better design**,
and the implementation note overrode it. That is the most useful thing H1 turned up, and it is the reason the
notes were committed before the run: it is possible to see exactly which decision to question.

### Candidates this surfaced

Not scheduled — listed so they aren't lost:

- **H1b — facing for own machines only.** Drop the enemy half; nothing else changes. Tests the hypothesis above
  directly. If it wins, the lesson is about *which threats are real*, not about facing.
- **Rescale the facing weights.** The −8 / +4 weights were hand-set for a term that rarely fired; next-turn threats
  fire constantly, and the term now drives 37% of decisions. Weight tuning is a separate variable, so it belongs in
  its own entry — and after H1b, so the two effects can be told apart.


---

## H1b — Facing for own machines only

**Question.** Does the facing-aware agent stop losing if it scores only its **own** machines' exposure — dropping
the half of the term that rewards standing where it could strike an *enemy's* weak side next turn?

**Background.** [H1](#h1--facing-aware-evaluation) made the facing term next-turn aware and kept it symmetric,
scoring both sides' machines. The term did what it was built for — weak-side hits fell from 30.6% to 10.7%, and
backward facing on approach moves all but vanished — and the agent lost anyway, scoring 28.0% head to head.

The exploratory analysis afterwards found the enemy half **changes the chosen move in 43% of decisions**, and
argued the two halves are not equally real: **the opponent moves next, and turning is free.** A threat against
the agent's own weak side is one the enemy is about to use; a threat against an enemy's weak side is one that
enemy can simply turn away from before the agent's next turn. So nearly half the time the agent may be spending
its move setting up a threat that evaporates, instead of striking now. H1's implementation notes chose symmetry
deliberately, on the grounds that scoring only its own machines would have been a second variable. This entry
tests whether that choice was the mistake.

### The change — one variable

In `packages/ai/src/evaluate.ts`, the next-turn facing term skips machines that are not the agent's own. The
weights, the threat map, the `threatened` / `threatening` counts and everything else are untouched. Plain
`heuristic`'s current-reach facing term stays symmetric; only the next-turn term changes, so `heuristic-facing`
and the new agent differ by exactly this.

**New agent** `heuristic-facing-own`: `heuristic-facing` with that one line.

### Hypothesis

If the enemy half is what cost H1 its games, dropping it should win them back: **`heuristic-facing-own` beats
`heuristic-facing`**, and the tempo symptoms H1 measured — declining twice as many attacks against `greedy`,
games running a round longer, first contact half a round later — should shrink. Whether it also beats plain
`heuristic` is the open question: that is what decides whether the whole facing-aware line is worth keeping.

Weak-side hits should stay near H1's 10.7%, because the half that produces them is the half being kept.

### Method

- **Primary:** `heuristic-facing-own` vs `heuristic-facing`, 100 paired games (200 total), seeds 1–100.
- **Against plain `heuristic`:** 100 pairs — whether the line is worth keeping at all.
- **Controls, re-measured in the same run:** `heuristic-facing` vs `heuristic` (H1's own primary) and
  `heuristic` vs `greedy`. H1's published numbers were measured under the previous deployment rule, so they are
  not comparable to anything measured now ([arena.md](arena.md#a-sets-arrangement-changes-results)); these two
  matchups rebuild the comparison points under the current code.
- **Against the ladder:** `heuristic-facing-own` vs `greedy`, 100 pairs, so a gain can't be specific to one
  opponent.
- **Terrain check:** against plain `heuristic` on Mountains and Coastal, 50 pairs each, as H1 did.
- **Fixed:** standard team, corruption on, the default deployment rule for both sides — no agent here chooses
  where it starts — and arena defaults otherwise.

### Metrics

Written down before the code exists, so the result can't be rationalised afterwards. A miss is reported as a
miss; the thresholds don't get re-derived.

| Metric | What it measures | Success | Falsified if |
|---|---|---|---|
| **Score vs `heuristic-facing`** (primary) | Whether the enemy half was the problem | lower bound above **50%** | the interval includes 50% or sits below it |
| **Score vs `heuristic`** | Whether facing-awareness is worth keeping | lower bound above **50%** | *reported either way* — this decides the line's future, not H1b's hypothesis |
| **Weak-side hits suffered** | That the half being kept still works | below **20%**, as H1 | at or above 30% — dropping the enemy half broke the term |
| **Score vs `greedy`** | No regression elsewhere | at least the re-measured `heuristic` control | clearly below it |
| Attacks declined, game length, first attack | H1's tempo symptoms | *reported*; expected between `heuristic-facing` and `heuristic` | — |
| Facing on approach moves | As H0 and H1 measured it | *reported* | — |
| Decisions per second | The threat map still costs time | *reported*; flag if over 10× slower than `heuristic` | — |

### How to read the result

| vs `heuristic-facing` | vs `heuristic` | Meaning |
|---|---|---|
| ↑ | ↑ | The enemy half was the problem, and own-side facing is worth having. The lesson is about *which threats are real*. |
| ↑ | flat or ↓ | Dropping it helps, but facing-awareness still costs more tempo than it gains at this depth. |
| flat | ↓ | The enemy half wasn't the problem: the cost is in the caution itself, or in the threat map treating every enemy as able to strike. |
| ↓ | any | The enemy half was earning its place and H1's reading was wrong — the most interesting outcome, and the one to replay games over. |

### Known simplifications

- **Every enemy is still treated as able to strike**, though only two machines activate per turn. H1 inherited
  this and so does H1b; it biases the term toward caution, which is the very thing under suspicion.
- **The games are not in the results store.** This experiment measures per-game metrics — weak-side hits, facing
  on approach moves — that the store does not keep, so the runner plays its own games, as H1's did. They are
  regenerable from `experiments/h1b-own-facing/run.ts`.

### Status

- [x] Designed, with success and falsification criteria written before any code or results
- [x] `heuristic-facing-own` agent, and the one-line evaluation option behind it
- [x] Runner for the matchups above
- [x] Run them — 1,200 games, 0 replay problems
- [x] Record results and findings

### Results

**H1b misses its primary criterion, narrowly — and the controls registered beside it make the case the primary
could not.** Dropping the enemy half is worth about twenty points against a common opponent.

Measured at commit `38364af`, which holds the implementation and these notes as they stood before the run. Full
per-agent tables: [`experiments/h1b-own-facing/results.md`](../experiments/h1b-own-facing/results.md),
regenerated with `node --import tsx experiments/h1b-own-facing/run.ts`.

| Criterion | Registered | Result | Verdict |
|---|---|---|---|
| **Score vs `heuristic-facing`** (primary) | lower bound above 50% | **56.0%** (48.9 – 63.1%) | **Missed** — the bound falls 1.1 points short |
| **Score vs `heuristic`** | lower bound above 50%; reported either way | **50.5%** (44.3 – 56.7%), where `heuristic-facing` scores **30.0%** (23.6 – 36.4%) | Missed, but the line has stopped losing |
| **Weak-side hits suffered** | below 20% | **5.6 – 13.2%** across every matchup, against `heuristic`'s 24.5 – 28.7% | Met |
| **Score vs `greedy`** | at least the re-measured control | **72.5%** (66.4 – 78.6%) against the control's **77.0%** (71.2 – 82.8%) | Below it, intervals overlapping — not *clearly* below |

Reported, not scored, all against plain `heuristic` on Plains and Forests:

| Guard | `heuristic-facing-own` | `heuristic-facing` | `heuristic` |
|---|---|---|---|
| Attacks declined per game | 4.5 | 4.6 | 3.9 – 4.1 |
| Game length | 5.6 rounds | 5.7 rounds | — |
| First attack | round 2.3 | round 2.5 | — |
| Facing on approach — forward / sideways / backward | 71% / 27% / 2% | 69% / 27% / 4% | 26–28% / 46–49% / 25–26% |
| Decisions per second | 22–27 | 23–24 | 138–160 |

Terrain check, against plain `heuristic`:

| Board | Score | Weak-side hits: own / plain |
|---|---|---|
| Plains and Forests | 50.5% (44.3 – 56.7%) | 8.4% / 24.5% |
| Mountains | 38.0% (28.1 – 47.9%) | 13.2% / 24.9% |
| Coastal | 31.0% (22.2 – 39.8%) | 6.6% / 26.9% |

### Findings

**1. The enemy half was costing about twenty points — shown by the controls, not by the primary.** Against a
common opponent, in the same run and on the same seeds, `heuristic-facing` scores **30.0%** (23.6 – 36.4) and
`heuristic-facing-own` scores **50.5%** (44.3 – 56.7). Those intervals are nowhere near each other. Played
directly against one another the same two agents differ by far less — 56.0%, an interval that reaches 48.9% —
so the registered primary settles nothing on its own. Both comparisons point the same way and disagree about
size: two cautious agents appear to blunt each other, and neither presses the advantage its reasoning buys.
That is an observation about the measurement, not an explanation, and it is the reason the controls earned
their place in the design.

**2. The gain was not tempo.** H1's reading was that caution costs time. But H1b declines almost exactly as many
attacks as H1 did (4.5 against 4.6 per game), makes first contact no sooner (round 2.3 against 2.5), and plays
games of the same length (5.6 rounds against 5.7). The tempo symptoms barely moved while the score moved twenty
points. What the enemy half cost was not time but **direction**: it aimed moves at weak sides the opponent
could simply turn away from before this agent moved again — which is what the hypothesis said, and not what
H1's own explanation of the loss said.

**3. Facing-awareness is now free rather than costly, and still not profitable.** Level with plain `heuristic`
on Plains and Forests, for roughly six times the thinking time. The whole of H1's deficit was the enemy half;
what remains is a term that buys a large, real reduction in weak-side hits and no wins.

**4. Terrain decides whether it is worth anything.** Level on Plains, clearly behind on Mountains (38.0%) and
Coastal (31.0%). The term is working on those boards — weak-side hits are just as low, 13.2% and 6.6% — so
where height or marsh dominates position, guarding facing is worth less than what it costs. H1 measured the
opposite pattern, but under the previous deployment rule, so the two cannot be compared.

**5. The weak-side result from H1 holds.** 5.6 – 13.2% of blows land on a weak side, against 24.5 – 28.7% for
plain `heuristic`, and backward facing on approach moves stays at 2 – 5% against 25 – 26%.

### Candidates this surfaced

Not scheduled — listed so they aren't lost:

- **Rescale the facing weights.** Now the obvious next entry, and the one H1 already named: the term is free at
  −8 / +4, so the question is whether weights chosen for a term that fires constantly can make it profitable.
- **Model who can actually strike.** The threat map treats every enemy as able to reach, though only two
  machines activate per turn. That over-caution is the remaining suspect, and it would cut the term's cost too.
- **Why Mountains and Coastal punish it.** Worth watching replays there: the agent may be turning down high
  ground to keep its facing.

---

## H2 — Weights for a term that now fires constantly

**Question.** The facing term scores **−8** for a weak side exposed and **+4** for an armoured one. Those numbers
were hand-set for a term that fired only when an enemy could already reach. It now fires for every direction a
blow could come from next turn. At what scale, if any, does it start winning games rather than merely preventing
weak-side hits?

**Background.** [H1b](#h1b--facing-for-own-machines-only) left the term **free but not profitable**: level with
plain `heuristic` on Plains and Forests (50.5%, 44.3 – 56.7), behind it on Mountains (38.0%) and Coastal (31.0%),
while cutting weak-side hits from ~25% to 5.6 – 13.2%. The term sees something real and the agent does not
convert it. Weights are the obvious suspect: a term that fires perhaps once a game and a term that fires on every
machine every turn do not want the same numbers. Both H1 and H1b named this as the next entry, and deliberately
left it alone so the two effects could be told apart.

### The change — one variable

`evaluate.ts` gains a scale on the two facing weights, applied to both so their **2:1 ratio is untouched**:
`weakSideExposed × k` and `armourPresented × k`. Nothing else moves. `k = 1` is exactly H1b's agent, and `k = 0`
removes facing scoring altogether — with the next-turn term, that leaves an agent with no facing term at all,
which is worth knowing on its own.

Written as `heuristic-facing-own:w=<k>`, so any scale can be run from the command line.

### Method

Two stages, because a search that picks its own winner cannot also be the evidence for it.

- **Search.** `k ∈ {0, 0.25, 0.5, 1, 2, 4}`, each against plain `heuristic`, 100 pairs (200 games), seeds 1–100,
  Plains and Forests, standard team, corruption on. **These numbers select a candidate. They are not evidence
  for it** — the best of six noisy measurements flatters itself, which is the winner's curse
  ([results.md](results.md#successive-halving)).
- **Confirmation.** The selected `k`, and `k = 1` beside it, against plain `heuristic` on **fresh seeds
  1001–1100** (100 pairs each), plus the two head to head over the same fresh seeds. Nothing here shares a game
  with the search.
- **Terrain check.** The selected `k` against `heuristic` on Mountains and Coastal, 50 pairs each, fresh seeds —
  reported, not selected on. H1b lost on both, and a weight that only helps on one board is worth knowing about.
- **Fixed:** the default deployment rule for both sides, arena defaults otherwise.

### Metrics

Registered before the code exists. A miss is reported as a miss.

| Metric | What it measures | Success | Falsified if |
|---|---|---|---|
| **Confirmation: selected `k` vs `heuristic`** (primary) | Whether rescaling makes the term profitable | lower bound above **50%** | the interval includes 50% or sits below it |
| **Confirmation: selected `k` vs `k = 1`** | Whether the win is the rescaling rather than the term | lower bound above **50%** | *reported* |
| **`k = 0` vs `heuristic`** | Whether any facing scoring beats none at all | *reported* — the control that says whether this whole line is worth its cost | — |
| **Weak-side hits across the grid** | The trade the scale is buying | *reported*; expected to climb as `k` falls | — |
| Attacks declined, game length, first attack | H1's tempo symptoms, across the grid | *reported* | — |
| Decisions per second | Unchanged by weights; a check that nothing else moved | *reported* | — |

### How to read the result

| Confirmation vs `heuristic` | Meaning |
|---|---|
| ↑ | The weights were the problem. The term was right all along and priced wrong — and the same question now applies to every other weight. |
| flat | The term is worth about what it costs at any scale: it prevents the hits it claims and they are not what decides these games. Facing goes back in the queue behind search. |
| ↓ | The search found noise. Report it as noise, and treat the grid's own table as the reminder of why the confirmation stage exists. |

A flat result with `k = 0` also flat would be the strongest statement available here: that at one activation of
lookahead, facing scoring of any kind is not what wins.

### Known simplifications

- **The 2:1 ratio is fixed.** Only the scale moves. Tuning weak against armour is a second variable and belongs
  in its own entry — which is what H1 said about this one.
- **The rest of the evaluation is untouched**, though the same argument applies to `threatened` / `threatening`.
- **Tuned against one opponent.** A scale that beats `heuristic` need not beat a stronger agent; the terrain
  check and the `greedy` figure are the only breadth here.
- **This is a grid, not tuning.** Six points, one dimension, chosen by hand. Real weight tuning is the plan's
  Texel-style regression over self-play outcomes (plan.md §5, rung 2), and wants a stronger agent than this.

### Status

- [x] Designed, with success and falsification criteria written before any code or results
- [x] `facingScale` in the evaluation, and `:w=<k>` on any agent that uses it
- [x] Runner for the search, the confirmation and the terrain check
- [x] Run them — 2,000 games, 0 replay problems
- [x] Record results and findings

### Results

**H2 is falsified: no scale beats the weights already there.** The grid picked `w=1` — the unscaled agent — and
on fresh seeds it lands at 46.5%, an interval that still includes 50%. The weights were not what was wrong.

Measured at commit `5118620`. Full tables:
[`experiments/h2-facing-weights/results.md`](../experiments/h2-facing-weights/results.md), regenerated with
`node --import tsx experiments/h2-facing-weights/run.ts`.

The search, which selects and is not evidence — each scale against `heuristic`, seeds 1–100:

| Scale | Score vs `heuristic` | 95% interval | Weak-side hits | Games it played differently from `w=1` |
|---|---|---|---|---|
| `w=0` — no facing term at all | 46.0% | 39.7 – 52.3% | **44.5%** | 200 of 200 |
| `w=0.25` | 27.0% | 21.2 – 32.8% | 17.4% | 200 of 200 |
| `w=0.5` | 40.5% | 33.2 – 47.8% | 13.8% | 186 of 200 |
| **`w=1`** — the weights as they stand | **50.5%** | 44.3 – 56.7% | 8.4% | — |
| `w=2` | 42.5% | 36.7 – 48.3% | 8.0% | 104 of 200 |
| `w=4` | 40.5% | 34.5 – 46.5% | 7.5% | 122 of 200 |

| Criterion | Registered | Result | Verdict |
|---|---|---|---|
| **Confirmation: selected `k` vs `heuristic`** (primary) | lower bound above 50% | `w=1`, **46.5%** (39.5 – 53.5%) on seeds 1001–1100 | **Falsified** |
| **Confirmation: selected `k` vs `k = 1`** | lower bound above 50% | — the grid selected `k = 1`, so there was nothing to confirm it against | Not applicable |
| **`k = 0` vs `heuristic`** | reported | **46.0%** (39.7 – 52.3%), while taking **44.5%** of its hits on a weak side | Reported — see finding 2 |
| **Weak-side hits across the grid** | reported; expected to climb as `k` falls | 7.5% → 44.5% as the scale falls from 4 to 0, monotonically | Reported |
| Decisions per second | reported | 21–25 at every scale, against `heuristic`'s 140–148 | Reported |

Terrain, fresh seeds: **43.0%** (32.2 – 53.8) on Mountains and **41.0%** (30.3 – 51.7) on Coastal — the same
direction H1b found, with intervals that now touch 50%.

### Findings

**1. The weights were not the problem.** Every scale tried is worse than the one that was there, and the one
that was there is level with an agent that has no next-turn facing term at all. The pre-registered reading of a
flat result applies: the term is worth about what it costs at any price, and facing goes back in the queue
behind search. Three entries have now each removed one explanation for H1's loss — the threat map (H1: it
works), the enemy half (H1b: it cost twenty points), and the weights (H2: they were already the best of six).
What is left is the depth.

**2. Weak-side exposure costs far less than it looks.** `w=0` takes **44.5%** of its hits on a weak side —
nearly double plain `heuristic`'s 23.6%, and five times what `w=1` allows — and still scores 46.0% against it.
Doubling the rate at which you are hit where it hurts most is worth about four points of score. That is the
number to weigh against every future facing idea, and it explains H1, H1b and H2 at once: the term measures
something real and small. In a game decided in five rounds by Attack-4 machines one-shotting 1-point machines,
the side that strikes first decides more than the side that is struck well.

**3. A quarter scale is worse than none — in the search.** `w=0.25` scores 27.0% (21.2 – 32.8), below both
`w=0` and `w=0.5`, whose intervals it does not touch. It cuts weak-side hits to 17.4%, so the term is working;
it just pays for the caution without buying enough of the protection. This sits in the search stage, which
selects rather than proves, so it is recorded as an oddity worth a look, not a result.

**4. The scale changes fewer games as it rises.** `w=0` and `w=0.25` change every game against `heuristic`;
`w=2` changes 104 of 200 and `w=4` changes 122. Beyond about `w=1` the term already wins the comparisons it is
going to win, and multiplying it changes only which of the remaining close calls flip. A weight has a ceiling
past which it stops buying decisions.

### Candidates this surfaced

- **Depth, not terms.** Three entries have priced the facing term from every side and it stays small. The plan's
  next rung — alpha-beta with this evaluation — is where the answer now is (plan.md phase 5).
- **Price the other weights the same way.** `w=0` cost four points; the same one-line scale on `threatened` /
  `threatening`, or on `terrain`, would say what each term is actually worth. Cheap, and it would tell us which
  terms a tuner should bother with.
- **Why a quarter scale is worst.** Finding 3, if it survives a confirmation run.

---

## H3 — What each term is worth

**Question.** [H2](#h2--weights-for-a-term-that-now-fires-constantly) priced one term by switching it off: an
agent with no facing scoring takes nearly double the weak-side hits and loses about four points of score. Every
other weight in the evaluation was hand-guessed the same way and has never been priced at all. What is each one
actually worth?

**Why now.** The evaluation has seven groups of weights and one of them has been measured. Before anyone tunes
them — the plan's Texel-style regression (plan.md §5) — or carries them into a deeper search, it is worth
knowing which ones carry the agent and which are decoration. It is also the cheapest experiment left: the
machinery is the scale H2 already added, widened from one term to all of them.

### The change — one knob per term

`evaluate.ts` takes a scale per **term group**, defaulting to 1, so a term can be switched off or amplified
without touching the rest:

| Term | Weights | What it says |
|---|---|---|
| `vp` | `victoryPoint` 100 | Victory points, the win condition |
| `health` | `health` 6 | Health, scaled by what the machine is worth |
| `terrain` | `terrain` 4 | Where a machine stands — the defender's whole Combat Power |
| `threat` | `threatened` −5, `threatening` 3 | Who is in whose reach right now |
| `facing` | `weakSideExposed` −8, `armourPresented` 4 | Which side is turned toward the threat |
| `blight` | `inBlight` −25 | Standing in corruption |
| `advance` | `advance` 1 | The pull toward the enemy that stops agents shuffling |

Written as `heuristic:terrain=0` or `heuristic:threat=2`; `w=` stays as the alias for `facing=` that H2 used.

### Method

- **Each term at 0**, one at a time, against plain `heuristic`: 100 pairs (200 games), seeds 1–100, Plains and
  Forests, standard team, corruption on. The cost of a term is 50% minus that score.
- **Each term at 2**, the same way — a term can be priced too low as easily as too high.
- **Terrain check** on `terrain` and `threat` at 0, on Mountains and Coastal, 50 pairs each. Chosen before the
  run because those boards differ in exactly what the `terrain` term scores, with `threat` as the contrast; not
  chosen after seeing which terms mattered.
- **Fixed:** the default deployment rule, arena defaults otherwise.

Intervals are ±1.96·sd/√n over pair scores, the experiment formula in
[arena.md](arena.md#reading-the-error-bars).

### Metrics

| Metric | What it measures | Reported as | Falsified if |
|---|---|---|---|
| **Cost of each term** (14 measurements) | What the evaluation loses without it, or with twice as much of it | score against `heuristic`, with its interval | — |
| **A term is worth something** | — | its interval excludes 50% | — |
| **One term costs more than another** | — | only claimed when their intervals don't overlap | — |
| **`vp=0` is catastrophic** | That the instrument works at all | *expected far below 50%* | **if `vp=0` scores near 50%, the run is broken** and nothing else in it is evidence |
| Weak-side hits, rounds, declines | Whatever each term changes about the shape of a game | *reported* | — |

**No term is selected and nothing is confirmed**, because nothing is being chosen: this entry measures fourteen
things and reports fourteen numbers. That is also its weakness — fourteen intervals at 95% will contain roughly
one that looks real and isn't, which is why an ordering between two terms is only claimed when their intervals
are clear of each other.

### Hypotheses, written before the run

Recorded so the surprises are visible as surprises:

1. `vp=0` is catastrophic — it is the win condition.
2. `health=0` is the next most expensive: material is most of what a one-ply agent can see.
3. `terrain=0` costs real points, since terrain is the defender's entire Combat Power, and costs **more on
   Mountains** than on Plains.
4. `advance=0` costs more than it looks: H0 found agents that cannot see a capture just shuffle.
5. `facing=0` and `blight=0` cost little — H2 priced facing at about four points, and H0 found the blight
   never arrives in a five-round game.
6. Nothing gains from being doubled.

### Status

- [x] Designed, with the hypotheses and the instrument check written before any code or results
- [x] A scale per term in the evaluation, and the options that reach it
- [x] Runner
- [x] Run it — 3,200 games, 0 replay problems
- [x] Record results and findings

### Results

**The instrument check passes:** an agent that cannot see victory points scores **17.0%** (12.1 – 21.9). So the
rest of the run counts.

**Two terms carry the evaluation and the other five are nearly free.** Measured at commit `1e3a982`; full tables
in [`experiments/h3-term-prices/results.md`](../experiments/h3-term-prices/results.md). Every interval is
±1.96·sd/√n over pair scores ([arena.md](arena.md#reading-the-error-bars)).

| Term | Off (`=0`) | Doubled (`=2`) | What removing it costs |
|---|---|---|---|
| `vp` | **17.0%** (12.1 – 21.9) | 50.0% — *changed no game* | **33 points** |
| `health` | **22.0%** (16.7 – 27.3) | 55.0% (49.7 – 60.3) | **28 points** |
| `terrain` | 44.0% (37.1 – 50.9) | 52.0% (45.6 – 58.4) | 6 points |
| `facing` | 46.0% (39.7 – 52.3) | 47.0% (42.6 – 51.4) | 4 points |
| `threat` | 49.0% (44.2 – 53.8) | 51.5% (45.8 – 57.2) | 1 point |
| `advance` | 49.0% (42.6 – 55.4) | 55.5% (48.8 – 62.2) | 1 point |
| `blight` | 49.5% (48.5 – 50.5) | 50.0% — *changed no game* | ½ point |

Terrain check, on the two boards chosen before the run:

| Term | Mountains | Coastal |
|---|---|---|
| `terrain=0` | 39.0% (29.6 – 48.4) — costs 11 | 51.0% (41.1 – 60.9) — costs nothing |
| `threat=0` | **69.0%** (60.7 – 77.3) — **gains 19** | 50.0% (42.6 – 57.4) — costs nothing |

Hypotheses, as registered: **1 ✓** (vp catastrophic), **2 ✓** (health next), **3 ✓** (terrain real, and dearer on
Mountains), **4 ✗** (advance was supposed to cost more than it looks; it costs a point), **5 ✓** (facing and
blight cheap), **6 ✗** — two terms appear to *gain* from doubling, though neither interval is clear of 50%.

### Findings

**1. The evaluation is two terms wearing five more as decoration.** Victory points are worth 33 points of score
and health 28; nothing else reaches 7. A one-activation agent is, near enough, a material counter — which is
exactly what `greedy` is, and `heuristic` beats `greedy` 74–26, so the decoration is not worthless. But it is
priced in single digits, and that is the backdrop for H1, H1b and H2 all failing to find wins in the facing
term. There were not many wins there to find.

**2. The threat term is actively harmful on Mountains — worth 19 points.** Switching it off scores **69.0%**
(60.7 – 77.3), the largest effect any entry here has produced, and in the direction nobody looks for: a term
that costs its own agent nineteen points. The likely mechanism is a fight between weights. `threatened` is a
flat −5 for standing in an enemy's reach, while high ground is worth `terrain` × the tile's modifier — +12 on a
mountain. On a board made of high ground, the agent is being paid to abandon the squares that win the game,
because something can reach them. That is a hypothesis, formed after the fact; it is the next thing to test.

**3. Two weights look too low: health and advance.** Doubling health scores 55.0% (49.7 – 60.3) and doubling the
advance pull 55.5% (48.8 – 62.2). Both intervals still touch 50%, so **neither is established** — this is the
kind of near-miss that a fourteen-measurement run is expected to produce by chance, which is why the design
refused to select anything. Both deserve a confirmation entry on fresh seeds before anyone believes them.

**4. The blight term is free to delete, and a scale that changes nothing says so exactly.** `blight=2` and
`vp=2` each produced 50.0% with a zero-width interval — the signature of two agents that play identically, since
every pair splits 1–1. Checked directly rather than inferred: both play **40 of 40** games identically to plain
`heuristic`, and `blight=0` plays 39 of 40. H0 found the blight never arrives in a five-round game; this prices
that at half a point. `vp=2` changing nothing is a different story: victory points already dominate every
comparison they enter, so multiplying them cannot change an ordering.

**5. `facing=0` reproduces H2's number exactly.** 46.0% here, 46.0% there, on the same seeds through a different
runner — a consistency check on the two experiment harnesses rather than new evidence.

### Candidates this surfaced

- **[H4 — the threat term on high ground](#h4--the-threat-term-on-high-ground).** Confirm finding 2 on fresh
  seeds, then test whether it is the −5 flat penalty fighting the terrain bonus, by scaling `threatened` alone
  rather than the pair. **Registered below.**
- **Confirm the two underweights.** `health=2` and `advance=2` on fresh seeds, as their own entry, since H3
  refused to select them.
- **Delete `inBlight`,** or keep it only for games that reach the blight. It costs half a point and the
  evaluation is shorter without it.

---

## H4 — The threat term on high ground

**Question.** [H3](#h3--what-each-term-is-worth) found that switching the `threat` term off scores **69.0%**
(60.7 – 77.3) on Mountains: a term that costs its own agent nineteen points, the largest effect any entry here
has produced and the only one pointing backwards. Is it real, which half of the term does it, and does the harm
track how much high ground the board has?

**Why now.** Three new boards made the same effect visible as *behaviour* rather than as a score. On boards
where each player owns a peak, both agents climb their own and stay there, and games run three times as long;
regenerating Badlands without its two mountains halves the game length, while removing six chasm tiles changes
nothing ([arena.md](arena.md#where-the-high-ground-sits-decides-how-long-a-game-lasts)). So there is now a
family of boards to test a mechanism against instead of a single board's anecdote.

### The change — one knob per half of the term

`threat` scales `threatened` (−5, one of mine sits in an enemy's reach) and `threatening` (+3, one of theirs
sits in mine) together, so H3 could only price the pair. H4 gives each half a scale of its own. `threat` keeps
scaling both, so every number H3 reported keeps its meaning, and a scale of 1 multiplies exactly — the default
agent is unchanged, which is checked rather than assumed (instrument 2 below).

```
heuristic:threatened=0     the penalty removed, the bonus kept
heuristic:threatening=0    the bonus removed, the penalty kept
heuristic:threat=0         both, as H3 measured it
```

### Hypothesis

**The −5 is fighting the terrain bonus.** High ground pays `terrain` × the tile's modifier — **+12** on a
mountain — and it is also the ground every enemy wants to reach, so the squares that win the game are exactly
the squares the threat term is paid to avoid. A flat penalty cannot represent that trade: it charges the same
−5 for standing in reach on a mountain as on grassland, where the same exposure is worth far less.

If that is the mechanism:

1. **The effect is real.** `threat=0` beats 50% on Mountains, on seeds it has never played.
2. **It is `threatened`, not `threatening`.** Removing the penalty alone recovers most of the gain; removing
   the bonus alone does little.
3. **It tracks the ground.** The gain is largest where the high ground is highest, and vanishes on boards with
   none, where there is no terrain bonus for the penalty to fight.

Ordering registered before the run, by the board's hill-and-mountain count: **Mountains** (22 tiles) clearly
largest; **Split Peaks**, **Badlands**, **Caldera** (8) and **River Valley** (6) intermediate; **Flat**,
**Chasms**, **Coastal** and **Plains and Forests** (0) at about 50%.

4. **Games get shorter where the gain is largest** — the stand-off is the same effect seen from the side.

### Method

- **Confirmation** — `heuristic:threat=0` vs `heuristic`, Mountains, 100 pairs (200 games), seeds **1001–1100**.
  H3 measured this on seeds 1–50; these are seeds neither agent has played.
- **Which half** — `threatened=0` and `threatening=0`, same board, same seeds, 100 pairs each.
- **Dose–response** — `threat=0` vs `heuristic` on **all nine boards**, 50 pairs each, seeds **2001–2050**.
  Flat is the control: no terrain, so nothing for the term to fight.
- **The weight, not the switch** — `threatened` at **0, 0.5, 2** on Mountains, 100 pairs, seeds 1–100, and the
  best of them confirmed on seeds 1001–1100. H2's lesson stands: the best of a noisy grid is a selection, not a
  result, and only the confirmation counts as evidence.
- **Fixed:** standard team, corruption on, the default deployment rule, arena defaults otherwise.

Intervals are ±1.96·sd/√n over pair scores, the experiment formula in
[arena.md](arena.md#reading-the-error-bars).

### Metrics

| Metric | What it measures | Reported as | Falsified if |
|---|---|---|---|
| **Confirmation on Mountains** | whether H3's nineteen points was real | score vs `heuristic`, with its interval | **the interval covers 50% — the effect was noise, and the rest of this entry is exploratory** |
| **Which half carries it** | whether the penalty or the bonus does the harm | two scores, with intervals | **`threatening=0` gains as much as `threatened=0`** — then it is not the −5 |
| **Dose–response** | whether the harm tracks the terrain | gain per board, against that board's hill + mountain count | **`threat=0` gains as much on Flat as on Mountains** — then the term is simply bad, not fighting terrain |
| **Rounds per board** | the stand-off, measured directly | average rounds with and without the term | — |
| **A scale is selected** | — | only from the confirmation, never from the search | — |
| Instrument 1 — **Flat control** | that there is terrain in the mechanism at all | *expected ≈ 50%* | see dose–response |
| Instrument 2 — **identity** | that splitting the term changed no behaviour | `threatened=1,threatening=1` plays **every** game identically to plain `heuristic`, by checksum | **any game differs** — then the refactor is not behaviour-preserving and nothing here compares to H3 |

### Status

- [x] Designed, with the hypotheses and the instrument checks written before any code or results
- [x] A scale per half of the threat term
- [x] Runner
- [x] Run it — 3,400 games, 0 replay problems
- [x] Record results and findings

### Results

**Instrument check passes:** `threatened=1,threatening=1` played **30 of 30** games identically to plain
`heuristic`, so the split moved nothing and every number here compares with H3. Measured at commit `9aff6a2`;
full tables in [`experiments/h4-threat-terrain/results.md`](../experiments/h4-threat-terrain/results.md). Every
interval is ±1.96·sd/√n over pair scores ([arena.md](arena.md#reading-the-error-bars)).

**The effect is real.** On Mountains, on seeds neither agent had played:

| Agent, on Mountains | Games | Score | 95% interval | Gain | Rounds |
|---|---|---|---|---|---|
| `threat=0` — the whole term off | 200 | **64.5%** | 57.8 – 71.2 | **+14.5** | 4.3 |
| `threatened=0` — the −5 penalty off | 200 | 57.5% | 51.1 – 63.9 | +7.5 | 4.2 |
| `threatening=0` — the +3 bonus off | 200 | **45.0%** | 40.1 – 49.9 | **−5.0** | 4.4 |

Three independent seed sets now agree that the whole term is a loss on Mountains: **69.0%** (H3, seeds 1–50),
**64.5%** (seeds 1001–1100) and **62.0%** (seeds 2001–2050).

**Dose–response — every board, 50 pairs each, seeds 2001 onwards.** The registered prediction ordered these by
hill-and-mountain count: Mountains 22, Split Peaks / Badlands / Caldera 8, River Valley 6, the rest 0. (The
table's own column counts every tile with a positive modifier, forest included, which is why its numbers are
larger; both orderings put Mountains first and Flat last.)

| Board | Hills + mountains | Gain from `threat=0` | 95% interval | Rounds without the term | Baseline rounds |
|---|---|---|---|---|---|
| Mountains | 22 | **+12.0** | 53.3 – 70.7 | 4.2 | 4.1 |
| Caldera | 8 | +4.0 | 46.7 – 61.3 | 5.9 | 5.8 |
| Badlands | 8 | −3.0 | 40.5 – 53.5 | 14.8 | 15.4 |
| Split Peaks | 8 | −2.5 | 38.0 – 57.0 | 16.8 | 17.3 |
| River Valley | 6 | +2.0 | 43.2 – 60.8 | 7.2 | 7.2 |
| Plains and Forests | 0 | −1.0 | 42.4 – 55.6 | 5.2 | 5.4 |
| Chasms | 0 | −2.0 | 40.1 – 55.9 | 10.2 | 10.6 |
| Coastal | 0 | +6.0 | 48.3 – 63.7 | 4.3 | 4.2 |
| **Flat — the control** | **0** | **+6.0** | 49.4 – 62.6 | 7.2 | 7.2 |

**The scale search**, on Mountains, seeds 1–100, confirmed on 1001–1100:

| `threatened` | Score | 95% interval |
|---|---|---|
| 0 | 63.0% | 56.5 – 69.5 |
| 0.5 | 59.5% | 53.0 – 66.0 |
| 2 | **43.0%** | 37.3 – 48.7 |
| **0, confirmed on fresh seeds** | **57.5%** | 51.1 – 63.9 |

Hypotheses as registered: **1 ✓** (the effect is real), **2 ✗** (the penalty is the harmful half, but it
accounts for half the gain, not most, and the bonus is not harmless), **3 ✗ at the time, ✓ once measured
properly** ([H4b](#h4b--flat-against-mountains-properly-powered) — it does track the ground, and this entry was
too small to see it), **4 ✗** (removing the term does not shorten the long boards).

### Findings

**1. The threat term costs its owner fourteen points on Mountains, and that is now beyond doubt.** Three seed
sets, 500 games, all agreeing. An agent that cannot see who is in whose reach beats the one that can, on the
board made of high ground.

**2. It is not one half of the term — the halves are not additive.** Removing the penalty alone gains 7.5;
removing the bonus alone *loses* 5.0; removing both gains 14.5. So removing the penalty is worth +7.5 with the
bonus on and +19.5 with it off, which is an interaction, not a decomposition. The reading that fits: with the
penalty gone and the bonus kept, the agent is paid +3 for every enemy in its reach and charged nothing for
being in theirs, which is a worse evaluation than having neither. **The term is harmful as a unit.** The
registered claim that `threatened=0` would recover most of the gain is wrong.

**3. ~~The mechanism registered for it is not supported — Flat gains too.~~ Withdrawn: see
[H4b](#h4b--flat-against-mountains-properly-powered).** As measured here, the control board gained **+6.0**
(49.4 – 62.6) against Mountains' +12.0 (53.3 – 70.7), two intervals overlapping across most of their length,
and the predicted middle of the range was absent — Split Peaks (−2.5) and Badlands (−3.0) came out *negative*
while Coastal (+6.0) tied with Flat. That read as evidence against the mechanism. It was not evidence of
anything: at 50 pairs a board these are ±7 to ±9 points. Re-measured at 500 pairs, **Flat gains +0.0**
(47.6 – 52.4) and Mountains **+13.5**, a difference of +13.5 (+9.7 – +17.3). The mechanism stands and this
finding was a sampling artefact — the one finding in this entry that its own finding 4 predicted.

**4. This entry was underpowered exactly where it mattered.** 50 pairs per board is ±7 to ±9 points, against a
difference of about 6 points to be separated. The registered falsification — *does Flat gain as much as
Mountains* — has no answer from this run, only a refusal to distinguish. That is a design fault, and the
lesson is specific: the control needed the same games as the confirmation, not a quarter of them.

**5. The stand-off on the long boards is the terrain term, not the threat term.** Removing `threat` entirely
leaves Badlands at 14.8 rounds against a 15.4 baseline and Split Peaks at 16.8 against 17.3 — no change worth
the name. Since removing the two mountains from Badlands halves its game length
([arena.md](arena.md#where-the-high-ground-sits-decides-how-long-a-game-lasts)), what keeps two agents sitting
on their own peaks is what *pays* them to sit there — `terrain` × the modifier — and not what charges them to
come down. The mechanism written up when those boards were added was wrong, and is corrected there.

**6. The penalty weight is too big wherever it was measured.** `threatened=2` scores 43.0% (37.3 – 48.7) and
`threatened=0.5` 59.5% (53.0 – 66.0): more of it is worse, less of it is better, monotonically. The search
selected 0 at 63.0% and the confirmation came back at **57.5%** (51.1 – 63.9) — the regression toward the mean
H2 taught this project to expect, still clear of 50%.

### Candidates this surfaced

- **[H4b — Flat against Mountains, properly powered](#h4b--flat-against-mountains-properly-powered).** The one
  question H4 failed to answer. `threat=0` on both boards on fresh seeds, at the sample size the comparison
  actually needs. **Run: the harm does track the terrain, +13.5 against +0.0.**
- **Delete the threat term, or cut it hard.** It is negative or neutral on eight of nine boards and worth −14
  on one. Before that, price it on the ladder rather than against `heuristic` alone: an agent tuned by removing
  a term is being measured against the very opponent whose blind spot it exploits.
- **Why does an agent that ignores threats beat one that sees them?** Finding 1 is now solid and unexplained.
  The obvious suspect is that one-activation threat awareness is self-defeating — you cannot dodge what you
  cannot see coming, and flinching from what you *can* see costs tempo in a game decided in four rounds.

---

## H4b — Flat against Mountains, properly powered

**Question.** [H4](#h4--the-threat-term-on-high-ground) asked whether the threat term's harm tracks the terrain
and could not answer: `threat=0` gained **+12.0** (53.3 – 70.7) on Mountains and **+6.0** (49.4 – 62.6) on Flat,
two intervals that overlap across most of their length. Does the harm depend on the ground, or is the term
simply bad everywhere?

**Why now.** This is the only claim in H4 that failed for want of games rather than for want of truth. It is
also the claim everything else rests on: if the term is bad on a board with no terrain at all, then "a flat −5
cannot price exposure on ground worth +12" is not the story, and the next question is about one-activation
threat awareness in general rather than about high ground.

**Nothing changes but the sample size.** Same agents, same team, same corruption setting, same default
deployment. Only the boards (two), the seeds (fresh) and the number of games are different.

### The arithmetic that sets the sample size, written before the run

H4 measured `threat=0` at 100 pairs on Mountains for a half-width of ±6.7 points. Half-widths shrink as 1/√n,
and the difference between two independent boards has its own standard error:

```
se_board  = sd/√n            over that board's pair scores
se_diff   = √(se_M² + se_F²)
interval  = (gain_M − gain_F) ± 1.96·se_diff
```

At 100 pairs a board that gives `se_diff ≈ 4.8` points, so a 6-point difference was never separable — H4 was
asking a question its sample could not answer. At **500 pairs a board**, `se_board ≈ 1.5` and
`se_diff ≈ 2.1`, so a 6-point difference lands about 2.8 standard errors out. That is the smallest honest
version of this experiment, and it costs about five minutes.

### Method

- `heuristic:threat=0` vs plain `heuristic`, **500 pairs (1,000 games) each**, on **Mountains** and on **Flat**.
- Seeds **3001–3500** on both boards — seeds no entry has used.
- Standard team, corruption on, default deployment, arena defaults otherwise.
- Flat is in the rotation for this entry only. It is normally left out because a board with no terrain has
  nothing tactical to measure, which is exactly the property that makes it the control here.

### Hypothesis

**Registered prediction: the difference will not be significant.** H4's dose–response showed no pattern outside
Mountains — the two private-peak boards came out *negative* and Coastal, with no high ground, tied with Flat at
+6.0. If terrain drove the harm, those boards should have ranked between the two extremes and they did not. So
this entry is registered expecting to **fail to find** a terrain effect, and Mountains' larger number to be
partly the ordinary luck of being the board that got looked at first.

That prediction is the one at risk. If the difference *is* significant, the H4 mechanism survives after all and
the story returns to high ground.

### Metrics

| Metric | Reported as | Decision |
|---|---|---|
| **Gain on each board** | score vs `heuristic`, with its interval | each is worth stating on its own: at 500 pairs, ±3 points |
| **The difference** | `gain_M − gain_F`, with the interval above | **terrain matters** if it excludes 0 |
| **Terrain does not matter** | the same interval | **claimed only if it excludes +6**, H4's point estimate, while containing 0 — an interval that is merely wide proves nothing |
| **Is the term harmful on Flat at all?** | Flat's own interval against 50% | a separate question from the comparison, and now answerable |
| Rounds, first attack | *reported* | — |

Neither outcome selects a weight. This entry answers one question about one term and nothing else.

### Status

- [x] Designed, with the sample size derived and the prediction written before any code or results
- [x] Runner
- [x] Run it — 2,000 games, 0 replay problems
- [x] Record results and findings

### Results

Measured at commit `576c3a1`; full tables in
[`experiments/h4b-flat-vs-mountains/results.md`](../experiments/h4b-flat-vs-mountains/results.md).

| Board | Games | Seeds | Score | 95% interval | Gain | W / L / D | Rounds |
|---|---|---|---|---|---|---|---|
| Mountains | 1,000 | 3001–3500 | **63.5%** | 60.6 – 66.4 | **+13.5** | 635 / 365 / 0 | 4.2 |
| Flat | 1,000 | 3001–3500 | **50.0%** | 47.6 – 52.4 | **+0.0** | 500 / 500 / 0 | 7.0 |

```
gain on Mountains  +13.5  (se 1.47)
gain on Flat        +0.0  (se 1.24)
difference         +13.5  ± 1.96 × √(se_M² + se_F²) = ± 3.8
95% interval       [+9.7, +17.3]
```

**Terrain matters.** The difference excludes 0 by seven standard errors, so the registered decision is the first
of the three: the threat term's harm depends on the ground. **The prediction on record — that the difference
would not be significant — is wrong.**

### Findings

**1. The H4 mechanism survives its first real test.** `threat=0` gains **+13.5** (60.6 – 66.4) on Mountains and
**nothing at all** on Flat — 50.0% over a thousand games, 500 wins and 500 losses. A board with no terrain gives
the threat term nothing to fight, and on it the term is exactly neutral; a board made of high ground costs its
owner fourteen points. That is what H4 predicted and could not show.

**2. H4's Flat number was noise, and the size of the mistake is worth recording.** 50 pairs said +6.0
(49.4 – 62.6); 500 pairs say +0.0 (47.6 – 52.4). The point estimate moved six points — inside H4's own interval,
exactly as advertised, which is the argument for reading interval width rather than point estimates.

**3. Every other board in H4's dose–response should be read as unmeasured.** They were all 50 pairs. If Flat's
+6.0 was noise, so are Coastal's +6.0, Badlands' −3.0, Split Peaks' −2.5 and the rest: at ±7 to ±9 points, none
of them was ever evidence for or against a pattern. H4's finding 3 rested on that table and is **withdrawn** —
corrected in place above. Only Mountains and Flat have numbers worth the name.

**4. The Mountains effect has now been measured four times** — 69.0%, 64.5%, 62.0% and 63.5%, the last over a
thousand games on seeds nothing else has touched. It is not going away.

**5. What this still does not show is that *height* is the variable.** Mountains and Flat differ in more than
elevation: games last 4.2 rounds there against 7.0 here, and a shorter game is a different game. The clean next
test isolates one thing — the same board with its mountains stepped down to hills, or `terrain=0` paired with
`threat=0` to see whether switching off the bonus removes the penalty's harm. Until then the claim is *terrain*,
not *altitude*.

### Candidates this surfaced

- **Is it height, or is it the terrain term?** `heuristic:terrain=0:threat=0` against `heuristic:terrain=0` on
  Mountains. If the threat term stops being harmful once nothing is paying for high ground, the fight between
  the two weights is demonstrated rather than inferred. One measurement, and the cheapest one left.
- **Re-run the dose–response at a size that means something.** Nine boards at 500 pairs is about 40 minutes.
  Worth doing once, because the per-board gain is now known to be a real quantity rather than a rumour.
