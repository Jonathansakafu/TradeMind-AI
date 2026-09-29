import { useRef, useState } from "react";
import { formatMoney } from "../utils/tradeStats";

// Hand-built SVG charts for the Performance page (no chart library in
// this app). Colors are CSS variables set per theme in Performance.jsx's
// .perf-viz block -- win aqua-green / loss orange-red were chosen over
// pure green/red because green-vs-red fails the colorblind (deutan) check
// (dE 4.1); these pass (dE 9.2 light / 9.4 dark). Identity is never color
// alone: every segment/bar carries a text label, and legends use icons.

const OUTCOMES = [
  { key: "wins", label: "Wins", icon: "✓", color: "var(--viz-win)" },
  { key: "losses", label: "Losses", icon: "✗", color: "var(--viz-loss)" },
  { key: "breakeven", label: "Breakeven", icon: "–", color: "var(--viz-neutral)" },
];

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs shadow-lg text-slate-700 dark:text-slate-200 whitespace-nowrap"
      style={{ left: tip.x, top: tip.y, transform: "translate(-50%, calc(-100% - 10px))" }}
    >
      {tip.lines.map((l, i) => (
        <div key={i} className={i === 0 ? "font-semibold text-slate-900 dark:text-white" : ""}>{l}</div>
      ))}
    </div>
  );
}

export function OutcomeLegend({ stats }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {OUTCOMES.map((o) => {
        const n = stats[o.key];
        const pct = stats.closed ? Math.round((n / stats.closed) * 100) : 0;
        return (
          <li key={o.key} className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold text-white" style={{ background: o.color }}>{o.icon}</span>
            {o.label} <span className="font-semibold text-slate-900 dark:text-white">{n}</span>
            <span className="text-slate-500">({pct}%)</span>
          </li>
        );
      })}
    </ul>
  );
}

// Donut: win / loss / breakeven share, win rate in the middle.
export function OutcomeDonut({ stats }) {
  const [tip, setTip] = useState(null);
  const size = 220, r = 80, stroke = 30, c = 2 * Math.PI * r;
  const total = stats.closed || 0;
  let offset = 0;
  const gap = total > 1 ? 3 : 0; // 2-3px surface gap between segments
  return (
    <div className="relative mx-auto w-full" style={{ maxWidth: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Win rate ${Math.round(stats.winRate)}%`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--viz-track)" strokeWidth={stroke} />
        {total > 0 && OUTCOMES.map((o) => {
          const n = stats[o.key];
          if (!n) return null;
          const len = (n / total) * c;
          const dash = Math.max(0, len - gap);
          const el = (
            <circle
              key={o.key}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={o.color} strokeWidth={stroke}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="cursor-pointer transition-opacity hover:opacity-80"
              onMouseMove={(e) => {
                const box = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                setTip({ x: e.clientX - box.left, y: e.clientY - box.top, lines: [o.label, `${n} trades · ${Math.round((n / total) * 100)}%`] });
              }}
              onMouseLeave={() => setTip(null)}
            />
          );
          offset += len;
          return el;
        })}
        <text x="50%" y="47%" textAnchor="middle" className="fill-slate-900 dark:fill-white" style={{ fontSize: 34, fontWeight: 700 }}>
          {Math.round(stats.winRate)}%
        </text>
        <text x="50%" y="59%" textAnchor="middle" className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 13 }}>
          win rate · {total} closed
        </text>
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// Bars: the same three counts side by side, value labels on top.
export function OutcomeBars({ stats }) {
  const [tip, setTip] = useState(null);
  const w = 320, h = 200, pad = { t: 24, b: 28, l: 8, r: 8 };
  const max = Math.max(1, stats.wins, stats.losses, stats.breakeven);
  const bw = 56, slot = (w - pad.l - pad.r) / 3;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Wins, losses and breakeven trades">
        <line x1={pad.l} x2={w - pad.r} y1={h - pad.b} y2={h - pad.b} stroke="var(--viz-grid)" />
        {OUTCOMES.map((o, i) => {
          const n = stats[o.key];
          const bh = ((h - pad.t - pad.b) * n) / max;
          const x = pad.l + slot * i + (slot - bw) / 2;
          const y = h - pad.b - bh;
          return (
            <g key={o.key}
              onMouseMove={(e) => {
                const box = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                setTip({ x: e.clientX - box.left, y: e.clientY - box.top, lines: [o.label, `${n} trades · ${stats.closed ? Math.round((n / stats.closed) * 100) : 0}%`] });
              }}
              onMouseLeave={() => setTip(null)}
            >
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={h - pad.t - pad.b} fill="transparent" />
              {n > 0 && <path d={roundedTopBar(x, y, bw, bh, 4)} fill={o.color} />}
              <text x={x + bw / 2} y={y - 6} textAnchor="middle" className="fill-slate-900 dark:fill-white" style={{ fontSize: 13, fontWeight: 600 }}>{n}</text>
              <text x={x + bw / 2} y={h - 8} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 12 }}>{o.label}</text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

function roundedTopBar(x, y, w, h, r) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

// Line over trade number: cumulative P/L (equity curve) or running win
// rate. Crosshair + tooltip follow the nearest trade.
export function TradeLine({ series, metric }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const w = 640, h = 240, pad = { t: 16, r: 16, b: 28, l: 56 };
  const isWR = metric === "winRate";
  const values = series.map((p) => (isWR ? p.winRate : p.cumPL));
  const ticks = isWR ? [0, 25, 50, 75, 100] : niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const x = (i) => pad.l + (series.length <= 1 ? (w - pad.l - pad.r) / 2 : (i * (w - pad.l - pad.r)) / (series.length - 1));
  const y = (v) => pad.t + ((yMax - v) * (h - pad.t - pad.b)) / (yMax - yMin || 1);
  const pts = series.map((p, i) => [x(i), y(values[i])]);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ");
  const baseV = isWR ? 50 : 0;
  const area = pts.length ? `${line} L${pts[pts.length - 1][0]},${y(baseV)} L${pts[0][0]},${y(baseV)} Z` : "";
  const fmt = (v) => (isWR ? `${Math.round(v)}%` : formatMoney(v));

  const onMove = (e) => {
    if (!series.length) return;
    const box = ref.current.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * w;
    const i = Math.max(0, Math.min(series.length - 1, Math.round(((sx - pad.l) / (w - pad.l - pad.r)) * (series.length - 1))));
    setHover(i);
  };
  const hp = hover != null ? series[hover] : null;

  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${w} ${h}`} className="w-full touch-none" role="img"
        aria-label={isWR ? "Running win rate by trade" : "Cumulative profit and loss by trade"}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onTouchMove={(e) => onMove(e.touches[0])} onTouchEnd={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeDasharray={t === baseV ? "4 4" : undefined} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 11 }}>{fmt(t)}</text>
          </g>
        ))}
        {area && <path d={area} fill="var(--viz-line)" opacity="0.12" />}
        {line && <path d={line} fill="none" stroke="var(--viz-line)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        <text x={pad.l} y={h - 8} className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 11 }}>Trade 1</text>
        <text x={w - pad.r} y={h - 8} textAnchor="end" className="fill-slate-500 dark:fill-slate-400" style={{ fontSize: 11 }}>Trade {series.length}</text>
        {hp && (
          <g>
            <line x1={pts[hover][0]} x2={pts[hover][0]} y1={pad.t} y2={h - pad.b} stroke="var(--viz-grid-strong)" />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="5" fill="var(--viz-line)" stroke="var(--viz-surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hp && (
        <Tooltip tip={{
          x: `${(pts[hover][0] / w) * 100}%`,
          // The SVG scales uniformly with its container, so a percentage of
          // the viewBox height maps straight onto the rendered chart.
          y: `${(pts[hover][1] / h) * 100}%`,
          lines: [
            `Trade ${hp.n} · ${hp.pair} ${hp.direction?.toUpperCase() || ""}`,
            `${hp.outcome === "win" ? "✓ Won" : hp.outcome === "loss" ? "✗ Lost" : "– Breakeven"} ${formatMoney(hp.pl)}`,
            isWR ? `Win rate so far: ${Math.round(hp.winRate)}%` : `Cumulative P/L: ${formatMoney(hp.cumPL)}`,
            hp.date.toLocaleDateString(),
          ],
        }} />
      )}
    </div>
  );
}

// Horizontal bars: win rate per group, each fully labeled in text.
export function BreakdownBars({ rows }) {
  if (!rows.length) return <p className="text-sm text-slate-500">No closed trades in this range.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((g) => (
        <li key={g.key} title={`${g.key}: ${g.wins} wins of ${g.trades} trades, net ${formatMoney(g.netPL)}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm mb-1">
            <span className="font-semibold text-slate-900 dark:text-white truncate">{g.key}</span>
            <span className="text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-900 dark:text-white">{Math.round(g.winRate)}%</span>
              {" · "}{g.wins}/{g.trades} won{" · "}
              <span className={g.netPL >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{formatMoney(g.netPL)}</span>
            </span>
          </div>
          <div className="h-2.5 rounded-full" style={{ background: "var(--viz-track)" }}>
            <div className="h-2.5 rounded-full" style={{ width: `${Math.max(g.winRate, 1.5)}%`, background: "var(--viz-line)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// Table view of the same data (accessibility / exact numbers).
export function TradeTable({ series }) {
  return (
    <div className="max-h-72 max-w-full overflow-auto overscroll-contain rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          <tr>{["#", "Date", "Pair", "Result", "P/L", "Cumulative", "Win rate"].map((hd) => <th key={hd} className="px-3 py-2 text-left font-semibold">{hd}</th>)}</tr>
        </thead>
        <tbody>
          {[...series].reverse().map((p) => (
            <tr key={p.n} className="border-t border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 whitespace-nowrap">
              <td className="px-3 py-1.5">{p.n}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{p.date.toLocaleDateString()}</td>
              <td className="px-3 py-1.5">{p.pair}</td>
              <td className="px-3 py-1.5">{p.outcome === "win" ? "✓ Win" : p.outcome === "loss" ? "✗ Loss" : "– BE"}</td>
              <td className="px-3 py-1.5 font-mono">{formatMoney(p.pl)}</td>
              <td className="px-3 py-1.5 font-mono">{formatMoney(p.cumPL)}</td>
              <td className="px-3 py-1.5">{Math.round(p.winRate)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
