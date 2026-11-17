"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

/*
 * Usage Meter – Clean style (affectUI Pro specification).
 * Segmented multi-category progress bar with smooth count-up, keyboard ←/→ stepping,
 * sub-limit thin tracks (including unlimited "of ∞" track), and warning/limit colors.
 */

export type UsagePart = {
  label: string;
  value: number;
  color?: string;
};

export type UsageLimit = {
  label: string;
  used: number;
  total?: number | null;
  unit?: string;
  decimals?: number;
};

export type UsageDaily = {
  label: string;
  value: number | null;
};

export type UsagePeriod = {
  id: string;
  label: string;
};

export type UsageMeterProps = {
  total: number;
  used: UsagePart[];
  limits?: UsageLimit[];
  periods?: UsagePeriod[];
  period?: string;
  defaultPeriod?: string;
  onPeriodChange?: (id: string) => void;
  resetAt?: Date | string | number;
  daily?: UsageDaily[];
  onUpgrade?: (state: "ok" | "warn" | "limit") => void;
  title?: ReactNode;
  plan?: ReactNode;
  unit?: string;
  warnAt?: number;
  upgradeLabel?: string;
  topUpLabel?: string;
  /** Embeddable frameless variant when already sitting inside another chart card */
  bare?: boolean;
  className?: string;
};

const DEFAULT_TINTS = ["#0070f3", "#3b82f6", "#60a5fa", "#93c5fd", "#a1a1aa"];

const numFmt = (v: number, decimals = 0) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);

export function UsageMeter({
  total,
  used,
  limits,
  periods,
  period: controlledPeriod,
  defaultPeriod,
  onPeriodChange,
  resetAt,
  daily,
  onUpgrade,
  title = "Usage",
  plan,
  unit = "credits",
  warnAt = 0.8,
  upgradeLabel = "Upgrade",
  topUpLabel = "Add credits",
  bare = false,
  className,
}: UsageMeterProps) {
  const uid = useId();
  const [internalPeriod, setInternalPeriod] = useState(defaultPeriod ?? periods?.[0]?.id ?? "");
  const activePeriod = controlledPeriod ?? internalPeriod;
  const [activePartIdx, setActivePartIdx] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setProgress(1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 620;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total, activePeriod, used.map((u) => u.value).join("|")]);

  const totalUsed = useMemo(
    () => used.reduce((acc, u) => acc + Math.max(0, u.value), 0),
    [used],
  );
  const safeTotal = Math.max(1, total);
  const share = Math.min(1.5, totalUsed / safeTotal);
  const state: "ok" | "warn" | "limit" =
    share >= 1 ? "limit" : share >= warnAt ? "warn" : "ok";

  const resetDays = useMemo(() => {
    if (!resetAt) return null;
    const targetMs =
      typeof resetAt === "number"
        ? resetAt
        : resetAt instanceof Date
        ? resetAt.getTime()
        : Date.parse(resetAt);
    if (Number.isNaN(targetMs)) return null;
    return Math.max(0, Math.ceil((targetMs - Date.now()) / (1000 * 60 * 60 * 24)));
  }, [resetAt]);

  const animatedUsed = totalUsed * progress;
  const displayPct = Math.min(100, (totalUsed / safeTotal) * 100 * progress);

  const hasDecimal = used.some((u) => Math.abs(u.value % 1) > 0.001);
  const dec = hasDecimal ? 2 : 0;

  return (
    <>
      <style href="ui-usage-meter-clean" precedence="default">
        {css}
      </style>
      <section
        className={["ui-umc", className].filter(Boolean).join(" ")}
        data-bare={bare || undefined}
        data-state={state}
        aria-labelledby={uid}
      >
        {!bare && (
          <header className="ui-umc__head">
            <div className="ui-umc__titles">
              <h3 id={uid} className="ui-umc__title">
                {title}
              </h3>
              {(plan || resetDays !== null) && (
                <p className="ui-umc__meta">
                  {plan}
                  {plan && resetDays !== null ? " · " : ""}
                  {resetDays !== null ? `Resets in ${resetDays}d` : ""}
                </p>
              )}
            </div>

            {periods && periods.length > 0 && (
              <div className="ui-umc__periods" role="radiogroup" aria-label="计量周期">
                {periods.map((p) => {
                  const selected = activePeriod === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className="ui-umc__period-btn"
                      data-selected={selected || undefined}
                      onClick={() => {
                        if (controlledPeriod === undefined) setInternalPeriod(p.id);
                        onPeriodChange?.(p.id);
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}
          </header>
        )}

        <div className="ui-umc__summary">
          <div className="ui-umc__nums">
            <strong className="ui-umc__used">{numFmt(animatedUsed, dec)}</strong>
            <span className="ui-umc__of">
              / {numFmt(total, Number.isInteger(total) ? 0 : dec)} {unit}
            </span>
          </div>
          <span className="ui-umc__pct" data-state={state}>
            {displayPct.toFixed(1)}%
          </span>
        </div>

        {/* Main Segmented Bar */}
        <div
          className="ui-umc__track"
          role="meter"
          aria-label={typeof title === "string" ? title : "Usage meter"}
          aria-valuemin={0}
          aria-valuemax={safeTotal}
          aria-valuenow={Math.round(totalUsed)}
          aria-valuetext={`${numFmt(totalUsed, dec)} of ${numFmt(total, dec)} ${unit}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (used.length === 0) return;
            if (e.key === "ArrowRight") {
              e.preventDefault();
              setActivePartIdx((prev) => (prev === null ? 0 : Math.min(used.length - 1, prev + 1)));
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              setActivePartIdx((prev) => (prev === null ? used.length - 1 : Math.max(0, prev - 1)));
            } else if (e.key === "Escape") {
              setActivePartIdx(null);
            }
          }}
          onBlur={() => setActivePartIdx(null)}
        >
          {used.map((part, idx) => {
            const pct = Math.min(100, (Math.max(0, part.value) / safeTotal) * 100 * progress);
            const color = part.color ?? DEFAULT_TINTS[idx % DEFAULT_TINTS.length];
            const dimmed = activePartIdx !== null && activePartIdx !== idx;
            return (
              <div
                key={part.label}
                className="ui-umc__seg"
                style={{
                  width: `${pct}%`,
                  background: color,
                  opacity: dimmed ? 0.35 : 1,
                }}
                onPointerEnter={() => setActivePartIdx(idx)}
                onPointerLeave={() => setActivePartIdx(null)}
                onClick={() => setActivePartIdx((cur) => (cur === idx ? null : idx))}
              />
            );
          })}
        </div>

        {/* Category Legend */}
        <div className="ui-umc__legend" aria-live="polite">
          {used.map((part, idx) => {
            const color = part.color ?? DEFAULT_TINTS[idx % DEFAULT_TINTS.length];
            const active = activePartIdx === idx;
            return (
              <button
                key={part.label}
                type="button"
                className="ui-umc__leg-item"
                data-active={active || undefined}
                onPointerEnter={() => setActivePartIdx(idx)}
                onPointerLeave={() => setActivePartIdx(null)}
                onClick={() => setActivePartIdx((cur) => (cur === idx ? null : idx))}
              >
                <span className="ui-umc__dot" style={{ background: color }} aria-hidden="true" />
                <span className="ui-umc__leg-label">{part.label}</span>
                <strong className="ui-umc__leg-val">{numFmt(part.value * progress, dec)}</strong>
              </button>
            );
          })}
        </div>

        {/* Daily sparkline if passed */}
        {daily && daily.length > 0 && (
          <div className="ui-umc__spark" aria-label="每日趋势柱图">
            {(() => {
              const maxDay = Math.max(1, ...daily.map((d) => d.value ?? 0));
              return daily.map((d) => {
                const h = d.value == null ? 10 : Math.max(16, Math.round((d.value / maxDay) * 100));
                return (
                  <span
                    key={d.label}
                    className="ui-umc__spark-bar"
                    data-null={d.value == null || undefined}
                    title={`${d.label}: ${d.value == null ? "—" : numFmt(d.value, 1)}`}
                    style={{ height: `${h}%` }}
                  />
                );
              });
            })()}
          </div>
        )}

        {/* Thin limits sub-meters */}
        {limits && limits.length > 0 && (
          <div className="ui-umc__limits">
            {limits.map((lim) => {
              const unlimited = lim.total == null;
              const d = lim.decimals ?? (Math.abs(lim.used % 1) > 0.001 ? 2 : 0);
              const limPct = unlimited
                ? 42
                : Math.min(100, (lim.used / Math.max(1, lim.total ?? 1)) * 100 * progress);
              const limState = !unlimited && lim.total && lim.used / lim.total >= 1 ? "limit" : "ok";
              return (
                <div key={lim.label} className="ui-umc__limit-row">
                  <div className="ui-umc__limit-head">
                    <span className="ui-umc__limit-label">{lim.label}</span>
                    <span className="ui-umc__limit-val">
                      <strong>{numFmt(lim.used * progress, d)}</strong>
                      {" / "}
                      {unlimited ? "∞" : numFmt(lim.total!, Number.isInteger(lim.total!) ? 0 : d)}
                      {lim.unit ? ` ${lim.unit}` : ""}
                    </span>
                  </div>
                  <div className="ui-umc__limit-track" data-unlimited={unlimited || undefined}>
                    {!unlimited && (
                      <div
                        className="ui-umc__limit-fill"
                        data-state={limState}
                        style={{ width: `${limPct}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {onUpgrade && (
          <div className="ui-umc__actions">
            <button
              type="button"
              className="ui-umc__cta"
              data-state={state}
              onClick={() => onUpgrade(state)}
            >
              {state === "ok" ? upgradeLabel : topUpLabel}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

const css = /* css */ `
.ui-umc {
  --ui-umc-surface: var(--aui-surface, #ffffff);
  --ui-umc-strong: var(--aui-ink, #09090b);
  --ui-umc-ink: var(--aui-ink, rgba(0, 0, 0, 0.88));
  --ui-umc-muted: var(--aui-muted, rgba(0, 0, 0, 0.56));
  --ui-umc-line: var(--aui-border, rgba(0, 0, 0, 0.08));
  --ui-umc-track: var(--aui-subtle, rgba(0, 0, 0, 0.065));
  --ui-umc-shadow: var(--aui-shadow-card, 0 0 0 0.5px rgba(0, 0, 0, 0.07), 0 1px 2px rgba(0, 0, 0, 0.04));
  --ui-umc-accent: var(--aui-blue, #0070f3);
  --ui-umc-warn: var(--aui-amber, #d97706);
  --ui-umc-bad: var(--aui-red, #dc2626);
  --ui-umc-radius: var(--aui-radius-lg, 12px);
  --ui-umc-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));

  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  padding: 20px 22px;
  border-radius: var(--ui-umc-radius);
  background: var(--ui-umc-surface);
  box-shadow: var(--ui-umc-shadow);
  color: var(--ui-umc-ink);
  font-family: var(--aui-font, -apple-system, BlinkMacSystemFont, "PingFang SC", "Inter", sans-serif);
}

.ui-umc[data-bare="true"] {
  padding: 0;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
}

:where(.dark, [data-theme="dark"]) .ui-umc:not([data-bare="true"]) {
  --ui-umc-surface: var(--aui-surface, #18181b);
  --ui-umc-shadow: var(--aui-shadow-card, 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 4px 16px rgba(0, 0, 0, 0.4));
}

:where(.dark, [data-theme="dark"]) .ui-umc {
  --ui-umc-strong: var(--aui-ink, #fafafa);
  --ui-umc-ink: var(--aui-ink, rgba(255, 255, 255, 0.9));
  --ui-umc-muted: var(--aui-muted, rgba(255, 255, 255, 0.6));
  --ui-umc-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-umc-track: rgba(255, 255, 255, 0.08);
  --ui-umc-warn: #f59e0b;
  --ui-umc-bad: #f85149;
}

.ui-umc__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ui-umc__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-umc-strong);
}

.ui-umc__meta {
  margin: 2px 0 0;
  font-size: 11.5px;
  color: var(--ui-umc-muted);
}

.ui-umc__periods {
  display: inline-flex;
  padding: 2px;
  border-radius: 7px;
  background: var(--ui-umc-track);
}

.ui-umc__period-btn {
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11.5px;
  color: var(--ui-umc-muted);
  cursor: pointer;
  border: 0;
  background: transparent;
}
.ui-umc__period-btn[data-selected="true"] {
  background: var(--ui-umc-surface);
  color: var(--ui-umc-strong);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.ui-umc__summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}

.ui-umc__nums {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}

.ui-umc__used {
  font-size: 16px;
  font-weight: 650;
  color: var(--ui-umc-strong);
}

.ui-umc__of {
  font-size: 12px;
  color: var(--ui-umc-muted);
}

.ui-umc__pct {
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-umc-muted);
}
.ui-umc__pct[data-state="warn"] {
  color: var(--ui-umc-warn);
}
.ui-umc__pct[data-state="limit"] {
  color: var(--ui-umc-bad);
}

.ui-umc__track {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 10px;
  border-radius: 999px;
  background: var(--ui-umc-track);
  overflow: hidden;
  outline: none;
}

.ui-umc__track:focus-visible {
  outline: 2px solid var(--aui-focus, rgba(0, 112, 243, 0.65));
  outline-offset: 2px;
}

.ui-umc__seg {
  height: 100%;
  cursor: pointer;
  transition: width 320ms var(--ui-umc-ease), opacity 140ms ease;
}

.ui-umc__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.ui-umc__leg-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 4px;
  margin: -2px -4px;
  border-radius: 5px;
  border: 0;
  background: transparent;
  color: var(--ui-umc-muted);
  font-size: 11.5px;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.ui-umc__leg-item:hover,
.ui-umc__leg-item[data-active="true"] {
  background: var(--ui-umc-track);
  color: var(--ui-umc-strong);
}

.ui-umc__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.ui-umc__leg-val {
  color: var(--ui-umc-strong);
  font-variant-numeric: tabular-nums;
}

.ui-umc__spark {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 28px;
}

.ui-umc__spark-bar {
  flex: 1;
  border-radius: 2px 2px 0 0;
  background: var(--ui-umc-accent);
  opacity: 0.78;
}

.ui-umc__spark-bar[data-null="true"] {
  background: var(--ui-umc-track);
  opacity: 1;
}

.ui-umc__limits {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--ui-umc-line);
}

.ui-umc__limit-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ui-umc__limit-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.ui-umc__limit-label {
  color: var(--ui-umc-muted);
}

.ui-umc__limit-val {
  color: var(--ui-umc-muted);
}

.ui-umc__limit-val strong {
  color: var(--ui-umc-strong);
  font-weight: 600;
}

.ui-umc__limit-track {
  height: 5px;
  border-radius: 999px;
  background: var(--ui-umc-track);
  overflow: hidden;
}

.ui-umc__limit-track[data-unlimited="true"] {
  background: repeating-linear-gradient(
    -45deg,
    var(--ui-umc-track),
    var(--ui-umc-track) 6px,
    transparent 6px,
    transparent 12px
  );
}

.ui-umc__limit-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--ui-umc-accent);
  transition: width 320ms var(--ui-umc-ease);
}

.ui-umc__limit-fill[data-state="limit"] {
  background: var(--ui-umc-bad);
}

.ui-umc__actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}

.ui-umc__cta {
  height: 28px;
  padding: 0 11px;
  border-radius: 7px;
  border: 0;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  background: var(--ui-umc-surface);
  color: var(--ui-umc-strong);
  box-shadow: var(--ui-umc-shadow);
}
.ui-umc__cta[data-state="warn"],
.ui-umc__cta[data-state="limit"] {
  background: var(--ui-umc-strong);
  color: var(--ui-umc-surface);
}
`;
