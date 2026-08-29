import { useState } from "react";
import { Steps } from "./BoardSelect";
import {
  MACHINES,
  MACHINE_BY_ID,
  SPRITE,
  TEAM_POINTS,
  TYPE_ORDER,
  blockedReason,
  copiesOf,
  isLegalTeam,
  teamPoints,
  type Machine,
  type Team,
} from "../data/machines";

type Props = { onReady: (team: Team) => void; onBack: () => void };

export function Draft({ onReady, onBack }: Props) {
  const [team, setTeam] = useState<Team>([]);
  const spent = teamPoints(team);
  const left = TEAM_POINTS - spent;
  const legal = isLegalTeam(team);

  // Functional updates: batched clicks must each see the previous team, not the
  // team captured when this render ran. The legality check has to run on the
  // current value too, or a rapid double-click can overshoot 10 points.
  const add = (m: Machine) => setTeam((t) => (blockedReason(t, m) ? t : [...t, m.id]));
  const removeAt = (i: number) => setTeam((t) => t.filter((_, j) => j !== i));

  return (
    <div className="screen wide">
      <Steps active={2} />
      <h2 className="screen-title">Build your set</h2>

      <div className="draft">
        <div className="roster">
          {TYPE_ORDER.map((type) => (
            <section key={type}>
              <h3>{type}</h3>
              <div className="cards">
                {MACHINES.filter((m) => m.type === type).map((m) => {
                  const blocked = blockedReason(team, m);
                  const n = copiesOf(team, m.id);
                  return (
                    <button
                      key={m.id}
                      className={`card${blocked ? " blocked" : ""}${n ? " picked" : ""}`}
                      onClick={() => add(m)}
                      disabled={!!blocked}
                      title={blocked ?? `Add ${m.name} (${m.points} pts)`}
                    >
                      <img src={SPRITE[m.id]} alt="" draggable={false} />
                      <div className="card-body">
                        <b>{m.name}</b>
                        <span className="stats">
                          {m.health}hp · {m.attack}atk · {m.range}rng · {m.movement}mov
                        </span>
                        {m.skill && <span className="skill">{m.skill}</span>}
                      </div>
                      <span className="pts">{m.points}</span>
                      {n > 0 && <span className="count">×{n}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="tray">
          <div className={`budget${legal ? " legal" : ""}`}>
            <span className="big-num">
              {spent}
              <small>/{TEAM_POINTS}</small>
            </span>
            <span className="budget-note">
              {legal ? "Set complete" : left > 0 ? `${left} point${left === 1 ? "" : "s"} left` : ""}
            </span>
          </div>

          <ul className="picked-list">
            {team.length === 0 && <li className="empty">No machines yet.</li>}
            {team.map((id, i) => {
              const m = MACHINE_BY_ID[id];
              return (
                <li key={`${id}-${i}`}>
                  <img src={SPRITE[id]} alt="" draggable={false} />
                  <b>{m.name}</b>
                  <span className="pts">{m.points}</span>
                  <button className="remove" onClick={() => removeAt(i)} aria-label={`Remove ${m.name}`}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="rule-note">
            A set must total <b>exactly {TEAM_POINTS}</b> points, with at most 4 of any one machine.
          </p>

          <div className="actions">
            <button onClick={onBack}>Back</button>
            <button className="primary" disabled={!legal} onClick={() => onReady(team)}>
              Play
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
