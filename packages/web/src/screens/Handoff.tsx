type Props = { to: 1 | 2; what: string; onReady: () => void };

/** Hidden drafting needs a screen between the two players (rules 8.1). */
export function Handoff({ to, what, onReady }: Props) {
  return (
    <div className="centred">
      <p className="sub">Pass the device</p>
      <h1 className="title">
        <span className={`who p${to}`}>Player {to}</span>
      </h1>
      <p className="sub">{what}</p>
      <div className="menu">
        <button className="primary big" onClick={onReady}>
          I'm ready
        </button>
      </div>
      <p className="footnote">Sets are drafted blind — don't peek at the other player's screen.</p>
    </div>
  );
}
