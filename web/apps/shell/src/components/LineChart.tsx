interface Series {
  label: string;
  color: string;
  points: [number, number][];
}

export function LineChart({
  series,
  height = 140,
  fromMs,
  toMs,
  format,
}: {
  series: Series[];
  height?: number;
  fromMs: number;
  toMs: number;
  format: (v: number) => string;
}) {
  const W = 640;
  const H = height;
  const padL = 46;
  const padB = 20;
  const padT = 8;

  let min = Infinity;
  let max = -Infinity;
  for (const s of series)
    for (const [, y] of s.points) {
      if (y < min) min = y;
      if (y > max) max = y;
    }
  if (!isFinite(min)) {
    min = 0;
    max = 1;
  }
  if (max === min) max = min + 1;
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;

  const sx = (t: number) => padL + ((t - fromMs) / Math.max(1, toMs - fromMs)) * (W - padL - 8);
  const sy = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const gridYs = [0, 0.5, 1].map((f) => min + f * (max - min));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", background: "var(--kb-bg-inset)", borderRadius: 8 }}>
      {gridYs.map((g, i) => (
        <g key={i}>
          <line x1={padL} x2={W - 8} y1={sy(g)} y2={sy(g)} stroke="var(--kb-border-subtle)" strokeWidth={1} />
          <text x={4} y={sy(g) + 3} fontSize={9.5} fill="var(--kb-fg-muted)" fontFamily="var(--kb-font-mono)">
            {format(g)}
          </text>
        </g>
      ))}
      {series.map((s, i) =>
        s.points.length > 1 ? (
          <polyline
            key={i}
            fill="none"
            stroke={s.color}
            strokeWidth={1.6}
            points={s.points.map(([t, v]) => `${sx(t)},${sy(v)}`).join(" ")}
          />
        ) : null,
      )}
      <text x={padL} y={H - 5} fontSize={9.5} fill="var(--kb-fg-subtle)" fontFamily="var(--kb-font-mono)">
        {new Date(fromMs).toLocaleTimeString()}
      </text>
      <text x={W - 90} y={H - 5} fontSize={9.5} fill="var(--kb-fg-subtle)" fontFamily="var(--kb-font-mono)">
        {new Date(toMs).toLocaleTimeString()}
      </text>
      {series.map((s, i) => (
        <g key={`l${i}`} transform={`translate(${padL + 8 + i * 150},12)`}>
          <rect width={9} height={3} rx={1.5} y={-3} fill={s.color} />
          <text x={13} fontSize={10} fill="var(--kb-fg-muted)">
            {s.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
