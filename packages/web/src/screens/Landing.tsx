type Props = { onPlay: () => void };

export function Landing({ onPlay }: Props) {
  return (
    <div className="centred">
      <h1 className="title">Machine Strike</h1>
      <p className="sub">The board game from Horizon Forbidden West, rebuilt for the browser.</p>

      <div className="menu">
        <button className="primary big" onClick={onPlay}>
          Play hot-seat
        </button>
        <button className="big" disabled title="Not built yet">
          Play vs AI
        </button>
      </div>

      <p className="footnote">
        Two players, one device. A fan reimplementation — not affiliated with Guerrilla.
      </p>
    </div>
  );
}
