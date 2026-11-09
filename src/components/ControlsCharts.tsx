"use client";

import type { CategorySlice, ServiceBar } from "@/lib/controls/subscription";
import { formatMoney } from "@/lib/controls/subscription";
import { CONTROLS } from "@/lib/text/controls";

// A categorical palette that reads on both the light (#f5f6f8) and dark (#0b0c0f) backgrounds: mid-tone,
// distinguishable hues, the brand orange first. Colors cycle if a chart has more series than the palette.
export const CHART_COLORS = [
  "#f17223",
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#eab308",
  "#ec4899",
  "#06b6d4",
  "#ef4444",
  "#14b8a6",
  "#64748b",
];

const color = (i: number) => CHART_COLORS[i % CHART_COLORS.length];

function polar(cx: number, cy: number, r: number, frac: number): [number, number] {
  // 0 at the top, clockwise.
  const angle = frac * 2 * Math.PI - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function donutArc(cx: number, cy: number, rOuter: number, rInner: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, rOuter, from);
  const [x2, y2] = polar(cx, cy, rOuter, to);
  const [x3, y3] = polar(cx, cy, rInner, to);
  const [x4, y4] = polar(cx, cy, rInner, from);
  const large = to - from > 0.5 ? 1 : 0;
  return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`;
}

/** Monthly spend by category, as a donut with a legend. Only categories with a real cost get an arc; a
 *  category with zero spend still shows in the legend (it is a real subscription, just not priced yet). */
export function CategoryDonut({ slices, currency }: { slices: CategorySlice[]; currency: string }) {
  const priced = slices.filter((s) => s.monthly > 0);
  const total = priced.reduce((sum, s) => sum + s.monthly, 0);

  if (total <= 0) {
    return <p className="text-sm text-rs-text-faint">{CONTROLS.noChartData}</p>;
  }

  const arcs = priced.map((s, i) => {
    const before = priced.slice(0, i).reduce((sum, p) => sum + p.monthly, 0);
    const from = before / total;
    const to = (before + s.monthly) / total;
    return { d: donutArc(90, 90, 80, 48, from, to), fill: color(i), slice: s };
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
      <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label={CONTROLS.byCategory} className="shrink-0">
        {arcs.map((a) => (
          <path key={a.slice.category} d={a.d} fill={a.fill} stroke="var(--rs-card)" strokeWidth="1.5" />
        ))}
        <text x="90" y="86" textAnchor="middle" className="fill-rs-text-faint" style={{ fontSize: 10 }}>
          {CONTROLS.monthlyTotal}
        </text>
        <text x="90" y="102" textAnchor="middle" className="fill-rs-text font-bold" style={{ fontSize: 13 }}>
          {formatMoney(total, currency)}
        </text>
      </svg>
      <ul className="flex w-full flex-col gap-1.5">
        {slices.map((s, i) => (
          <li key={s.category} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.monthly > 0 ? color(i) : "var(--rs-border)" }} />
              <span className="truncate text-rs-text">{s.category}</span>
              <span className="text-xs text-rs-text-faint">({s.count})</span>
            </span>
            <span className="shrink-0 font-semibold text-rs-text-soft">{formatMoney(s.monthly, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Monthly spend by service, horizontal bars scaled to the biggest. Priced active subs only. */
export function ServiceBars({ bars, currency }: { bars: ServiceBar[]; currency: string }) {
  if (bars.length === 0) {
    return <p className="text-sm text-rs-text-faint">{CONTROLS.noChartData}</p>;
  }
  const max = Math.max(...bars.map((b) => b.monthly));
  return (
    <ul className="flex flex-col gap-2.5">
      {bars.map((b, i) => (
        <li key={b.id} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-rs-text">{b.name}</span>
            <span className="shrink-0 font-semibold text-rs-text-soft">{formatMoney(b.monthly, currency)}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-rs-lane">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.max(3, (b.monthly / max) * 100)}%`, background: color(i) }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
