"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

/*
 * KPI Chart – Clean style (affectUI Pro specification).
 * Multi-line SVG chart with smooth curves, dashed target guide, pointer/touch scrub,
 * keyboard ←/→/Esc navigation, and a polite live tooltip following the cursor.
 */

export type KpiSeries = {
  label: string;
  color: string;
  values: (number | null | undefined)[];
  dashed?: boolean;
};

export type KpiChartProps = {
  /** Label above the number */
  title?: ReactNode;
  /** Headline value (pre-formatted string or e.g. <NumberTicker />) */
  value?: ReactNode;
  /** Change against the previous period – green when positive, red when negative */
  delta?: number;
  /** Formats axis, tooltip and delta values – defaults to compact e.g. 1.2k */
  format?: (n: number) => string;
  /** One label per point; first, middle and last are shown on the axis */
  labels: string[];
  /** Longer labels for the tooltip header, falls back to labels */
  tooltipLabels?: string[];
  /** Lines with a label, a color and one value per label */
  series: KpiSeries[];
  /** Optional quiet line under the chart */
  footer?: ReactNode;
  /** Point that stays highlighted while nobody hovers */
  defaultIndex?: number;
  /** Quiet text in the plot when there are no values, or only zeros */
  emptyText?: string;
  /** Optional top-right control slot (e.g. SegmentedControl or ? popover) */
  action?: ReactNode;
  /** Optional clean secondary metric strip next to headline */
  subMetrics?: ReactNode;
  /** Optional horizontal dashed benchmark reference line */
  referenceLine?: { value: number; label?: string };
  /** Plot height in px */
  height?: number;
  /** Extra class on the card */
  className?: string;
};

const defaultCompact = (n: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function niceAxisMax(maxVal: number): number {
  if (maxVal <= 0) return 100;
  const pow = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const norm = maxVal / pow;
  const step = norm <= 1.2 ? 1.2 : norm <= 1.5 ? 1.5 : norm <= 2 ? 2 : norm <= 3 ? 3 : norm <= 5 ? 5 : norm <= 8 ? 8 : 10;
  return step * pow;
}

function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const tension = 0.2;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function KpiChart({
  title,
  value,
  delta,
  format = defaultCompact,
  labels,
  tooltipLabels,
  series,
  footer,
  defaultIndex,
  emptyText = "No data yet",
  action,
  subMetrics,
  referenceLine,
  height = 220,
  className,
}: KpiChartProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const plotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 560, height });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [labels.join("|"), series.length]);

  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 40) {
        setSize({ width: Math.round(r.width), height });
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  const count = labels.length;
  const padL = 46;
  const padR = 14;
  const padT = 16;
  const padB = 26;
  const innerW = Math.max(40, size.width - padL - padR);
  const innerH = Math.max(40, size.height - padT - padB);

  const numericValues = useMemo(() => {
    const vals: number[] = [];
    for (const s of series) {
      for (let i = 0; i < count; i++) {
        const v = s.values[i];
        if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
      }
    }
    if (referenceLine && Number.isFinite(referenceLine.value)) {
      vals.push(referenceLine.value);
    }
    return vals;
  }, [series, count, referenceLine]);

  const hasData = numericValues.some((v) => v > 0);
  const rawMax = Math.max(0, ...numericValues);
  const yMax = hasData ? niceAxisMax(rawMax * 1.08) : 100;
  const yTicks = [0, yMax * 0.5, yMax];

  const xAt = (i: number) => (count <= 1 ? padL + innerW / 2 : padL + (i / (count - 1)) * innerW);
  const yAt = (v: number) => padT + innerH - Math.max(0, Math.min(1, v / yMax)) * innerH;

  const builtSeries = useMemo(() => {
    return series.map((s, sIdx) => {
      const segments: { x: number; y: number; v: number; i: number }[][] = [];
      let cur: { x: number; y: number; v: number; i: number }[] = [];
      const pointMap = new Map<number, { x: number; y: number; v: number }>();
      for (let i = 0; i < count; i++) {
        const v = s.values[i];
        if (typeof v === "number" && Number.isFinite(v)) {
          const pt = { x: xAt(i), y: yAt(v), v, i };
          cur.push(pt);
          pointMap.set(i, { x: pt.x, y: pt.y, v });
        } else if (cur.length > 0) {
          segments.push(cur);
          cur = [];
        }
      }
      if (cur.length > 0) segments.push(cur);

      const segmentPaths = segments.map((seg) => {
        const line = buildSmoothPath(seg);
        const area =
          seg.length >= 2
            ? `${line} L ${seg[seg.length - 1].x.toFixed(1)} ${(padT + innerH).toFixed(1)} L ${seg[0].x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`
            : "";
        return { line, area, singlePoint: seg.length === 1 ? seg[0] : null };
      });

      return { s, sIdx, segmentPaths, pointMap };
    });
  }, [series, count, innerW, innerH, yMax]);

  const lastValidIdx = useMemo(() => {
    for (let i = count - 1; i >= 0; i--) {
      if (series.some((s) => typeof s.values[i] === "number" && Number.isFinite(s.values[i]))) {
        return i;
      }
    }
    return count > 0 ? count - 1 : null;
  }, [series, count]);

  const activeIdx = hoverIdx ?? focusedIdx ?? (defaultIndex !== undefined && defaultIndex >= 0 && defaultIndex < count ? defaultIndex : null);
  const displayIdx = activeIdx ?? lastValidIdx;

  const pickIndexFromPointer = (clientX: number) => {
    const el = plotRef.current;
    if (!el || count <= 0) return;
    const rect = el.getBoundingClientRect();
    const relX = clientX - rect.left - padL;
    const ratio = Math.max(0, Math.min(1, relX / Math.max(1, innerW)));
    const idx = Math.round(ratio * Math.max(0, count - 1));
    setHoverIdx(idx);
  };

  const axisIndices = useMemo(() => {
    if (count === 0) return [];
    if (count === 1) return [0];
    if (count === 2) return [0, 1];
    return [0, Math.floor((count - 1) / 2), count - 1];
  }, [count]);

  const showTooltip = hoverIdx !== null || focusedIdx !== null;
  const activeHeader =
    displayIdx !== null ? tooltipLabels?.[displayIdx] ?? labels[displayIdx] ?? "" : "";

  const activeX = displayIdx !== null ? xAt(displayIdx) : padL;
  const tooltipOnLeft = activeX > size.width * 0.62;

  return (
    <>
      <style href="ui-kpi-chart-clean" precedence="default">
        {css}
      </style>
      <section className={["ui-kcc", className].filter(Boolean).join(" ")} aria-label={typeof title === "string" ? title : "KPI Chart"}>
        {(title || action) && (
          <header className="ui-kcc__top">
            {title && <h3 className="ui-kcc__title">{title}</h3>}
            {action && <div className="ui-kcc__action">{action}</div>}
          </header>
        )}

        {(value !== undefined || delta !== undefined || subMetrics) && (
          <div className="ui-kcc__hero">
            <div className="ui-kcc__headline">
              {value !== undefined && <div className="ui-kcc__value">{value}</div>}
              {delta !== undefined && Number.isFinite(delta) && (
                <span className="ui-kcc__delta" data-sign={delta > 0 ? "up" : delta < 0 ? "down" : "flat"}>
                  {delta > 0 ? "+" : ""}
                  {format(delta)}
                </span>
              )}
            </div>
            {subMetrics && <div className="ui-kcc__subs">{subMetrics}</div>}
          </div>
        )}

        <div
          ref={plotRef}
          className="ui-kcc__plot"
          style={{ height }}
          tabIndex={count > 0 ? 0 : -1}
          role="application"
          aria-label={`${typeof title === "string" ? title : "Chart"} 交互折线图，使用左右方向键逐点查看`}
          onPointerMove={(e) => {
            if (!hasData) return;
            pickIndexFromPointer(e.clientX);
          }}
          onPointerDown={(e) => {
            if (!hasData) return;
            pickIndexFromPointer(e.clientX);
          }}
          onPointerLeave={() => setHoverIdx(null)}
          onFocus={() => {
            if (focusedIdx === null && lastValidIdx !== null) {
              setFocusedIdx(defaultIndex ?? lastValidIdx);
            }
          }}
          onBlur={() => setFocusedIdx(null)}
          onKeyDown={(e) => {
            if (!hasData || count <= 0) return;
            const cur = focusedIdx ?? hoverIdx ?? defaultIndex ?? lastValidIdx ?? 0;
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setFocusedIdx(Math.max(0, cur - 1));
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setFocusedIdx(Math.min(count - 1, cur + 1));
            } else if (e.key === "Escape") {
              e.preventDefault();
              setHoverIdx(null);
              setFocusedIdx(null);
            }
          }}
        >
          <svg
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
            className="ui-kcc__svg"
            data-drawn={drawn || undefined}
            aria-hidden="true"
          >
            <defs>
              {series.map((s, idx) => (
                <linearGradient key={idx} id={`kcc-grad-${uid}-${idx}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.0} />
                </linearGradient>
              ))}
              <clipPath id={`kcc-reveal-${uid}`}>
                <rect x={0} y={0} width={drawn ? size.width : 0} height={size.height} className="ui-kcc__cliprect" />
              </clipPath>
            </defs>

            {/* Horizontal dashed grid lines + Y labels */}
            {yTicks.map((tickVal, idx) => {
              const y = yAt(tickVal);
              return (
                <g key={idx}>
                  <line
                    x1={padL}
                    x2={size.width - padR}
                    y1={y}
                    y2={y}
                    className="ui-kcc__grid"
                  />
                  <text x={padL - 8} y={y + 3.5} textAnchor="end" className="ui-kcc__tick">
                    {format(tickVal)}
                  </text>
                </g>
              );
            })}

            {/* Optional horizontal target reference line */}
            {referenceLine && Number.isFinite(referenceLine.value) && (
              <g>
                <line
                  x1={padL}
                  x2={size.width - padR}
                  y1={yAt(referenceLine.value)}
                  y2={yAt(referenceLine.value)}
                  className="ui-kcc__refline"
                />
                {referenceLine.label && (
                  <text
                    x={size.width - padR - 4}
                    y={yAt(referenceLine.value) - 5}
                    textAnchor="end"
                    className="ui-kcc__reflabel"
                  >
                    {referenceLine.label}
                  </text>
                )}
              </g>
            )}

            {/* Series lines & gradient fills */}
            <g clipPath={`url(#kcc-reveal-${uid})`}>
              {hasData &&
                builtSeries.map(({ s, sIdx, segmentPaths }) => (
                  <g key={s.label}>
                    {segmentPaths.map((seg, segIdx) => (
                      <g key={segIdx}>
                        {seg.area && !s.dashed && (
                          <path d={seg.area} fill={`url(#kcc-grad-${uid}-${sIdx})`} />
                        )}
                        {seg.line && (
                          <path
                            d={seg.line}
                            fill="none"
                            stroke={s.color}
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray={s.dashed ? "5 4" : undefined}
                          />
                        )}
                        {seg.singlePoint && (
                          <circle cx={seg.singlePoint.x} cy={seg.singlePoint.y} r={3} fill={s.color} />
                        )}
                      </g>
                    ))}
                  </g>
                ))}
            </g>

            {/* X axis labels */}
            {axisIndices.map((idx) => (
              <text
                key={idx}
                x={xAt(idx)}
                y={size.height - 6}
                textAnchor={idx === 0 ? "start" : idx === count - 1 ? "end" : "middle"}
                className="ui-kcc__tick"
              >
                {labels[idx]}
              </text>
            ))}

            {/* Crosshair & active dots */}
            {hasData && activeIdx !== null && (
              <g>
                <line
                  x1={activeX}
                  x2={activeX}
                  y1={padT}
                  y2={padT + innerH}
                  className="ui-kcc__guide"
                />
                {builtSeries.map(({ s, pointMap }) => {
                  const pt = pointMap.get(activeIdx);
                  if (!pt) return null;
                  return (
                    <g key={s.label}>
                      <circle cx={pt.x} cy={pt.y} r={4.5} fill={s.color} stroke="var(--ui-kcc-surface)" strokeWidth={2} />
                    </g>
                  );
                })}
              </g>
            )}
          </svg>

          {!hasData && <div className="ui-kcc__empty">{emptyText}</div>}

          {/* Floating tooltip following crosshair */}
          {hasData && showTooltip && activeIdx !== null && (
            <div
              className="ui-kcc__tip"
              role="status"
              aria-live="polite"
              data-side={tooltipOnLeft ? "left" : "right"}
              style={{
                left: tooltipOnLeft ? undefined : Math.min(size.width - 170, activeX + 12),
                right: tooltipOnLeft ? Math.max(10, size.width - activeX + 12) : undefined,
              }}
            >
              <div className="ui-kcc__tip-head">{activeHeader}</div>
              <div className="ui-kcc__tip-list">
                {series.map((s) => {
                  const val = s.values[activeIdx];
                  const valid = typeof val === "number" && Number.isFinite(val);
                  return (
                    <div key={s.label} className="ui-kcc__tip-row">
                      <span className="ui-kcc__dot" style={{ background: s.color }} aria-hidden="true" />
                      <span className="ui-kcc__tip-name">{s.label}</span>
                      <strong className="ui-kcc__tip-val">{valid ? format(val) : "—"}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="ui-kcc__foot">
          <div className="ui-kcc__legend">
            {series.map((s) => (
              <span key={s.label} className="ui-kcc__legend-item">
                <span className="ui-kcc__dot" style={{ background: s.color }} aria-hidden="true" />
                <span>{s.label}</span>
              </span>
            ))}
            {referenceLine?.label && (
              <span className="ui-kcc__legend-item ui-kcc__legend-item--ref">
                <span className="ui-kcc__dash-swatch" aria-hidden="true" />
                <span>{referenceLine.label}</span>
              </span>
            )}
          </div>
          {footer && <div className="ui-kcc__footer-text">{footer}</div>}
        </footer>
      </section>
    </>
  );
}

const css = /* css */ `
.ui-kcc {
  --ui-kcc-surface: var(--aui-surface, #ffffff);
  --ui-kcc-strong: var(--aui-ink, #09090b);
  --ui-kcc-ink: var(--aui-ink, rgba(0, 0, 0, 0.88));
  --ui-kcc-muted: var(--aui-muted, rgba(0, 0, 0, 0.56));
  --ui-kcc-faint: var(--aui-placeholder, rgba(0, 0, 0, 0.32));
  --ui-kcc-line: var(--aui-border, rgba(0, 0, 0, 0.07));
  --ui-kcc-shadow: var(--aui-shadow-card, 0 0 0 0.5px rgba(0, 0, 0, 0.07), 0 1px 2px rgba(0, 0, 0, 0.04));
  --ui-kcc-ok: var(--aui-success, #15803d);
  --ui-kcc-ok-bg: color-mix(in srgb, var(--aui-green, #22c55e) 11%, transparent);
  --ui-kcc-bad: var(--aui-danger, #c82820);
  --ui-kcc-bad-bg: color-mix(in srgb, var(--aui-red, #ef4444) 11%, transparent);
  --ui-kcc-pop: var(--aui-overlay, #ffffff);
  --ui-kcc-pop-shadow: var(--aui-shadow-popover, 0 4px 16px -4px rgba(0, 0, 0, 0.14), 0 0 0 0.5px rgba(0, 0, 0, 0.08));
  --ui-kcc-radius: var(--aui-radius-lg, 12px);
  --ui-kcc-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));

  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  padding: 20px 22px;
  border-radius: var(--ui-kcc-radius);
  background: var(--ui-kcc-surface);
  box-shadow: var(--ui-kcc-shadow);
  color: var(--ui-kcc-ink);
  font-family: var(--aui-font, -apple-system, BlinkMacSystemFont, "PingFang SC", "Inter", sans-serif);
  -webkit-font-smoothing: antialiased;
}

:where(.dark, [data-theme="dark"]) .ui-kcc {
  --ui-kcc-surface: var(--aui-surface, #18181b);
  --ui-kcc-strong: var(--aui-ink, #fafafa);
  --ui-kcc-ink: var(--aui-ink, rgba(255, 255, 255, 0.9));
  --ui-kcc-muted: var(--aui-muted, rgba(255, 255, 255, 0.6));
  --ui-kcc-faint: var(--aui-placeholder, rgba(255, 255, 255, 0.35));
  --ui-kcc-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-kcc-shadow: var(--aui-shadow-card, 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 4px 16px rgba(0, 0, 0, 0.4));
  --ui-kcc-ok: var(--aui-green, #3fb950);
  --ui-kcc-bad: var(--aui-red, #f85149);
  --ui-kcc-pop: var(--aui-overlay, #202024);
  --ui-kcc-pop-shadow: 0 8px 24px rgba(0, 0, 0, 0.55), 0 0 0 0.5px rgba(255, 255, 255, 0.12);
}

.ui-kcc__top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ui-kcc__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-kcc-muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ui-kcc__action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ui-kcc__hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.ui-kcc__headline {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
}

.ui-kcc__value {
  font-size: 28px;
  line-height: 1.15;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--ui-kcc-strong);
  font-variant-numeric: tabular-nums;
}

.ui-kcc__delta {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ui-kcc__delta[data-sign="up"] {
  background: var(--ui-kcc-ok-bg);
  color: var(--ui-kcc-ok);
}
.ui-kcc__delta[data-sign="down"] {
  background: var(--ui-kcc-bad-bg);
  color: var(--ui-kcc-bad);
}
.ui-kcc__delta[data-sign="flat"] {
  background: var(--aui-subtle, rgba(0, 0, 0, 0.05));
  color: var(--ui-kcc-muted);
}

.ui-kcc__subs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.ui-kcc__plot {
  position: relative;
  width: 100%;
  outline: none;
  touch-action: pan-y;
  cursor: crosshair;
  border-radius: 6px;
}

.ui-kcc__plot:focus-visible {
  outline: 2px solid var(--aui-focus, rgba(0, 112, 243, 0.65));
  outline-offset: 2px;
}

.ui-kcc__svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.ui-kcc__cliprect {
  transition: width 680ms var(--ui-kcc-ease);
}

@media (prefers-reduced-motion: reduce) {
  .ui-kcc__cliprect {
    transition: none;
  }
}

.ui-kcc__grid {
  stroke: var(--ui-kcc-line);
  stroke-dasharray: 2 3;
}

.ui-kcc__refline {
  stroke: var(--ui-kcc-faint);
  stroke-width: 1;
  stroke-dasharray: 5 4;
}

.ui-kcc__reflabel {
  fill: var(--ui-kcc-muted);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.ui-kcc__tick {
  fill: var(--ui-kcc-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.ui-kcc__guide {
  stroke: var(--ui-kcc-faint);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.ui-kcc__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ui-kcc-muted);
  font-size: 12.5px;
}

.ui-kcc__tip {
  position: absolute;
  top: 10px;
  z-index: 5;
  min-width: 148px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--ui-kcc-pop);
  box-shadow: var(--ui-kcc-pop-shadow);
  pointer-events: none;
  font-size: 11.5px;
}

.ui-kcc__tip-head {
  font-weight: 600;
  color: var(--ui-kcc-strong);
  margin-bottom: 5px;
}

.ui-kcc__tip-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ui-kcc__tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ui-kcc__tip-name {
  color: var(--ui-kcc-muted);
  flex: 1;
}

.ui-kcc__tip-val {
  color: var(--ui-kcc-strong);
  font-variant-numeric: tabular-nums;
}

.ui-kcc__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.ui-kcc__foot {
  margin-top: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  color: var(--ui-kcc-muted);
}

.ui-kcc__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}

.ui-kcc__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.ui-kcc__dash-swatch {
  width: 12px;
  border-top: 1.5px dashed var(--ui-kcc-muted);
}

.ui-kcc__footer-text {
  color: var(--ui-kcc-muted);
}
`;
