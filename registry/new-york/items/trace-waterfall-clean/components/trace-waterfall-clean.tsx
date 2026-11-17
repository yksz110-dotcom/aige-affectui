"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/*
 * Trace Waterfall (Clean) – A timeline of an agent run: how long each agent, model call
 * and tool took, what it cost and where it failed.
 * Matches affectUI New York Clean specification (.ui-trwc).
 */

export type TraceSpanKind = "agent" | "subagent" | "llm" | "tool";
export type TraceSpanStatus = "running" | "done" | "failed";

export type TraceSpan = {
  id: string;
  name: string;
  kind: TraceSpanKind;
  status: TraceSpanStatus;
  /** Offset in ms from the start of the run */
  start: number;
  /** Offset in ms from the start of the run – omit while status is "running" */
  end?: number;
  /** Short note shown next to the name, e.g. "12 hits" or "src/auth/session.ts" */
  detail?: string;
  /** Optional custom icon for the span row */
  icon?: ReactNode;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  /** Cost in USD (or custom unit via formatCost) */
  cost?: number;
  input?: string;
  output?: string;
  error?: string;
  children?: TraceSpan[];
};

export type TraceWaterfallProps = {
  /** Root span of the trace – its children form the tree */
  root: TraceSpan;
  /** Current run clock in ms from the start – omit to let running traces tick on their own */
  now?: number;
  /** Wall-clock timestamp (ms or Date.now()) when the run started – drives the live timer */
  startedAt?: number;
  /** Controlled list of folded span ids */
  collapsed?: string[];
  /** Initially folded span ids (uncontrolled) */
  defaultCollapsed?: string[];
  onCollapsedChange?: (collapsed: string[]) => void;
  /** Controlled id of the span shown in the detail sheet */
  openId?: string | null;
  /** Initially open span id (uncontrolled) */
  defaultOpenId?: string | null;
  onOpenChange?: (id: string | null, span?: TraceSpan) => void;
  /** Marks the slowest leaf or sub-span with a badge */
  markSlowest?: boolean;
  /** Minimum axis length in ms so short runs don't stretch edge to edge */
  minRange?: number;
  /** Formats a cost number – defaults to USD ("$0.042") */
  formatCost?: (amount: number) => string;
  /** Formats a duration in ms – defaults to "800ms", "1.2s", "2m 04s" */
  formatDuration?: (ms: number) => string;
  /** Heading in the top bar */
  title?: string;
  className?: string;
};

type FlatRow = {
  span: TraceSpan;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  guides: boolean[];
};

function defaultFormatCost(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(3)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

function defaultFormatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 1000) return `${Math.round(safe)}ms`;
  const sec = safe / 1000;
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${m}m ${rem}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function collectAllSpans(span: TraceSpan, out: TraceSpan[] = []): TraceSpan[] {
  out.push(span);
  if (span.children) {
    for (const c of span.children) collectAllSpans(c, out);
  }
  return out;
}

export function TraceWaterfall({
  root,
  now: controlledNow,
  startedAt,
  collapsed: controlledCollapsed,
  defaultCollapsed = [],
  onCollapsedChange,
  openId: controlledOpenId,
  defaultOpenId = null,
  onOpenChange,
  markSlowest = true,
  minRange = 10000,
  formatCost = defaultFormatCost,
  formatDuration: customFormatDuration,
  title = "Trace",
  className,
}: TraceWaterfallProps) {
  const fmtDuration = customFormatDuration ?? defaultFormatDuration;
  const [internalCollapsed, setInternalCollapsed] = useState<string[]>(defaultCollapsed);
  const [internalOpenId, setInternalOpenId] = useState<string | null>(defaultOpenId);
  const [focusId, setFocusId] = useState<string>(root.id);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const collapsedSet = useMemo(
    () => new Set(controlledCollapsed ?? internalCollapsed),
    [controlledCollapsed, internalCollapsed],
  );
  const openId = controlledOpenId !== undefined ? controlledOpenId : internalOpenId;

  const allSpans = useMemo(() => collectAllSpans(root, []), [root]);
  const hasRunning = useMemo(
    () => allSpans.some((s) => s.status === "running"),
    [allSpans],
  );
  const maxEnd = useMemo(
    () =>
      allSpans.reduce(
        (acc, s) => Math.max(acc, s.end ?? s.start + 1200),
        minRange,
      ),
    [allSpans, minRange],
  );

  const [tickNow, setTickNow] = useState<number>(() => {
    if (controlledNow !== undefined) return controlledNow;
    if (startedAt !== undefined) return Math.max(maxEnd, Date.now() - startedAt);
    return maxEnd;
  });

  useEffect(() => {
    if (controlledNow !== undefined) {
      setTickNow(controlledNow);
      return;
    }
    if (!hasRunning) {
      setTickNow(maxEnd);
      return;
    }
    const baseWall = startedAt ?? Date.now() - maxEnd;
    const id = window.setInterval(() => {
      setTickNow(Math.max(maxEnd, Date.now() - baseWall));
    }, 100);
    return () => window.clearInterval(id);
  }, [controlledNow, hasRunning, maxEnd, startedAt]);

  const effectiveNow = controlledNow ?? tickNow;

  // Compute aggregate stats from leaf spans (or spans with direct metrics)
  const summary = useMemo(() => {
    let cost = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let llmCalls = 0;
    let toolCalls = 0;
    let errors = 0;

    for (const s of allSpans) {
      const isLeaf = !s.children || s.children.length === 0;
      if (isLeaf || s.kind === "llm" || s.kind === "tool") {
        if (typeof s.cost === "number") cost += s.cost;
        if (typeof s.tokensIn === "number") tokensIn += s.tokensIn;
        if (typeof s.tokensOut === "number") tokensOut += s.tokensOut;
      }
      if (s.kind === "llm") llmCalls += 1;
      if (s.kind === "tool") toolCalls += 1;
      if (s.status === "failed") errors += 1;
    }

    const rootEnd = root.end ?? effectiveNow;
    const duration = Math.max(0, rootEnd - root.start);
    return {
      duration,
      cost,
      tokens: tokensIn + tokensOut,
      llmCalls,
      toolCalls,
      errors,
    };
  }, [allSpans, root, effectiveNow]);

  // Find slowest non-root span
  const slowestId = useMemo(() => {
    if (!markSlowest) return null;
    let bestId: string | null = null;
    let bestDur = -1;
    for (const s of allSpans) {
      if (s.id === root.id) continue;
      const dur = (s.end ?? effectiveNow) - s.start;
      if (dur > bestDur) {
        bestDur = dur;
        bestId = s.id;
      }
    }
    return bestId;
  }, [allSpans, root.id, effectiveNow, markSlowest]);

  // Axis range & round ticks
  const axisRange = useMemo(() => {
    const raw = Math.max(minRange, maxEnd, effectiveNow);
    const step =
      raw <= 5000
        ? 1000
        : raw <= 15000
          ? 2500
          : raw <= 35000
            ? 5000
            : raw <= 90000
              ? 10000
              : 15000;
    const ceil = Math.ceil(raw / step) * step;
    const ticks: number[] = [];
    for (let t = 0; t <= ceil; t += step) ticks.push(t);
    return { max: ceil, ticks };
  }, [minRange, maxEnd, effectiveNow]);

  // Flatten visible tree rows
  const rows = useMemo(() => {
    const list: FlatRow[] = [];
    const walk = (span: TraceSpan, depth: number, guides: boolean[]) => {
      const hasChildren = Boolean(span.children && span.children.length > 0);
      const isExpanded = hasChildren && !collapsedSet.has(span.id);
      list.push({ span, depth, hasChildren, isExpanded, guides });
      if (hasChildren && isExpanded && span.children) {
        const len = span.children.length;
        span.children.forEach((child, idx) => {
          walk(child, depth + 1, [...guides, idx < len - 1]);
        });
      }
    };
    walk(root, 0, []);
    return list;
  }, [root, collapsedSet]);

  const toggleCollapse = (id: string) => {
    const next = new Set(collapsedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const arr = Array.from(next);
    if (controlledCollapsed === undefined) setInternalCollapsed(arr);
    onCollapsedChange?.(arr);
  };

  const selectOpen = (id: string | null) => {
    const found = id ? allSpans.find((s) => s.id === id) : undefined;
    if (controlledOpenId === undefined) setInternalOpenId(id);
    onOpenChange?.(id, found);
  };

  const openSpan = useMemo(
    () => (openId ? allSpans.find((s) => s.id === openId) ?? null : null),
    [openId, allSpans],
  );

  const handleTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>, idx: number, row: FlatRow) => {
    const { span, hasChildren, isExpanded } = row;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = rows[idx + 1];
      if (next) {
        setFocusId(next.span.id);
        rowRefs.current[next.span.id]?.focus();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = rows[idx - 1];
      if (prev) {
        setFocusId(prev.span.id);
        rowRefs.current[prev.span.id]?.focus();
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = rows[0];
      if (first) {
        setFocusId(first.span.id);
        rowRefs.current[first.span.id]?.focus();
      }
    } else if (e.key === "End") {
      e.preventDefault();
      const last = rows[rows.length - 1];
      if (last) {
        setFocusId(last.span.id);
        rowRefs.current[last.span.id]?.focus();
      }
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (hasChildren && !isExpanded) {
        toggleCollapse(span.id);
      } else if (hasChildren && isExpanded && rows[idx + 1]) {
        setFocusId(rows[idx + 1].span.id);
        rowRefs.current[rows[idx + 1].span.id]?.focus();
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (hasChildren && isExpanded) {
        toggleCollapse(span.id);
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectOpen(openId === span.id ? null : span.id);
    } else if (e.key === "Escape" && openId) {
      e.preventDefault();
      selectOpen(null);
    }
  };

  const overallStatus: TraceSpanStatus = summary.errors > 0
    ? "failed"
    : hasRunning
      ? "running"
      : root.status;

  const nowPct = Math.min(100, Math.max(0, (effectiveNow / axisRange.max) * 100));

  return (
    <div className={["ui-trwc", className].filter(Boolean).join(" ")}>
      <style href="ui-trace-waterfall-clean" precedence="default">
        {css}
      </style>

      {/* Top Header Bar */}
      <div className="ui-trwc__top">
        <div className="ui-trwc__top-left">
          <span className="ui-trwc__spark" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1.5L9.6 6.4L14.5 8L9.6 9.6L8 14.5L6.4 9.6L1.5 8L6.4 6.4L8 1.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h3 className="ui-trwc__title">{title}</h3>
          {(root.input || root.detail) && (
            <span className="ui-trwc__subtitle" title={root.input || root.detail}>
              {root.input || root.detail}
            </span>
          )}
        </div>
        <span className="ui-trwc__status" data-status={overallStatus}>
          <span className="ui-trwc__status-dot" aria-hidden="true" />
          {overallStatus === "running"
            ? "Live"
            : overallStatus === "failed"
              ? "Failed"
              : "Done"}
        </span>
      </div>

      {/* 6-Column Summary Strip */}
      <div className="ui-trwc__stats">
        <div className="ui-trwc__stat">
          <span className="ui-trwc__stat-label">DURATION</span>
          <span className="ui-trwc__stat-val">{fmtDuration(summary.duration)}</span>
        </div>
        <div className="ui-trwc__stat">
          <span className="ui-trwc__stat-label">COST</span>
          <span className="ui-trwc__stat-val">{formatCost(summary.cost)}</span>
        </div>
        <div className="ui-trwc__stat">
          <span className="ui-trwc__stat-label">TOKENS</span>
          <span className="ui-trwc__stat-val">{formatTokens(summary.tokens)}</span>
        </div>
        <div className="ui-trwc__stat">
          <span className="ui-trwc__stat-label">LLM CALLS</span>
          <span className="ui-trwc__stat-val">{summary.llmCalls}</span>
        </div>
        <div className="ui-trwc__stat">
          <span className="ui-trwc__stat-label">TOOL CALLS</span>
          <span className="ui-trwc__stat-val">{summary.toolCalls}</span>
        </div>
        <div className="ui-trwc__stat">
          <span className="ui-trwc__stat-label">ERRORS</span>
          <span
            className="ui-trwc__stat-val"
            data-error={summary.errors > 0 || undefined}
          >
            {summary.errors}
          </span>
        </div>
      </div>

      {/* Column Header + Time Axis */}
      <div className="ui-trwc__axis-head">
        <div className="ui-trwc__col-span">SPAN</div>
        <div className="ui-trwc__col-timeline">
          {axisRange.ticks.map((tick) => {
            const pct = (tick / axisRange.max) * 100;
            return (
              <span
                key={tick}
                className="ui-trwc__tick-label"
                style={{ left: `${pct}%` }}
              >
                {tick === 0 && !customFormatDuration ? "0s" : fmtDuration(tick)}
              </span>
            );
          })}
          {hasRunning && (
            <span
              className="ui-trwc__now-head"
              style={{ left: `${nowPct}%` }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {/* Waterfall Tree Rows */}
      <div className="ui-trwc__body" role="tree" aria-label={title}>
        {rows.map((row, idx) => {
          const { span, depth, hasChildren, isExpanded } = row;
          const endMs = span.end ?? effectiveNow;
          const durMs = Math.max(0, endMs - span.start);
          const leftPct = Math.min(100, Math.max(0, (span.start / axisRange.max) * 100));
          const widthPct = Math.min(
            100 - leftPct,
            Math.max(0.8, (durMs / axisRange.max) * 100),
          );
          const isSlowest = slowestId === span.id;
          const isSelected = openId === span.id;
          const isFocused = focusId === span.id;

          return (
            <div
              key={span.id}
              ref={(el) => {
                rowRefs.current[span.id] = el;
              }}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={hasChildren ? isExpanded : undefined}
              aria-selected={isSelected}
              tabIndex={isFocused ? 0 : -1}
              className="ui-trwc__row"
              data-selected={isSelected || undefined}
              data-status={span.status}
              onClick={() => {
                setFocusId(span.id);
                selectOpen(isSelected ? null : span.id);
              }}
              onKeyDown={(e) => handleTreeKeyDown(e, idx, row)}
            >
              {/* Left Span Label Cell */}
              <div
                className="ui-trwc__cell-span"
                style={{ paddingLeft: `${12 + depth * 18}px` }}
              >
                {/* Vertical tree guides */}
                {Array.from({ length: depth }).map((_, gIdx) => (
                  <span
                    key={gIdx}
                    className="ui-trwc__guide"
                    style={{ left: `${19 + gIdx * 18}px` }}
                    aria-hidden="true"
                  />
                ))}

                {hasChildren ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="ui-trwc__chev"
                    aria-label={isExpanded ? "Collapse span" : "Expand span"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(span.id);
                    }}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      style={{
                        transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                        transition: "transform 140ms ease",
                      }}
                    >
                      <path
                        d="M3.2 2L6.8 5L3.2 8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ) : (
                  <span className="ui-trwc__chev-spacer" aria-hidden="true" />
                )}

                <span
                  className="ui-trwc__kind-icon"
                  data-kind={span.kind}
                  data-status={span.status}
                  aria-hidden="true"
                >
                  {span.icon ?? <KindGlyph kind={span.kind} status={span.status} />}
                </span>

                <span className="ui-trwc__name" title={span.name}>
                  {span.name}
                </span>

                {span.detail && (
                  <span className="ui-trwc__detail" title={span.detail}>
                    {span.detail}
                  </span>
                )}

                {span.status === "running" && (
                  <span className="ui-trwc__spinner" aria-label="Running" />
                )}
              </div>

              {/* Right Timeline Bar Cell */}
              <div className="ui-trwc__cell-timeline">
                {/* Grid lines */}
                {axisRange.ticks.map((tick) => (
                  <span
                    key={tick}
                    className="ui-trwc__gridline"
                    style={{ left: `${(tick / axisRange.max) * 100}%` }}
                    aria-hidden="true"
                  />
                ))}

                {hasRunning && (
                  <span
                    className="ui-trwc__now-line"
                    style={{ left: `${nowPct}%` }}
                    aria-hidden="true"
                  />
                )}

                {/* Span bar */}
                <div
                  className="ui-trwc__bar-wrap"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                >
                  <div
                    className="ui-trwc__bar"
                    data-kind={span.kind}
                    data-status={span.status}
                  >
                    {/* When folded, render child spans as small tick marks inside the parent bar */}
                    {hasChildren &&
                      !isExpanded &&
                      span.children?.map((child) => {
                        const cStart = Math.max(0, child.start - span.start);
                        const cPct = durMs > 0 ? Math.min(98, (cStart / durMs) * 100) : 0;
                        return (
                          <span
                            key={child.id}
                            className="ui-trwc__fold-tick"
                            style={{ left: `${cPct}%` }}
                            title={child.name}
                          />
                        );
                      })}
                  </div>
                </div>

                {/* Inline meta beside the bar */}
                <div
                  className="ui-trwc__bar-meta"
                  style={{ left: `calc(${leftPct + widthPct}% + 8px)` }}
                >
                  <span className="ui-trwc__bar-dur">{fmtDuration(durMs)}</span>
                  {typeof span.cost === "number" && span.cost > 0 && (
                    <span className="ui-trwc__bar-cost">{formatCost(span.cost)}</span>
                  )}
                  {isSlowest && (
                    <span className="ui-trwc__slowest">SLOWEST</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Span Detail Sheet (Dialog) */}
      {openSpan && (
        <div
          className="ui-trwc__dialog"
          role="dialog"
          aria-label={openSpan.name}
        >
          <div className="ui-trwc__dialog-head">
            <div className="ui-trwc__dialog-title-wrap">
              <span
                className="ui-trwc__kind-icon"
                data-kind={openSpan.kind}
                data-status={openSpan.status}
              >
                <KindGlyph kind={openSpan.kind} status={openSpan.status} />
              </span>
              <strong className="ui-trwc__dialog-title">{openSpan.name}</strong>
              <span className="ui-trwc__dialog-badge" data-kind={openSpan.kind}>
                {openSpan.kind.toUpperCase()}
              </span>
              {openSpan.model && (
                <span className="ui-trwc__dialog-model">{openSpan.model}</span>
              )}
            </div>
            <button
              type="button"
              className="ui-trwc__dialog-close"
              aria-label="Close details"
              onClick={() => selectOpen(null)}
            >
              ×
            </button>
          </div>

          <div className="ui-trwc__dialog-metrics">
            <span>
              Duration:{" "}
              <strong>
                {fmtDuration((openSpan.end ?? effectiveNow) - openSpan.start)}
              </strong>
            </span>
            {typeof openSpan.cost === "number" && (
              <span>
                Cost: <strong>{formatCost(openSpan.cost)}</strong>
              </span>
            )}
            {(openSpan.tokensIn !== undefined || openSpan.tokensOut !== undefined) && (
              <span>
                Tokens:{" "}
                <strong>
                  {openSpan.tokensIn ?? 0} in → {openSpan.tokensOut ?? 0} out
                </strong>
              </span>
            )}
          </div>

          {openSpan.error && (
            <div className="ui-trwc__dialog-block ui-trwc__dialog-block--error">
              <div className="ui-trwc__dialog-label">ERROR</div>
              <pre className="ui-trwc__dialog-pre">{openSpan.error}</pre>
            </div>
          )}

          {openSpan.input && (
            <div className="ui-trwc__dialog-block">
              <div className="ui-trwc__dialog-label">INPUT</div>
              <pre className="ui-trwc__dialog-pre">{openSpan.input}</pre>
            </div>
          )}

          {openSpan.output && (
            <div className="ui-trwc__dialog-block">
              <div className="ui-trwc__dialog-label">OUTPUT</div>
              <pre className="ui-trwc__dialog-pre">{openSpan.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KindGlyph({ kind, status }: { kind: TraceSpanKind; status: TraceSpanStatus }) {
  if (status === "failed") {
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path
          d="M6 3.5V6.5M6 8.5H6.01M10.5 6A4.5 4.5 0 1 1 1.5 6a4.5 4.5 0 0 1 9 0Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === "llm") {
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path
          d="M6 1.5L7.1 4.9L10.5 6L7.1 7.1L6 10.5L4.9 7.1L1.5 6L4.9 4.9L6 1.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === "tool") {
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path
          d="M7.5 2.5a2.2 2.2 0 0 0-2.1 2.8L2.2 8.5a.9.9 0 0 0 1.3 1.3l3.2-3.2a2.2 2.2 0 0 0 2.8-2.1L8.2 5.8 6.8 4.4l1.3-1.3Z"
          stroke="currentColor"
          strokeWidth="1.15"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="3.8" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6" cy="6" r="1.4" fill="currentColor" />
    </svg>
  );
}

const css = /* css */ `
.ui-trwc {
  --trwc-bg: var(--aui-surface, #ffffff);
  --trwc-surface: var(--aui-subtle, rgba(20, 20, 22, 0.04));
  --trwc-fg: var(--aui-ink, #141416);
  --trwc-muted: var(--aui-muted, #52525b);
  --trwc-subtle: var(--aui-muted, #6e7076);
  --trwc-border: var(--aui-border, rgba(20, 20, 22, 0.08));
  --trwc-hairline: var(--aui-border, rgba(20, 20, 22, 0.055));
  --trwc-guide: var(--aui-border-strong, rgba(20, 20, 22, 0.12));
  --trwc-hover: var(--aui-subtle, rgba(20, 20, 22, 0.035));
  --trwc-accent: var(--aui-blue, #0070f3);
  --trwc-focus: var(--aui-focus, #0070f3);
  --trwc-mono: var(--aui-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  --trwc-agent: #475569;
  --trwc-llm: #7c3aed;
  --trwc-tool: #0d9488;
  --trwc-failed: #dc2626;
  --trwc-slowest-bg: rgba(245, 158, 11, 0.14);
  --trwc-slowest-fg: #b45309;
  --trwc-dialog-bg: var(--trwc-surface);

  position: relative;
  background: var(--trwc-bg);
  color: var(--trwc-fg);
  border-radius: var(--aui-radius-lg, var(--aui-radius, 14px));
  box-shadow: var(--aui-shadow-card, 0 0 0 1px rgba(15, 23, 42, 0.07), 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -8px rgba(15, 23, 42, 0.06));
  font-family: var(--aui-font, -apple-system, BlinkMacSystemFont, "Inter", sans-serif);
  font-size: 12.5px;
  overflow: hidden;
}

:where(.dark, [data-theme="dark"]) .ui-trwc {
  --trwc-agent: #94a3b8;
  --trwc-llm: #a78bfa;
  --trwc-tool: #2dd4bf;
  --trwc-failed: #f87171;
  --trwc-slowest-bg: rgba(245, 158, 11, 0.22);
  --trwc-slowest-fg: #fbbf24;
  --trwc-dialog-bg: var(--aui-overlay, #202024);
}

.ui-trwc__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--trwc-border);
}

.ui-trwc__top-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ui-trwc__spark {
  display: inline-flex;
  color: var(--trwc-muted);
  flex-shrink: 0;
}

.ui-trwc__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--trwc-fg);
  flex-shrink: 0;
}

.ui-trwc__subtitle {
  font-size: 12.5px;
  color: var(--trwc-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-trwc__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 500;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--trwc-surface);
  color: var(--trwc-muted);
  flex-shrink: 0;
}

.ui-trwc__status[data-status="running"] {
  background: rgba(16, 185, 129, 0.12);
  color: var(--aui-success, #059669);
}

.ui-trwc__status[data-status="failed"] {
  background: rgba(220, 38, 38, 0.12);
  color: var(--trwc-failed);
}

.ui-trwc__status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.ui-trwc__status[data-status="running"] .ui-trwc__status-dot {
  animation: ui-trwc-pulse 1.3s ease-in-out infinite;
}

/* 6-Column Summary Strip */
.ui-trwc__stats {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  border-bottom: 1px solid var(--trwc-border);
  background: var(--trwc-bg);
}

.ui-trwc__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 14px;
  border-right: 1px solid var(--trwc-border);
}

.ui-trwc__stat:last-child {
  border-right: 0;
}

.ui-trwc__stat-label {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--trwc-subtle);
  text-transform: uppercase;
}

.ui-trwc__stat-val {
  font-family: var(--trwc-mono);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--trwc-fg);
}

.ui-trwc__stat-val[data-error="true"] {
  color: var(--trwc-failed);
}

/* Axis Header */
.ui-trwc__axis-head {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  align-items: center;
  height: 26px;
  border-bottom: 1px solid var(--trwc-border);
  background: var(--trwc-surface);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--trwc-subtle);
}

.ui-trwc__col-span {
  padding: 0 14px;
  border-right: 1px solid var(--trwc-border);
}

.ui-trwc__col-timeline {
  position: relative;
  height: 100%;
  margin: 0 76px 0 12px;
}

.ui-trwc__tick-label {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  font-family: var(--trwc-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--trwc-subtle);
  white-space: nowrap;
}

.ui-trwc__now-head {
  position: absolute;
  bottom: -3px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--trwc-accent);
  transform: translateX(-50%);
  z-index: 3;
}

/* Tree Rows */
.ui-trwc__body {
  display: flex;
  flex-direction: column;
}

.ui-trwc__row {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  align-items: center;
  min-height: 33px;
  border-bottom: 1px solid var(--trwc-hairline);
  cursor: pointer;
  transition: background 120ms ease;
}

.ui-trwc__row:last-child {
  border-bottom: 0;
}

.ui-trwc__row:hover {
  background: var(--trwc-hover);
}

.ui-trwc__row[data-selected="true"] {
  background: color-mix(in srgb, var(--trwc-accent) 8%, transparent);
}

.ui-trwc__row:focus-visible {
  outline: 2px solid var(--trwc-focus);
  outline-offset: -2px;
}

.ui-trwc__cell-span {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding-right: 10px;
  border-right: 1px solid var(--trwc-border);
  min-width: 0;
  overflow: hidden;
}

.ui-trwc__guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--trwc-guide);
}

.ui-trwc__chev {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--trwc-subtle);
  cursor: pointer;
  flex-shrink: 0;
}

.ui-trwc__chev:hover {
  background: var(--trwc-hover);
  color: var(--trwc-fg);
}

.ui-trwc__chev-spacer {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.ui-trwc__kind-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  flex-shrink: 0;
  background: rgba(71, 85, 105, 0.14);
  color: var(--trwc-agent);
}

.ui-trwc__kind-icon[data-kind="llm"] {
  background: rgba(124, 58, 237, 0.14);
  color: var(--trwc-llm);
}

.ui-trwc__kind-icon[data-kind="tool"] {
  background: rgba(13, 148, 136, 0.14);
  color: var(--trwc-tool);
}

.ui-trwc__kind-icon[data-status="failed"] {
  background: rgba(220, 38, 38, 0.14);
  color: var(--trwc-failed);
}

.ui-trwc__name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--trwc-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-trwc__detail {
  font-size: 11.5px;
  color: var(--trwc-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-trwc__spinner {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, var(--trwc-accent) 25%, transparent);
  border-top-color: var(--trwc-accent);
  animation: ui-trwc-spin 750ms linear infinite;
  flex-shrink: 0;
  margin-left: auto;
}

/* Right Timeline Cell */
.ui-trwc__cell-timeline {
  position: relative;
  height: 33px;
  margin: 0 76px 0 12px;
  display: flex;
  align-items: center;
}

.ui-trwc__gridline {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--trwc-hairline);
  pointer-events: none;
}

.ui-trwc__now-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: var(--trwc-accent);
  opacity: 0.65;
  pointer-events: none;
  z-index: 2;
}

.ui-trwc__bar-wrap {
  position: absolute;
  height: 10px;
  display: flex;
  align-items: center;
  z-index: 1;
}

.ui-trwc__bar {
  position: relative;
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: var(--trwc-agent);
  overflow: hidden;
  transition: width 120ms linear;
}

.ui-trwc__bar[data-kind="llm"] {
  background: var(--trwc-llm);
}

.ui-trwc__bar[data-kind="tool"] {
  background: var(--trwc-tool);
}

.ui-trwc__bar[data-status="failed"] {
  background: var(--trwc-failed);
}

.ui-trwc__bar[data-status="running"] {
  background-image: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.35) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  background-size: 200% 100%;
  animation: ui-trwc-shimmer 1.4s linear infinite;
}

.ui-trwc__fold-tick {
  position: absolute;
  top: 1px;
  bottom: 1px;
  width: 2px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.78);
}

.ui-trwc__bar-meta {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  font-family: var(--trwc-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  z-index: 2;
}

.ui-trwc__bar-dur {
  color: var(--trwc-muted);
  font-weight: 500;
}

.ui-trwc__bar-cost {
  color: var(--trwc-subtle);
}

.ui-trwc__slowest {
  font-family: var(--aui-font, sans-serif);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--trwc-slowest-bg);
  color: var(--trwc-slowest-fg);
}

/* Detail Dialog */
.ui-trwc__dialog {
  border-top: 1px solid var(--trwc-border);
  background: var(--trwc-dialog-bg);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ui-trwc__dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ui-trwc__dialog-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ui-trwc__dialog-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--trwc-fg);
}

.ui-trwc__dialog-badge {
  font-size: 9.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--trwc-hover);
  color: var(--trwc-muted);
}

.ui-trwc__dialog-model {
  font-family: var(--trwc-mono);
  font-size: 11px;
  color: var(--trwc-subtle);
}

.ui-trwc__dialog-close {
  border: 0;
  background: transparent;
  color: var(--trwc-muted);
  font-size: 16px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
}

.ui-trwc__dialog-close:hover {
  background: var(--trwc-hover);
  color: var(--trwc-fg);
}

.ui-trwc__dialog-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 11.5px;
  color: var(--trwc-muted);
}

.ui-trwc__dialog-metrics strong {
  color: var(--trwc-fg);
}

.ui-trwc__dialog-block {
  background: var(--trwc-bg);
  border: 1px solid var(--trwc-border);
  border-radius: 8px;
  padding: 8px 10px;
}

.ui-trwc__dialog-block--error {
  border-color: rgba(220, 38, 38, 0.35);
  background: rgba(220, 38, 38, 0.06);
}

.ui-trwc__dialog-label {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--trwc-subtle);
  margin-bottom: 4px;
}

.ui-trwc__dialog-pre {
  margin: 0;
  font-family: var(--trwc-mono);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--trwc-fg);
}

@media (max-width: 720px) {
  .ui-trwc__stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .ui-trwc__axis-head,
  .ui-trwc__row {
    grid-template-columns: 190px minmax(0, 1fr);
  }
}

@keyframes ui-trwc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes ui-trwc-spin {
  to { transform: rotate(360deg); }
}

@keyframes ui-trwc-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;
