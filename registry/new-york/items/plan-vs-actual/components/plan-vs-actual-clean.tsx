"use client";

import { useMemo, useState, type ReactNode } from "react";

/*
 * Plan vs Actual – Clean style (.ui-pvac, affectUI Pro specification).
 * Every step's actual bar grows over its dashed planned ghost; overruns turn amber/red,
 * steps waiting on deps slide right dynamically, and hovering highlights dependency connectors.
 */

export type PlanStep = {
  id: string;
  title: string;
  /** How long it was planned to take (in ms or caller's scaled unit) */
  plan: number;
  /** Ids of prerequisite steps */
  deps?: string[];
  /** Actual start offset from run start */
  start?: number;
  /** Actual end offset from run start (omit while running) */
  end?: number;
  /** Optional small icon before title */
  icon?: ReactNode;
  /** Optional click callback to drill down */
  onClick?: () => void;
};

export type PlanVsActualProps = {
  steps: PlanStep[];
  /** Current run clock in ms */
  now: number;
  /** Short subtitle / task name next to heading */
  task?: string;
  /** Formats axis, bars and finish markers (defaults to m:ss) */
  formatTime?: (ms: number) => string;
  /** Card heading */
  title?: ReactNode;
  /** Optional top-right action slot */
  action?: ReactNode;
  className?: string;
};

function defaultFormatTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type ComputedStep = PlanStep & {
  index: number;
  plannedStart: number;
  plannedEnd: number;
  actualStart: number;
  actualEnd: number;
  actualDuration: number;
  overrun: number;
  status: "done" | "running" | "waiting" | "over";
};

export function PlanVsActual({
  steps,
  now,
  task,
  formatTime = defaultFormatTime,
  title = "Plan vs actual",
  action,
  className,
}: PlanVsActualProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const computed = useMemo<ComputedStep[]>(() => {
    const byId = new Map<string, ComputedStep>();
    return steps.map((step, index) => {
      const depItems = (step.deps ?? []).map((id) => byId.get(id)).filter((d): d is ComputedStep => Boolean(d));
      const plannedStart = depItems.length > 0 ? Math.max(...depItems.map((d) => d.plannedEnd)) : 0;
      const plannedEnd = plannedStart + Math.max(1, step.plan);

      const depActualMax = depItems.length > 0 ? Math.max(...depItems.map((d) => d.actualEnd)) : 0;
      const actualStart = step.start !== undefined ? step.start : Math.max(now, depActualMax);
      const isFinished = step.end !== undefined;
      const isRunning = step.start !== undefined && step.end === undefined;

      const actualEnd = isFinished
        ? step.end!
        : isRunning
        ? Math.max(now, actualStart + step.plan * 0.15)
        : actualStart + step.plan;

      const actualDuration = Math.max(0, actualEnd - actualStart);
      const overrun = actualDuration - step.plan;
      const status: ComputedStep["status"] =
        overrun > step.plan * 0.05
          ? "over"
          : isFinished
          ? "done"
          : isRunning
          ? "running"
          : "waiting";

      const row: ComputedStep = {
        ...step,
        index,
        plannedStart,
        plannedEnd,
        actualStart,
        actualEnd,
        actualDuration,
        overrun,
        status,
      };
      byId.set(step.id, row);
      return row;
    });
  }, [steps, now]);

  const plannedFinish = useMemo(
    () => Math.max(1, ...computed.map((s) => s.plannedEnd)),
    [computed],
  );
  const expectedFinish = useMemo(
    () => Math.max(plannedFinish, ...computed.map((s) => s.actualEnd)),
    [computed, plannedFinish],
  );
  const axisMax = Math.max(1, expectedFinish * 1.06);
  const finishDelta = expectedFinish - plannedFinish;

  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / axisMax) * 100)).toFixed(2)}%`;

  const relatedIds = useMemo(() => {
    if (!hoveredId) return new Set<string>();
    const set = new Set<string>([hoveredId]);
    const target = computed.find((s) => s.id === hoveredId);
    target?.deps?.forEach((d) => set.add(d));
    for (const s of computed) {
      if (s.deps?.includes(hoveredId)) set.add(s.id);
    }
    return set;
  }, [hoveredId, computed]);

  return (
    <>
      <style href="ui-plan-vs-actual-clean" precedence="default">
        {css}
      </style>
      <section className={["ui-pvac", className].filter(Boolean).join(" ")} aria-label={typeof title === "string" ? title : "Plan vs actual"}>
        <header className="ui-pvac__head">
          <div className="ui-pvac__titles">
            <h3 className="ui-pvac__title">{title}</h3>
            {task && <span className="ui-pvac__task">{task}</span>}
          </div>
          <div className="ui-pvac__head-right">
            <div className="ui-pvac__legend" aria-hidden="true">
              <span className="ui-pvac__leg">
                <i className="ui-pvac__swatch ui-pvac__swatch--plan" /> 标准
              </span>
              <span className="ui-pvac__leg">
                <i className="ui-pvac__swatch ui-pvac__swatch--actual" /> 正常
              </span>
              <span className="ui-pvac__leg">
                <i className="ui-pvac__swatch ui-pvac__swatch--over" /> 超标
              </span>
            </div>
            {action}
          </div>
        </header>

        {/* Rows + visual track */}
        <div className="ui-pvac__body">
          <div className="ui-pvac__list" role="list">
            {computed.map((step) => {
              const dim = hoveredId !== null && !relatedIds.has(step.id);
              const withinDur = Math.min(step.actualDuration, step.plan);
              const overDur = Math.max(0, step.actualDuration - step.plan);
              const hasOver = overDur > step.plan * 0.02;
              const deltaText =
                hasOver
                  ? `+${formatTime(overDur)}`
                  : step.status === "done" && step.actualDuration <= step.plan
                  ? `${formatTime(step.actualDuration)}`
                  : formatTime(step.actualDuration);

              return (
                <div
                  key={step.id}
                  role="listitem"
                  tabIndex={0}
                  data-status={step.status}
                  data-dim={dim || undefined}
                  data-clickable={Boolean(step.onClick) || undefined}
                  aria-label={`${step.title}: 实际 ${formatTime(step.actualDuration)}, 计划 ${formatTime(step.plan)}${hasOver ? `, 超时 ${formatTime(overDur)}` : ""}`}
                  className="ui-pvac__row"
                  onPointerEnter={() => setHoveredId(step.id)}
                  onPointerLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(step.id)}
                  onBlur={() => setHoveredId(null)}
                  onClick={() => step.onClick?.()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      if (step.onClick) {
                        e.preventDefault();
                        step.onClick();
                      }
                    }
                  }}
                >
                  <div className="ui-pvac__name-col">
                    {step.icon && <span className="ui-pvac__icon" aria-hidden="true">{step.icon}</span>}
                    <span className="ui-pvac__name" title={step.title}>{step.title}</span>
                  </div>

                  <div className="ui-pvac__track-col" aria-hidden="true">
                    {/* Vertical finish guides */}
                    <span className="ui-pvac__finish-guide" style={{ left: pct(plannedFinish) }} />
                    {finishDelta > axisMax * 0.01 && (
                      <span className="ui-pvac__expected-guide" style={{ left: pct(expectedFinish) }} />
                    )}

                    {/* Dashed planned ghost */}
                    <div
                      className="ui-pvac__ghost"
                      style={{
                        left: pct(step.plannedStart),
                        width: pct(step.plan),
                      }}
                    />

                    {/* Actual bar */}
                    <div
                      className="ui-pvac__bar"
                      style={{
                        left: pct(step.actualStart),
                        width: pct(withinDur + overDur),
                      }}
                    >
                      <span
                        className="ui-pvac__bar-main"
                        style={{
                          width: `${withinDur + overDur > 0 ? (withinDur / (withinDur + overDur)) * 100 : 100}%`,
                        }}
                      />
                      {hasOver && (
                        <span
                          className="ui-pvac__bar-over"
                          style={{
                            width: `${(overDur / (withinDur + overDur)) * 100}%`,
                          }}
                        />
                      )}
                      {step.status === "running" && <span className="ui-pvac__edge" />}
                    </div>
                  </div>

                  <div className="ui-pvac__meta-col" data-over={hasOver || undefined}>
                    <span className="ui-pvac__dur">{formatTime(step.actualDuration)}</span>
                    <span className="ui-pvac__ref">
                      {hasOver ? deltaText : `/ ${formatTime(step.plan)}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom Axis */}
          <div
            className="ui-pvac__axis"
            data-tight={finishDelta > 0 && finishDelta / axisMax < 0.16 ? "true" : undefined}
            aria-hidden="true"
          >
            <div className="ui-pvac__name-col" />
            <div className="ui-pvac__axis-track">
              <span className="ui-pvac__axis-mark" style={{ left: "0%" }}>
                {formatTime(0)}
              </span>
              <span className="ui-pvac__axis-mark ui-pvac__axis-mark--plan" style={{ left: pct(plannedFinish) }}>
                标准 {formatTime(plannedFinish)}
              </span>
              {finishDelta > axisMax * 0.02 && (
                <span className="ui-pvac__axis-mark ui-pvac__axis-mark--over" style={{ left: pct(expectedFinish) }}>
                  实际 {formatTime(expectedFinish)}
                </span>
              )}
            </div>
            <div className="ui-pvac__meta-col" />
          </div>
        </div>
      </section>
    </>
  );
}

const css = /* css */ `
.ui-pvac {
  --ui-pvac-surface: var(--aui-surface, #ffffff);
  --ui-pvac-strong: var(--aui-ink, #09090b);
  --ui-pvac-ink: var(--aui-ink, rgba(0, 0, 0, 0.88));
  --ui-pvac-muted: var(--aui-muted, rgba(0, 0, 0, 0.56));
  --ui-pvac-line: var(--aui-border, rgba(0, 0, 0, 0.075));
  --ui-pvac-track: rgba(0, 0, 0, 0.04);
  --ui-pvac-shadow: var(--aui-shadow-card, 0 0 0 0.5px rgba(0, 0, 0, 0.07), 0 1px 2px rgba(0, 0, 0, 0.04));
  --ui-pvac-actual-bg: var(--aui-blue, #2563eb);
  --ui-pvac-actual-edge: #60a5fa;
  --ui-pvac-over-bg: var(--aui-red, #ef4444);
  --ui-pvac-over-fg: var(--aui-danger, #c82820);
  --ui-pvac-ghost: rgba(0, 0, 0, 0.25);
  --ui-pvac-radius: var(--aui-radius-lg, 12px);
  --ui-pvac-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));

  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  padding: 20px 22px;
  border-radius: var(--ui-pvac-radius);
  background: var(--ui-pvac-surface);
  box-shadow: var(--ui-pvac-shadow);
  color: var(--ui-pvac-ink);
  font-family: var(--aui-font, -apple-system, BlinkMacSystemFont, "PingFang SC", "Inter", sans-serif);
}

:where(.dark, [data-theme="dark"]) .ui-pvac {
  --ui-pvac-surface: var(--aui-surface, #18181b);
  --ui-pvac-strong: var(--aui-ink, #fafafa);
  --ui-pvac-ink: var(--aui-ink, rgba(255, 255, 255, 0.9));
  --ui-pvac-muted: var(--aui-muted, rgba(255, 255, 255, 0.58));
  --ui-pvac-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-pvac-track: rgba(255, 255, 255, 0.05);
  --ui-pvac-shadow: var(--aui-shadow-card, 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 4px 16px rgba(0, 0, 0, 0.4));
  --ui-pvac-ghost: rgba(255, 255, 255, 0.28);
  --ui-pvac-over-fg: #f87171;
}

.ui-pvac__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ui-pvac__titles {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.ui-pvac__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-pvac-strong);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ui-pvac__task {
  font-size: 12px;
  color: var(--ui-pvac-muted);
}

.ui-pvac__head-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ui-pvac__legend {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--ui-pvac-muted);
}

.ui-pvac__leg {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ui-pvac__swatch {
  display: inline-block;
  width: 9px;
  height: 7px;
  border-radius: 2px;
}
.ui-pvac__swatch--plan {
  border: 1px dashed var(--ui-pvac-ghost);
}
.ui-pvac__swatch--actual {
  background: var(--ui-pvac-actual-bg);
}
.ui-pvac__swatch--over {
  background: var(--ui-pvac-over-bg);
}

.ui-pvac__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ui-pvac__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ui-pvac__row {
  display: grid;
  grid-template-columns: 112px 1fr 82px;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  padding: 2px 4px;
  border-radius: 6px;
  transition: opacity 150ms ease, background-color 150ms ease;
}
.ui-pvac__row[data-clickable="true"] {
  cursor: pointer;
}
.ui-pvac__row:hover,
.ui-pvac__row:focus-visible {
  background: var(--ui-pvac-track);
}
.ui-pvac__row:focus-visible {
  outline: 2px solid var(--aui-focus, rgba(0, 112, 243, 0.65));
  outline-offset: 2px;
}
.ui-pvac__row[data-dim="true"] {
  opacity: 0.4;
}

@media (max-width: 560px) {
  .ui-pvac__row {
    grid-template-columns: 84px 1fr 70px;
    gap: 8px;
  }
  .ui-pvac__task,
  .ui-pvac__legend {
    display: none;
  }
}

.ui-pvac__name-col {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ui-pvac__name {
  font-size: 12px;
  font-weight: 500;
  color: var(--ui-pvac-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-pvac__track-col {
  position: relative;
  height: 22px;
  border-radius: 5px;
  background: var(--ui-pvac-track);
}

.ui-pvac__finish-guide {
  position: absolute;
  top: -4px;
  bottom: -4px;
  border-left: 1px dashed var(--ui-pvac-ghost);
  pointer-events: none;
}

.ui-pvac__expected-guide {
  position: absolute;
  top: -4px;
  bottom: -4px;
  border-left: 1px dashed var(--ui-pvac-over-bg);
  opacity: 0.65;
  pointer-events: none;
}

.ui-pvac__ghost {
  position: absolute;
  top: 2px;
  bottom: 2px;
  border-radius: 4px;
  border: 1px dashed var(--ui-pvac-ghost);
  pointer-events: none;
}

.ui-pvac__bar {
  position: absolute;
  top: 4px;
  bottom: 4px;
  display: flex;
  border-radius: 4px;
  overflow: hidden;
  transition: left 360ms var(--ui-pvac-ease), width 360ms var(--ui-pvac-ease);
}

.ui-pvac__bar-main {
  height: 100%;
  background: var(--ui-pvac-actual-bg);
}

.ui-pvac__bar-over {
  height: 100%;
  background: var(--ui-pvac-over-bg);
}

.ui-pvac__edge {
  width: 3px;
  height: 100%;
  background: var(--ui-pvac-actual-edge);
  box-shadow: 0 0 8px var(--ui-pvac-actual-edge);
}

.ui-pvac__meta-col {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 4px;
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}

.ui-pvac__dur {
  font-weight: 600;
  color: var(--ui-pvac-strong);
}

.ui-pvac__ref {
  color: var(--ui-pvac-muted);
  font-size: 11px;
}

.ui-pvac__meta-col[data-over="true"] .ui-pvac__dur,
.ui-pvac__meta-col[data-over="true"] .ui-pvac__ref {
  color: var(--ui-pvac-over-fg);
  font-weight: 600;
}

.ui-pvac__axis {
  display: grid;
  grid-template-columns: 112px 1fr 82px;
  gap: 12px;
  margin-top: 4px;
}

@media (max-width: 560px) {
  .ui-pvac__axis {
    grid-template-columns: 84px 1fr 70px;
    gap: 8px;
  }
}

.ui-pvac__axis-track {
  position: relative;
  height: 18px;
  overflow: visible;
}

.ui-pvac__axis-mark {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  font-size: 10.5px;
  color: var(--ui-pvac-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.ui-pvac__axis-mark:first-child {
  transform: none;
}
.ui-pvac__axis[data-tight="true"] .ui-pvac__axis-mark--plan {
  transform: translateX(-106%);
}
.ui-pvac__axis-mark--over {
  color: var(--ui-pvac-over-fg);
  font-weight: 600;
  transform: translateX(-12%);
}
`;
