"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/*
 * Trace Waterfall, clean style – Where the time and cost of a run go.
 * Container-query responsive, WAI-ARIA tree + dialog, live clock via startedAt/now.
 * Chevron, warning and close icons use Hugeicons Free SVG paths (MIT, hugeicons.com).
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
  /** Short muted note shown next to the name */
  detail?: string;
  /** Optional custom icon for the span row */
  icon?: ReactNode;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  /** Span's own cost – containers sum children automatically */
  cost?: number;
  input?: string;
  output?: string;
  error?: string;
  children?: TraceSpan[];
};

export type TraceSummaryMetric = {
  label: string;
  value: string | number;
  tone?: "default" | "danger" | "warn" | "ok";
};

export type TraceWaterfallLabels = {
  spanColumn?: string;
  live?: string;
  done?: string;
  failed?: string;
  slowest?: string;
  duration?: string;
  cost?: string;
  tokens?: string;
  input?: string;
  output?: string;
  error?: string;
  close?: string;
};

export type TraceWaterfallProps = {
  /** Root span of the trace – its children form the tree */
  root: TraceSpan;
  /** Current run clock in ms from the start – omit when using startedAt or settled traces */
  now?: number;
  /** Wall-clock timestamp (epoch ms) when the run started – drives the live timer */
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
  /** Marks the slowest finished span with a small Slowest tag */
  markSlowest?: boolean;
  /** "leaf" (default, official spec) picks slowest finished LLM/tool call; "stage" picks slowest depth-1 step */
  slowestScope?: "leaf" | "stage";
  /** Minimum axis length in ms so short runs don't stretch edge to edge */
  minRange?: number;
  /** Formats a cost number – defaults to USD ("$0.042") */
  formatCost?: (amount: number) => string;
  /** Formats a duration in ms – defaults to "800ms", "1.2s", "2m 04s" */
  formatDuration?: (ms: number) => string;
  /** Heading in the top bar */
  title?: string;
  /** Optional domain summary cells overriding the 6 default AI trace stats */
  summaryItems?: TraceSummaryMetric[];
  /** Optional UI text overrides */
  labels?: TraceWaterfallLabels;
  className?: string;
};

type FlatRow = {
  span: TraceSpan;
  depth: number;
  parentId?: string;
  hasChildren: boolean;
  isExpanded: boolean;
};

function defaultFormatCost(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(3)}`;
  if (amount < 1) return `$${amount.toFixed(2)}`;
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

/** Cluster folded child start percentages so dense branches show clean, legible ticks. */
function buildFoldTicks(
  parent: TraceSpan,
  durMs: number,
  barWidthPct: number,
): { id: string; leftPct: number; name: string; kind: TraceSpanKind; status: TraceSpanStatus }[] {
  if (!parent.children || parent.children.length === 0 || barWidthPct < 3.5) {
    return [];
  }
  const raw = parent.children.map((child) => {
    const cStart = Math.max(0, child.start - parent.start);
    const pct = durMs > 0 ? Math.min(92, Math.max(4, (cStart / durMs) * 100)) : 50;
    return { id: child.id, leftPct: pct, name: child.name, kind: child.kind, status: child.status };
  });
  raw.sort((a, b) => a.leftPct - b.leftPct);

  const maxTicks = barWidthPct < 10 ? 3 : barWidthPct < 20 ? 5 : 7;
  const minGap = 92 / Math.max(2, maxTicks);
  const clustered: typeof raw = [];
  for (const item of raw) {
    const prev = clustered[clustered.length - 1];
    if (!prev || item.leftPct - prev.leftPct >= minGap) {
      clustered.push(item);
    }
    if (clustered.length >= maxTicks) break;
  }
  return clustered;
}

function computeOwnOrSubCost(span: TraceSpan): number | undefined {
  if (typeof span.cost === "number") return span.cost;
  if (!span.children || span.children.length === 0) return undefined;
  let total = 0;
  let hasAny = false;
  for (const ch of span.children) {
    const sub = computeOwnOrSubCost(ch);
    if (typeof sub === "number") {
      total += sub;
      hasAny = true;
    }
  }
  return hasAny ? total : undefined;
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
  slowestScope = "leaf",
  minRange = 10000,
  formatCost = defaultFormatCost,
  formatDuration: customFormatDuration,
  title = "Trace",
  summaryItems,
  labels,
  className,
}: TraceWaterfallProps) {
  const fmtDuration = customFormatDuration ?? defaultFormatDuration;
  const [internalCollapsed, setInternalCollapsed] = useState<string[]>(defaultCollapsed);
  const [internalOpenId, setInternalOpenId] = useState<string | null>(defaultOpenId);
  const [focusId, setFocusId] = useState<string>(root.id);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const text = {
    spanColumn: labels?.spanColumn ?? "SPAN",
    live: labels?.live ?? "Live",
    done: labels?.done ?? "Done",
    failed: labels?.failed ?? "Failed",
    slowest: labels?.slowest ?? "SLOWEST",
    duration: labels?.duration ?? "Duration",
    cost: labels?.cost ?? "Cost",
    tokens: labels?.tokens ?? "Tokens",
    input: labels?.input ?? "INPUT",
    output: labels?.output ?? "OUTPUT",
    error: labels?.error ?? "ERROR",
    close: labels?.close ?? "Close details",
  };

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
    if (startedAt !== undefined && hasRunning) return Math.max(maxEnd, Date.now() - startedAt);
    return maxEnd;
  });

  useEffect(() => {
    if (controlledNow !== undefined) {
      setTickNow(controlledNow);
      return;
    }
    if (!hasRunning || startedAt === undefined) {
      setTickNow(maxEnd);
      return;
    }
    const id = window.setInterval(() => {
      setTickNow(Math.max(maxEnd, Date.now() - startedAt));
    }, 100);
    return () => window.clearInterval(id);
  }, [controlledNow, hasRunning, maxEnd, startedAt]);

  const effectiveNow = controlledNow ?? tickNow;

  const summary = useMemo(() => {
    let cost = 0;
    let hasCost = false;
    let tokensIn = 0;
    let tokensOut = 0;
    let llmCalls = 0;
    let toolCalls = 0;
    let errors = 0;

    for (const s of allSpans) {
      const isLeaf = !s.children || s.children.length === 0;
      if (isLeaf || s.kind === "llm" || s.kind === "tool") {
        if (typeof s.cost === "number") {
          cost += s.cost;
          hasCost = true;
        }
        if (typeof s.tokensIn === "number") tokensIn += s.tokensIn;
        if (typeof s.tokensOut === "number") tokensOut += s.tokensOut;
      }
      if (s.kind === "llm") llmCalls += 1;
      if (s.kind === "tool") toolCalls += 1;
      if (s.status === "failed") errors += 1;
    }

    if (!hasCost && typeof root.cost === "number") {
      cost = root.cost;
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

  const slowestId = useMemo(() => {
    if (!markSlowest) return null;
    if (slowestScope === "stage") {
      let bestId: string | null = null;
      let bestDur = -1;
      for (const s of root.children ?? []) {
        const dur = (s.end ?? effectiveNow) - s.start;
        if (dur > bestDur) {
          bestDur = dur;
          bestId = s.id;
        }
      }
      return bestId;
    }

    let bestLeafId: string | null = null;
    let bestLeafDur = -1;
    for (const s of allSpans) {
      if (s.id === root.id) continue;
      if (s.kind !== "llm" && s.kind !== "tool") continue;
      if (s.status === "running" || s.end === undefined) continue;
      const dur = s.end - s.start;
      if (dur > bestLeafDur) {
        bestLeafDur = dur;
        bestLeafId = s.id;
      }
    }
    return bestLeafId;
  }, [allSpans, root, effectiveNow, markSlowest, slowestScope]);

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

  const rows = useMemo(() => {
    const list: FlatRow[] = [];
    const walk = (span: TraceSpan, depth: number, parentId?: string) => {
      const hasChildren = Boolean(span.children && span.children.length > 0);
      const isExpanded = hasChildren && !collapsedSet.has(span.id);
      list.push({ span, depth, parentId, hasChildren, isExpanded });
      if (hasChildren && isExpanded && span.children) {
        for (const child of span.children) walk(child, depth + 1, span.id);
      }
    };
    walk(root, 0, undefined);
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
    const { span, parentId, hasChildren, isExpanded } = row;
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
      } else if (parentId) {
        setFocusId(parentId);
        rowRefs.current[parentId]?.focus();
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectOpen(openId === span.id ? null : span.id);
    } else if (e.key === "Escape" && openId) {
      e.preventDefault();
      selectOpen(null);
      rowRefs.current[span.id]?.focus();
    }
  };

  const overallStatus: TraceSpanStatus =
    root.status === "failed" || summary.errors > 0
      ? "failed"
      : hasRunning
        ? "running"
        : root.status;

  const showNowMarker = hasRunning && (startedAt !== undefined || controlledNow !== undefined);
  const nowPct = Math.min(100, Math.max(0, (effectiveNow / axisRange.max) * 100));

  const computedSummary: TraceSummaryMetric[] = summaryItems ?? [
    { label: "DURATION", value: fmtDuration(summary.duration) },
    { label: "COST", value: formatCost(summary.cost) },
    { label: "TOKENS", value: formatTokens(summary.tokens) },
    { label: "LLM CALLS", value: summary.llmCalls },
    { label: "TOOL CALLS", value: summary.toolCalls },
    { label: "ERRORS", value: summary.errors, tone: summary.errors > 0 ? "danger" : "default" },
  ];

  return (
    <div
      className={["ui-trwc", className].filter(Boolean).join(" ")}
      onKeyDown={(e) => {
        if (e.key === "Escape" && openId) {
          e.preventDefault();
          const currentId = openId;
          selectOpen(null);
          rowRefs.current[currentId]?.focus();
        }
      }}
    >
      <style href="ui-trace-waterfall-clean" precedence="default">
        {css}
      </style>

      {/* Top Header Bar */}
      <div className="ui-trwc__top">
        <div className="ui-trwc__top-left">
          <span className="ui-trwc__spark" data-status={overallStatus} aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1.5L9.45 6.55L14.5 8L9.45 9.45L8 14.5L6.55 9.45L1.5 8L6.55 6.55L8 1.5Z" />
            </svg>
          </span>
          <h3 className="ui-trwc__title">{title}</h3>
          {(root.input || root.detail) && (
            <span className="ui-trwc__subtitle" title={root.input || root.detail}>
              {root.input || root.detail}
            </span>
          )}
        </div>
        <span
          className="ui-trwc__status"
          data-status={overallStatus}
          role="status"
          aria-live="polite"
        >
          <span className="ui-trwc__status-dot" aria-hidden="true" />
          {overallStatus === "running"
            ? text.live
            : overallStatus === "failed"
              ? text.failed
              : text.done}
        </span>
      </div>

      {/* 6-Column Summary Strip */}
      <div className="ui-trwc__stats">
        {computedSummary.map((item) => (
          <div key={item.label} className="ui-trwc__stat">
            <span className="ui-trwc__stat-label">{item.label}</span>
            <span
              className="ui-trwc__stat-val"
              data-tone={item.tone !== "default" ? item.tone : undefined}
              data-live={hasRunning && startedAt !== undefined ? "true" : undefined}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>

      {/* Column Header + Time Axis */}
      <div className="ui-trwc__axis-head">
        <div className="ui-trwc__col-span">{text.spanColumn}</div>
        <div className="ui-trwc__col-timeline">
          {axisRange.ticks.map((tick, tIdx) => {
            const pct = (tick / axisRange.max) * 100;
            const isFirst = tIdx === 0;
            return (
              <span
                key={tick}
                className="ui-trwc__tick-label"
                data-first={isFirst || undefined}
                style={{ left: isFirst ? "8px" : `${pct}%` }}
              >
                {tick === 0 && !customFormatDuration ? "0s" : fmtDuration(tick)}
              </span>
            );
          })}
          {showNowMarker && (
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
            Math.max(1.25, (durMs / axisRange.max) * 100),
          );
          const isSlowest = slowestId === span.id;
          const isSelected = openId === span.id;
          const isFocused = focusId === span.id;
          const displayCost = span.id === root.id ? span.cost ?? computeOwnOrSubCost(span) : computeOwnOrSubCost(span);
          const foldTicks =
            hasChildren && !isExpanded ? buildFoldTicks(span, durMs, widthPct) : [];

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
              aria-label={`${span.name} ${span.status} ${fmtDuration(durMs)}${typeof displayCost === "number" && displayCost > 0 ? ` ${formatCost(displayCost)}` : ""}`}
              tabIndex={isFocused ? 0 : -1}
              className="ui-trwc__row"
              data-selected={isSelected || undefined}
              data-status={span.status}
              data-parent={hasChildren || undefined}
              onClick={() => {
                setFocusId(span.id);
                selectOpen(isSelected ? null : span.id);
              }}
              onKeyDown={(e) => handleTreeKeyDown(e, idx, row)}
            >
              {/* Left Span Label Cell */}
              <div
                className="ui-trwc__cell-span"
                style={{ paddingLeft: `${12 + depth * 16}px` }}
              >
                {Array.from({ length: depth }).map((_, gIdx) => (
                  <span
                    key={gIdx}
                    className="ui-trwc__guide"
                    style={{ left: `${18 + gIdx * 16}px` }}
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
                    {/* Hugeicons ArrowRight01 path (MIT) */}
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      style={{
                        transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                        transition: "transform 150ms cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                    >
                      <path
                        d="M9 6L15 12L9 18"
                        stroke="currentColor"
                        strokeWidth="2.1"
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
                {axisRange.ticks.map((tick, tIdx) =>
                  tIdx === 0 ? null : (
                    <span
                      key={tick}
                      className="ui-trwc__gridline"
                      style={{ left: `${(tick / axisRange.max) * 100}%` }}
                      aria-hidden="true"
                    />
                  ),
                )}

                {showNowMarker && (
                  <span
                    className="ui-trwc__now-line"
                    style={{ left: `${nowPct}%` }}
                    aria-hidden="true"
                  />
                )}

                {/* Translucent bordered capsule bar */}
                <div
                  className="ui-trwc__bar-wrap"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                >
                  <div
                    className="ui-trwc__bar"
                    data-kind={span.kind}
                    data-status={span.status}
                  >
                    {foldTicks.map((ft) => (
                      <span
                        key={ft.id}
                        className="ui-trwc__fold-tick"
                        data-kind={ft.kind}
                        data-status={ft.status}
                        style={{ left: `${ft.leftPct}%` }}
                        title={ft.name}
                      />
                    ))}
                  </div>
                </div>

                {/* Inline meta beside the bar */}
                <div
                  className="ui-trwc__bar-meta"
                  style={{ left: `calc(${leftPct + widthPct}% + 8px)` }}
                >
                  <span className="ui-trwc__bar-dur">{fmtDuration(durMs)}</span>
                  {typeof displayCost === "number" && displayCost > 0 && (
                    <>
                      <span className="ui-trwc__bar-sep" aria-hidden="true">·</span>
                      <span className="ui-trwc__bar-cost">{formatCost(displayCost)}</span>
                    </>
                  )}
                  {isSlowest && (
                    <span className="ui-trwc__slowest">{text.slowest}</span>
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
              {openSpan.detail && (
                <span className="ui-trwc__dialog-model">{openSpan.detail}</span>
              )}
              {openSpan.model && (
                <span className="ui-trwc__dialog-badge">{openSpan.model}</span>
              )}
            </div>
            <button
              type="button"
              className="ui-trwc__dialog-close"
              aria-label={text.close}
              onClick={() => {
                const currentId = openSpan.id;
                selectOpen(null);
                rowRefs.current[currentId]?.focus();
              }}
            >
              {/* Hugeicons Cancel01 path (MIT) */}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M18 6L6 18M6 6L18 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="ui-trwc__dialog-metrics">
            <span>
              {text.duration}:{" "}
              <strong>
                {fmtDuration((openSpan.end ?? effectiveNow) - openSpan.start)}
              </strong>
            </span>
            {typeof openSpan.cost === "number" && openSpan.cost > 0 && (
              <span>
                {text.cost}: <strong>{formatCost(openSpan.cost)}</strong>
              </span>
            )}
            {(openSpan.tokensIn !== undefined || openSpan.tokensOut !== undefined) && (
              <span>
                {text.tokens}:{" "}
                <strong>
                  {openSpan.tokensIn ?? 0} in → {openSpan.tokensOut ?? 0} out
                </strong>
              </span>
            )}
          </div>

          {openSpan.error && (
            <div className="ui-trwc__dialog-block ui-trwc__dialog-block--error">
              <div className="ui-trwc__dialog-label">{text.error}</div>
              <pre className="ui-trwc__dialog-pre">{openSpan.error}</pre>
            </div>
          )}

          {openSpan.input && (
            <div className="ui-trwc__dialog-block">
              <div className="ui-trwc__dialog-label">{text.input}</div>
              <pre className="ui-trwc__dialog-pre">{openSpan.input}</pre>
            </div>
          )}

          {openSpan.output && (
            <div className="ui-trwc__dialog-block">
              <div className="ui-trwc__dialog-label">{text.output}</div>
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
    /* Hugeicons AlertCircle path (MIT) */
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.9" />
        <path d="M12 8V12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="16" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "llm") {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1.5L9.45 6.55L14.5 8L9.45 9.45L8 14.5L6.55 9.45L1.5 8L6.55 6.55L8 1.5Z" />
      </svg>
    );
  }
  if (kind === "tool") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.9" />
        <path d="M16 16L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

const css = /* css */ `
.ui-trwc {
  --trwc-bg: var(--aui-surface, #ffffff);
  --trwc-surface: var(--aui-subtle, rgba(15, 23, 42, 0.024));
  --trwc-fg: var(--aui-ink, #141416);
  --trwc-muted: var(--aui-muted, #63636b);
  --trwc-subtle: var(--aui-muted, #787882);
  --trwc-border: var(--aui-border, rgba(15, 23, 42, 0.08));
  --trwc-hairline: rgba(15, 23, 42, 0.045);
  --trwc-guide: rgba(15, 23, 42, 0.09);
  --trwc-hover: var(--aui-subtle, rgba(15, 23, 42, 0.03));
  --trwc-accent: var(--aui-blue, #2563eb);
  --trwc-focus: var(--aui-focus, #2563eb);
  --trwc-mono: var(--aui-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);

  --trwc-agent-fg: #475569;
  --trwc-llm-fg: #7c3aed;
  --trwc-tool-fg: #0284c7;
  --trwc-failed-fg: #dc2626;
  --trwc-warn-fg: #b45309;
  --trwc-ok-fg: #059669;

  --ui-trwc-agent-bg: rgba(15, 23, 42, 0.045);
  --ui-trwc-agent-edge: rgba(15, 23, 42, 0.11);
  --ui-trwc-llm-bg: rgba(124, 58, 237, 0.085);
  --ui-trwc-llm-edge: rgba(124, 58, 237, 0.24);
  --ui-trwc-tool-bg: rgba(14, 165, 233, 0.10);
  --ui-trwc-tool-edge: rgba(14, 165, 233, 0.28);
  --ui-trwc-failed-bg: rgba(239, 68, 68, 0.105);
  --ui-trwc-failed-edge: rgba(239, 68, 68, 0.34);

  --trwc-slowest-bg: rgba(245, 158, 11, 0.14);
  --trwc-slowest-fg: #d97706;
  --trwc-dialog-bg: var(--trwc-surface);

  container-type: inline-size;
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
  --trwc-surface: rgba(255, 255, 255, 0.025);
  --trwc-hairline: rgba(255, 255, 255, 0.055);
  --trwc-guide: rgba(255, 255, 255, 0.10);
  --trwc-hover: rgba(255, 255, 255, 0.035);
  --trwc-accent: #60a5fa;

  --trwc-agent-fg: #a1a1aa;
  --trwc-llm-fg: #a78bfa;
  --trwc-tool-fg: #38bdf8;
  --trwc-failed-fg: #f87171;
  --trwc-warn-fg: #fbbf24;
  --trwc-ok-fg: #34d399;

  --ui-trwc-agent-bg: rgba(255, 255, 255, 0.065);
  --ui-trwc-agent-edge: rgba(255, 255, 255, 0.13);
  --ui-trwc-llm-bg: rgba(139, 92, 246, 0.16);
  --ui-trwc-llm-edge: rgba(167, 139, 250, 0.34);
  --ui-trwc-tool-bg: rgba(20, 184, 166, 0.14);
  --ui-trwc-tool-edge: rgba(45, 212, 191, 0.30);
  --ui-trwc-failed-bg: rgba(248, 113, 113, 0.16);
  --ui-trwc-failed-edge: rgba(248, 113, 113, 0.38);

  --trwc-slowest-bg: rgba(245, 158, 11, 0.22);
  --trwc-slowest-fg: #fbbf24;
  --trwc-dialog-bg: var(--aui-overlay, #202024);
}

.ui-trwc__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 16px;
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
  color: var(--trwc-accent);
  flex-shrink: 0;
}

.ui-trwc__spark[data-status="failed"] {
  color: var(--trwc-failed-fg);
}

.ui-trwc__spark[data-status="done"] {
  color: var(--trwc-ok-fg);
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
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--trwc-surface);
  color: var(--trwc-muted);
  flex-shrink: 0;
}

.ui-trwc__status[data-status="running"] {
  background: rgba(14, 165, 233, 0.12);
  color: var(--trwc-tool-fg);
}

.ui-trwc__status[data-status="done"] {
  background: rgba(16, 185, 129, 0.12);
  color: var(--trwc-ok-fg);
}

.ui-trwc__status[data-status="failed"] {
  background: rgba(239, 68, 68, 0.11);
  color: var(--trwc-failed-fg);
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
  gap: 3px;
  padding: 11px 15px;
}

.ui-trwc__stat + .ui-trwc__stat {
  border-left: 1px solid var(--trwc-hairline);
}

.ui-trwc__stat-label {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--trwc-subtle);
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-trwc__stat-val {
  font-family: var(--trwc-mono);
  font-size: 14.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--trwc-fg);
  white-space: nowrap;
}

.ui-trwc__stat-val[data-tone="danger"] {
  color: var(--trwc-failed-fg);
}

.ui-trwc__stat-val[data-tone="warn"] {
  color: var(--trwc-warn-fg);
}

.ui-trwc__stat-val[data-tone="ok"] {
  color: var(--trwc-ok-fg);
}

/* Axis Header */
.ui-trwc__axis-head {
  display: grid;
  grid-template-columns: clamp(235px, 35%, 330px) minmax(0, 1fr);
  align-items: center;
  height: 30px;
  border-bottom: 1px solid var(--trwc-border);
  background: var(--trwc-bg);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--trwc-subtle);
}

.ui-trwc__col-span {
  padding: 0 14px;
  height: 100%;
  display: flex;
  align-items: center;
  border-right: 1px solid var(--trwc-border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-trwc__col-timeline {
  position: relative;
  height: 100%;
  margin: 0 112px 0 0;
}

.ui-trwc__tick-label {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  font-family: var(--trwc-mono);
  font-size: 10.5px;
  font-weight: 500;
  color: var(--trwc-subtle);
  white-space: nowrap;
}

.ui-trwc__tick-label[data-first="true"] {
  transform: translate(0, -50%);
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
  padding: 4px 0;
}

.ui-trwc__row {
  display: grid;
  grid-template-columns: clamp(235px, 35%, 330px) minmax(0, 1fr);
  align-items: center;
  min-height: 32px;
  cursor: pointer;
  transition: background 120ms ease;
}

.ui-trwc__row:hover {
  background: var(--trwc-hover);
}

.ui-trwc__row[data-selected="true"] {
  background: color-mix(in srgb, var(--trwc-accent) 7%, transparent);
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
  height: 32px;
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
  width: 14px;
  height: 16px;
  flex-shrink: 0;
}

.ui-trwc__kind-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--trwc-agent-fg);
}

.ui-trwc__kind-icon[data-kind="llm"] {
  color: var(--trwc-llm-fg);
}

.ui-trwc__kind-icon[data-kind="tool"] {
  color: var(--trwc-tool-fg);
}

.ui-trwc__kind-icon[data-status="failed"] {
  color: var(--trwc-failed-fg);
}

.ui-trwc__name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--trwc-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  min-width: 0;
}

.ui-trwc__row[data-parent="true"] .ui-trwc__name {
  font-weight: 600;
}

.ui-trwc__detail {
  font-size: 11.5px;
  color: var(--trwc-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 999 0;
  min-width: 0;
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
  height: 32px;
  margin: 0 112px 0 0;
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
  width: 1px;
  background: color-mix(in srgb, var(--trwc-accent) 45%, transparent);
  pointer-events: none;
  z-index: 2;
}

.ui-trwc__bar-wrap {
  position: absolute;
  height: 17px;
  display: flex;
  align-items: center;
  z-index: 1;
}

.ui-trwc__bar {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 17px;
  border-radius: 5px;
  background: var(--ui-trwc-agent-bg);
  border: 1px solid var(--ui-trwc-agent-edge);
  overflow: hidden;
  transform-origin: left center;
  animation: ui-trwc-bar-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
  transition: width 160ms ease, background-color 140ms ease, border-color 140ms ease;
}

.ui-trwc__bar[data-kind="llm"] {
  background: var(--ui-trwc-llm-bg);
  border-color: var(--ui-trwc-llm-edge);
}

.ui-trwc__bar[data-kind="tool"] {
  background: var(--ui-trwc-tool-bg);
  border-color: var(--ui-trwc-tool-edge);
}

.ui-trwc__bar[data-status="failed"] {
  background: var(--ui-trwc-failed-bg);
  border-color: var(--ui-trwc-failed-edge);
}

.ui-trwc__bar[data-status="running"]::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.42) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  background-size: 200% 100%;
  animation: ui-trwc-shimmer 1.6s linear infinite;
  pointer-events: none;
}

:where(.dark, [data-theme="dark"]) .ui-trwc__bar[data-status="running"]::after {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.16) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  background-size: 200% 100%;
}

.ui-trwc__fold-tick {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 5px;
  border-radius: 999px;
  background: var(--trwc-agent-fg);
  opacity: 0.36;
}

.ui-trwc__fold-tick[data-kind="llm"] {
  background: var(--trwc-llm-fg);
}

.ui-trwc__fold-tick[data-kind="tool"] {
  background: var(--trwc-tool-fg);
}

.ui-trwc__bar[data-status="failed"] .ui-trwc__fold-tick,
.ui-trwc__fold-tick[data-status="failed"] {
  background: var(--trwc-failed-fg);
  opacity: 0.42;
}

.ui-trwc__bar-meta {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 4px;
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

.ui-trwc__bar-sep,
.ui-trwc__bar-cost {
  color: var(--trwc-subtle);
}

.ui-trwc__slowest {
  font-family: var(--aui-font, sans-serif);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  margin-left: 2px;
  border-radius: 4px;
  background: var(--trwc-slowest-bg);
  color: var(--trwc-slowest-fg);
}

/* Detail Dialog */
.ui-trwc__dialog {
  border-top: 1px solid var(--trwc-border);
  background: var(--trwc-dialog-bg);
  padding: 13px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: ui-trwc-dialog-in 160ms cubic-bezier(0.22, 1, 0.36, 1) both;
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
  flex-wrap: wrap;
}

.ui-trwc__dialog-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--trwc-fg);
}

.ui-trwc__dialog-badge {
  font-size: 10px;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  color: var(--trwc-muted);
  border-radius: 5px;
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
  border-color: rgba(239, 68, 68, 0.34);
  background: rgba(239, 68, 68, 0.06);
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

@container (max-width: 560px) {
  .ui-trwc__stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .ui-trwc__stat:nth-child(4) {
    border-left: 0;
  }
  .ui-trwc__stat:nth-child(-n+3) {
    border-bottom: 1px solid var(--trwc-hairline);
  }
  .ui-trwc__axis-head {
    display: none;
  }
  .ui-trwc__row {
    grid-template-columns: 1fr;
    padding: 6px 12px 8px;
    gap: 5px;
    border-bottom: 1px solid var(--trwc-hairline);
  }
  .ui-trwc__cell-span {
    height: auto;
    border-right: 0;
    padding-right: 0;
    padding-left: 0 !important;
  }
  .ui-trwc__guide {
    display: none;
  }
  .ui-trwc__cell-timeline {
    height: 20px;
    margin: 0 96px 0 0;
  }
}

@container (max-width: 440px) {
  .ui-trwc__subtitle {
    display: none;
  }
}

@container (max-width: 360px) {
  .ui-trwc__detail {
    display: none;
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

@keyframes ui-trwc-bar-in {
  from { transform: scaleX(0.85); opacity: 0.5; }
  to { transform: scaleX(1); opacity: 1; }
}

@keyframes ui-trwc-dialog-in {
  from { transform: translateY(-4px) scale(0.99); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-trwc__bar,
  .ui-trwc__dialog,
  .ui-trwc__status[data-status="running"] .ui-trwc__status-dot,
  .ui-trwc__bar[data-status="running"]::after,
  .ui-trwc__spinner {
    animation: none !important;
    transition: none !important;
  }
}
`;
