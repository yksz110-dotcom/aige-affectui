"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

/*
 * Mission Control (Clean) – One room for all your running agents:
 * - Recap curve at the top with interactive event peaks (done, needs, failed)
 * - Live agent & sub-agent fleet in the middle with live timers, tools and costs
 * - Needs-you & failed inbox on the right with Approve, Reject, Retry and Dismiss
 * Matches affectUI New York Clean specification (.ui-mcc).
 */

export type MissionAgentStatus = "running" | "waiting" | "failed" | "done";
export type MissionFilter = "all" | "running" | "waiting" | "failed";

export type MissionAgent = {
  id: string;
  name: string;
  model?: string;
  avatar?: ReactNode;
  status: MissionAgentStatus;
  task: string;
  /** Question or approval request shown when status is "waiting" */
  ask?: string;
  /** Error message shown when status is "failed" */
  error?: string;
  /** Cost in USD */
  cost?: number;
  /** Start time in seconds before now */
  started?: number;
  /** End time in seconds before now, for finished agents */
  ended?: number;
  /** Tool names called by this agent */
  tools?: string[];
  /** Sub-agents spawned by this agent */
  children?: MissionAgent[];
};

export type MissionEventKind = "done" | "needs" | "failed";

export type MissionEvent = {
  id: string;
  /** Id of the lead agent this event belongs to */
  agent: string;
  /** Minutes relative to now, e.g. -180 for 3h ago */
  at: number;
  kind: MissionEventKind;
  title: string;
  detail?: string;
  logo?: ReactNode;
  count?: number;
};

export type MissionControlProps = {
  agents: MissionAgent[];
  events: MissionEvent[];
  /** Start of the recap curve in minutes relative to now */
  since?: number;
  /** End of the recap curve in minutes relative to now */
  now?: number;
  /** Controlled status filter */
  filter?: MissionFilter;
  /** Initial status filter (uncontrolled) */
  defaultFilter?: MissionFilter;
  onFilterChange?: (filter: MissionFilter) => void;
  onApprove?: (agent: MissionAgent) => void;
  onReject?: (agent: MissionAgent) => void;
  onRetry?: (agent: MissionAgent) => void;
  onDismiss?: (agent: MissionAgent) => void;
  /** Formats a cost number – defaults to USD ("$12.34") */
  formatCost?: (amount: number) => string;
  /** Heading in the top bar */
  title?: string;
  className?: string;
};

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatRelMin(min: number): string {
  const abs = Math.abs(Math.round(min));
  if (abs === 0) return "now";
  if (abs < 60) return `${abs}m ago`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function collectFlatAgents(list: MissionAgent[], out: MissionAgent[] = []): MissionAgent[] {
  for (const a of list) {
    out.push(a);
    if (a.children) collectFlatAgents(a.children, out);
  }
  return out;
}

export function MissionControl({
  agents,
  events,
  since = -240,
  now = 0,
  filter: controlledFilter,
  defaultFilter = "all",
  onFilterChange,
  onApprove,
  onReject,
  onRetry,
  onDismiss,
  formatCost = (amount: number) => `$${amount.toFixed(2)}`,
  title = "Mission control",
  className,
}: MissionControlProps) {
  const [internalFilter, setInternalFilter] = useState<MissionFilter>(defaultFilter);
  const [hoverAgentId, setHoverAgentId] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [expandedInboxIds, setExpandedInboxIds] = useState<Set<string>>(() => new Set());
  const [localStatuses, setLocalStatuses] = useState<Record<string, MissionAgentStatus>>({});
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [tickSec, setTickSec] = useState(0);

  const activeFilter = controlledFilter ?? internalFilter;

  const setFilter = (next: MissionFilter) => {
    if (controlledFilter === undefined) setInternalFilter(next);
    onFilterChange?.(next);
  };

  // Apply local overrides from Approve/Reject/Retry/Dismiss when parent doesn't mutate immediately
  const hydratedAgents = useMemo(() => {
    const mapAgent = (a: MissionAgent): MissionAgent | null => {
      if (dismissedIds.has(a.id)) return null;
      const override = localStatuses[a.id];
      const children = a.children
        ?.map(mapAgent)
        .filter((c): c is MissionAgent => c !== null);
      return {
        ...a,
        status: override ?? a.status,
        children,
      };
    };
    return agents.map(mapAgent).filter((a): a is MissionAgent => a !== null);
  }, [agents, localStatuses, dismissedIds]);

  const allAgents = useMemo(() => collectFlatAgents(hydratedAgents, []), [hydratedAgents]);
  const hasRunning = useMemo(
    () => allAgents.some((a) => a.status === "running"),
    [allAgents],
  );

  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => {
      setTickSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [hasRunning]);

  // Filter counts across lead agents (and their sub-agents)
  const counts = useMemo(() => {
    let running = 0;
    let waiting = 0;
    let failed = 0;
    for (const a of hydratedAgents) {
      const subStatuses = [a.status, ...(a.children?.map((c) => c.status) ?? [])];
      if (subStatuses.includes("running")) running++;
      if (subStatuses.includes("waiting") || subStatuses.includes("failed")) waiting++;
      if (subStatuses.includes("failed")) failed++;
    }
    return {
      all: hydratedAgents.length,
      running,
      waiting,
      failed,
    };
  }, [hydratedAgents]);

  const visibleAgents = useMemo(() => {
    return hydratedAgents.filter((a) => {
      const statuses = [a.status, ...(a.children?.map((c) => c.status) ?? [])];
      if (activeFilter === "all") return true;
      if (activeFilter === "running") return statuses.includes("running");
      if (activeFilter === "waiting")
        return statuses.includes("waiting") || statuses.includes("failed");
      if (activeFilter === "failed") return statuses.includes("failed");
      return true;
    });
  }, [hydratedAgents, activeFilter]);

  // Inbox items: all waiting or failed agents (lead or sub-agent)
  const inboxItems = useMemo(() => {
    const list: { agent: MissionAgent; leadId: string }[] = [];
    for (const lead of hydratedAgents) {
      if (lead.status === "waiting" || lead.status === "failed") {
        list.push({ agent: lead, leadId: lead.id });
      }
      if (lead.children) {
        for (const sub of lead.children) {
          if (sub.status === "waiting" || sub.status === "failed") {
            list.push({ agent: sub, leadId: lead.id });
          }
        }
      }
    }
    return list;
  }, [hydratedAgents]);

  // Build SVG recap curve from `since` to `now`
  const curveData = useMemo(() => {
    const W = 680;
    const H = 68;
    const padX = 18;
    const span = Math.max(1, now - since);
    const xFor = (at: number) => {
      const ratio = Math.max(0, Math.min(1, (at - since) / span));
      return padX + ratio * (W - padX * 2);
    };

    // Sample 42 points along the timeline, adding Gaussian peaks at each event
    const samples = 42;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = since + (i / samples) * span;
      const x = xFor(t);
      let energy = 0.14;
      for (const ev of events) {
        const dist = (t - ev.at) / (span * 0.085);
        const weight =
          ev.kind === "failed" ? 0.72 : ev.kind === "needs" ? 0.58 : 0.44;
        energy += Math.exp(-dist * dist) * weight;
      }
      const clamped = Math.min(0.92, energy);
      const y = H - 10 - clamped * (H - 22);
      pts.push({ x, y });
    }

    // Smooth cubic bezier path
    let line = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cx = ((prev.x + curr.x) / 2).toFixed(1);
      line += ` C ${cx} ${prev.y.toFixed(1)}, ${cx} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }
    const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${H - 6} L ${pts[0].x.toFixed(1)} ${H - 6} Z`;

    const dots = events.map((ev) => {
      const x = xFor(ev.at);
      // Find nearest sample y
      let bestY = H - 24;
      let bestDist = Infinity;
      for (const p of pts) {
        const d = Math.abs(p.x - x);
        if (d < bestDist) {
          bestDist = d;
          bestY = p.y;
        }
      }
      return { ev, x, y: bestY };
    });

    return { W, H, line, area, dots };
  }, [events, since, now]);

  const activeEvent = useMemo(
    () => (activeEventId ? events.find((e) => e.id === activeEventId) ?? null : null),
    [activeEventId, events],
  );

  const handleApprove = (agent: MissionAgent) => {
    setLocalStatuses((prev) => ({ ...prev, [agent.id]: "running" }));
    onApprove?.(agent);
  };

  const handleReject = (agent: MissionAgent) => {
    setLocalStatuses((prev) => ({ ...prev, [agent.id]: "done" }));
    onReject?.(agent);
  };

  const handleRetry = (agent: MissionAgent) => {
    setLocalStatuses((prev) => ({ ...prev, [agent.id]: "running" }));
    onRetry?.(agent);
  };

  const handleDismiss = (agent: MissionAgent) => {
    setDismissedIds((prev) => new Set([...prev, agent.id]));
    onDismiss?.(agent);
  };

  const toggleInboxExpand = (id: string) => {
    setExpandedInboxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalCost = useMemo(
    () => allAgents.reduce((sum, a) => sum + (a.cost ?? 0), 0),
    [allAgents],
  );

  return (
    <div className={["ui-mcc", className].filter(Boolean).join(" ")}>
      <style href="ui-mission-control-clean" precedence="default">
        {css}
      </style>

      {/* Top Bar: Heading + Radio Group Filter */}
      <div className="ui-mcc__top">
        <div className="ui-mcc__top-left">
          <span className="ui-mcc__live-dot" data-active={hasRunning || undefined} />
          <h3 className="ui-mcc__title">{title}</h3>
          <span className="ui-mcc__meta">
            {allAgents.length} agents · {formatCost(totalCost)}
          </span>
        </div>

        <div
          className="ui-mcc__filters"
          role="radiogroup"
          aria-label="Show agents"
        >
          {(
            [
              { id: "all", label: "All", count: counts.all },
              { id: "running", label: "Running", count: counts.running },
              { id: "waiting", label: "Needs you", count: counts.waiting },
              { id: "failed", label: "Failed", count: counts.failed },
            ] as const
          ).map((tab) => {
            const checked = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="radio"
                aria-checked={checked}
                className="ui-mcc__filter-btn"
                data-checked={checked || undefined}
                data-kind={tab.id}
                onClick={() => setFilter(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="ui-mcc__filter-count">{tab.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Recap Curve Strip */}
      <div className="ui-mcc__recap">
        <div className="ui-mcc__recap-head">
          <span className="ui-mcc__recap-label">ACTIVITY RECAP ({formatRelMin(since)} → now)</span>
          {activeEvent ? (
            <div className="ui-mcc__recap-tooltip">
              <span className="ui-mcc__ev-dot" data-kind={activeEvent.kind} />
              <strong>{activeEvent.title}</strong>
              {activeEvent.detail && (
                <span className="ui-mcc__recap-detail">{activeEvent.detail}</span>
              )}
              <span className="ui-mcc__recap-time">{formatRelMin(activeEvent.at)}</span>
            </div>
          ) : (
            <span className="ui-mcc__recap-hint">
              Hover an event peak to spotlight its agent
            </span>
          )}
        </div>

        <div className="ui-mcc__curve-wrap">
          <svg
            viewBox={`0 0 ${curveData.W} ${curveData.H}`}
            className="ui-mcc__curve-svg"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="ui-mcc-area-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--mcc-accent, #0070f3)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--mcc-accent, #0070f3)" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <path d={curveData.area} fill="url(#ui-mcc-area-grad)" />
            <path
              d={curveData.line}
              fill="none"
              stroke="var(--mcc-accent, #0070f3)"
              strokeWidth="1.6"
              strokeOpacity="0.65"
            />
          </svg>

          {/* Interactive Event Peaks */}
          {curveData.dots.map(({ ev, x, y }) => {
            const leftPct = (x / curveData.W) * 100;
            const topPct = (y / curveData.H) * 100;
            const isHighlighted = activeEventId === ev.id || hoverAgentId === ev.agent;
            return (
              <button
                key={ev.id}
                type="button"
                className="ui-mcc__peak-btn"
                data-kind={ev.kind}
                data-active={isHighlighted || undefined}
                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                aria-label={`${ev.title} (${formatRelMin(ev.at)})`}
                onMouseEnter={() => {
                  setActiveEventId(ev.id);
                  setHoverAgentId(ev.agent);
                }}
                onMouseLeave={() => {
                  setActiveEventId(null);
                  setHoverAgentId(null);
                }}
                onFocus={() => {
                  setActiveEventId(ev.id);
                  setHoverAgentId(ev.agent);
                }}
                onBlur={() => {
                  setActiveEventId(null);
                  setHoverAgentId(null);
                }}
              >
                <span className="ui-mcc__peak-dot" />
                {ev.count && ev.count > 1 && (
                  <span className="ui-mcc__peak-count">{ev.count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Split: Fleet in the Middle + Needs-you Inbox on the Right */}
      <div className="ui-mcc__main">
        {/* Middle Fleet */}
        <div className="ui-mcc__fleet">
          <div className="ui-mcc__section-head">
            <span>AGENT FLEET ({visibleAgents.length})</span>
            <span>STATUS / ELAPSED / COST</span>
          </div>

          <div className="ui-mcc__fleet-list">
            {visibleAgents.map((lead) => {
              const dimmed = hoverAgentId !== null && hoverAgentId !== lead.id;
              const spotlight = hoverAgentId === lead.id;
              const elapsedSec =
                lead.started !== undefined
                  ? lead.ended !== undefined
                    ? lead.started - lead.ended
                    : lead.started + (lead.status === "running" ? tickSec : 0)
                  : 0;

              return (
                <div
                  key={lead.id}
                  className="ui-mcc__lead-group"
                  data-dimmed={dimmed || undefined}
                  data-spotlight={spotlight || undefined}
                  onMouseEnter={() => setHoverAgentId(lead.id)}
                  onMouseLeave={() => setHoverAgentId(null)}
                >
                  {/* Lead Agent Card */}
                  <div className="ui-mcc__agent-row" data-status={lead.status}>
                    <div className="ui-mcc__agent-main">
                      <span className="ui-mcc__status-dot" data-status={lead.status} />
                      {lead.avatar && <span className="ui-mcc__avatar">{lead.avatar}</span>}
                      <span className="ui-mcc__agent-name">{lead.name}</span>
                      {lead.model && <span className="ui-mcc__model">{lead.model}</span>}
                      <span className="ui-mcc__task" title={lead.task}>
                        {lead.task}
                      </span>
                    </div>

                    <div className="ui-mcc__agent-right">
                      {lead.tools && lead.tools.length > 0 && (
                        <div className="ui-mcc__tools">
                          {lead.tools.slice(0, 3).map((tool) => (
                            <span key={tool} className="ui-mcc__tool-chip">
                              {tool}
                            </span>
                          ))}
                        </div>
                      )}
                      {lead.started !== undefined && (
                        <span className="ui-mcc__timer">{formatElapsed(elapsedSec)}</span>
                      )}
                      {typeof lead.cost === "number" && (
                        <span className="ui-mcc__cost">{formatCost(lead.cost)}</span>
                      )}
                      <span className="ui-mcc__badge" data-status={lead.status}>
                        {lead.status === "waiting" ? "Needs you" : lead.status}
                      </span>
                    </div>
                  </div>

                  {/* Nested Sub-Agents */}
                  {lead.children && lead.children.length > 0 && (
                    <div className="ui-mcc__sub-list">
                      {lead.children.map((sub) => {
                        const subElapsed =
                          sub.started !== undefined
                            ? sub.ended !== undefined
                              ? sub.started - sub.ended
                              : sub.started + (sub.status === "running" ? tickSec : 0)
                            : 0;
                        return (
                          <div
                            key={sub.id}
                            className="ui-mcc__sub-row"
                            data-status={sub.status}
                          >
                            <span className="ui-mcc__sub-branch" aria-hidden="true" />
                            <span className="ui-mcc__status-dot" data-status={sub.status} />
                            <span className="ui-mcc__sub-name">{sub.name}</span>
                            {sub.model && <span className="ui-mcc__model">{sub.model}</span>}
                            <span className="ui-mcc__task" title={sub.task}>
                              {sub.task}
                            </span>
                            <div className="ui-mcc__agent-right">
                              {sub.started !== undefined && (
                                <span className="ui-mcc__timer">
                                  {formatElapsed(subElapsed)}
                                </span>
                              )}
                              {typeof sub.cost === "number" && (
                                <span className="ui-mcc__cost">{formatCost(sub.cost)}</span>
                              )}
                              <span className="ui-mcc__badge" data-status={sub.status}>
                                {sub.status === "waiting" ? "Needs you" : sub.status}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side Inbox (Waiting & Failed) */}
        <div className="ui-mcc__inbox">
          <div className="ui-mcc__section-head">
            <span>NEEDS ATTENTION ({inboxItems.length})</span>
            <span>ACTION</span>
          </div>

          {inboxItems.length === 0 ? (
            <div className="ui-mcc__inbox-empty">
              All agents running smoothly — no pending approvals or errors.
            </div>
          ) : (
            <div className="ui-mcc__inbox-list">
              {inboxItems.map(({ agent, leadId }) => {
                const isExpanded = expandedInboxIds.has(agent.id);
                const dimmed = hoverAgentId !== null && hoverAgentId !== leadId;
                const spotlight = hoverAgentId === leadId;
                return (
                  <div
                    key={agent.id}
                    className="ui-mcc__inbox-card"
                    data-status={agent.status}
                    data-dimmed={dimmed || undefined}
                    data-spotlight={spotlight || undefined}
                    onMouseEnter={() => setHoverAgentId(leadId)}
                    onMouseLeave={() => setHoverAgentId(null)}
                  >
                    <button
                      type="button"
                      className="ui-mcc__inbox-toggle"
                      aria-expanded={isExpanded}
                      onClick={() => toggleInboxExpand(agent.id)}
                    >
                      <span className="ui-mcc__status-dot" data-status={agent.status} />
                      <strong className="ui-mcc__inbox-name">{agent.name}</strong>
                      <span className="ui-mcc__badge" data-status={agent.status}>
                        {agent.status === "waiting" ? "Approval" : "Error"}
                      </span>
                    </button>

                    <p className="ui-mcc__inbox-prompt">
                      {agent.status === "waiting"
                        ? agent.ask || agent.task
                        : agent.error || agent.task}
                    </p>

                    {isExpanded && (
                      <div className="ui-mcc__inbox-detail">
                        <div>Task: {agent.task}</div>
                        {agent.model && <div>Model: {agent.model}</div>}
                        {agent.tools && agent.tools.length > 0 && (
                          <div>Tools: {agent.tools.join(", ")}</div>
                        )}
                      </div>
                    )}

                    <div className="ui-mcc__inbox-actions">
                      {agent.status === "waiting" ? (
                        <>
                          <button
                            type="button"
                            className="ui-mcc__btn ui-mcc__btn--primary"
                            onClick={() => handleApprove(agent)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="ui-mcc__btn"
                            onClick={() => handleReject(agent)}
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ui-mcc__btn ui-mcc__btn--primary"
                            onClick={() => handleRetry(agent)}
                          >
                            Retry
                          </button>
                          <button
                            type="button"
                            className="ui-mcc__btn"
                            onClick={() => handleDismiss(agent)}
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const css = /* css */ `
.ui-mcc {
  --mcc-bg: var(--aui-surface, #ffffff);
  --mcc-surface: var(--aui-subtle, rgba(20, 20, 22, 0.045));
  --mcc-fg: var(--aui-ink, #141416);
  --mcc-muted: var(--aui-muted, #52525b);
  --mcc-subtle: var(--aui-muted, #6e7076);
  --mcc-border: var(--aui-border, rgba(20, 20, 22, 0.08));
  --mcc-hover: var(--aui-subtle, rgba(20, 20, 22, 0.06));
  --mcc-accent: var(--aui-blue, #0070f3);
  --mcc-focus: var(--aui-focus, #0070f3);
  --mcc-mono: var(--aui-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);

  background: var(--mcc-bg);
  color: var(--mcc-fg);
  border-radius: var(--aui-radius-lg, var(--aui-radius, 14px));
  box-shadow: var(--aui-shadow-card, 0 0 0 1px rgba(15, 23, 42, 0.07), 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -8px rgba(15, 23, 42, 0.06));
  font-family: var(--aui-font, -apple-system, BlinkMacSystemFont, "Inter", sans-serif);
  font-size: 12.5px;
  overflow: hidden;
}

:where(.dark, [data-theme="dark"]) .ui-mcc {
  --mcc-surface: rgba(255, 255, 255, 0.055);
  --mcc-hover: rgba(255, 255, 255, 0.085);
}

.ui-mcc__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mcc-border);
}

.ui-mcc__top-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ui-mcc__live-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--mcc-subtle);
}

.ui-mcc__live-dot[data-active="true"] {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.16);
}

.ui-mcc__title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--mcc-fg);
}

.ui-mcc__meta {
  font-family: var(--mcc-mono);
  font-size: 11.5px;
  color: var(--mcc-muted);
}

.ui-mcc__filters {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px;
  border-radius: 8px;
  background: var(--mcc-surface);
  border: 1px solid var(--mcc-border);
}

.ui-mcc__filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--mcc-muted);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.ui-mcc__filter-btn:hover {
  color: var(--mcc-fg);
}

.ui-mcc__filter-btn:focus-visible,
.ui-mcc__peak-btn:focus-visible,
.ui-mcc__inbox-toggle:focus-visible,
.ui-mcc__btn:focus-visible {
  outline: 2px solid var(--mcc-focus);
  outline-offset: 2px;
}

.ui-mcc__filter-btn[data-checked="true"] {
  background: var(--mcc-bg);
  color: var(--mcc-fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

:where(.dark, [data-theme="dark"]) .ui-mcc__filter-btn[data-checked="true"] {
  background: var(--aui-overlay, #27272a);
  color: var(--mcc-fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.ui-mcc__filter-count {
  font-family: var(--mcc-mono);
  font-size: 10.5px;
  color: var(--mcc-muted);
}

/* Recap Curve */
.ui-mcc__recap {
  padding: 10px 16px 8px;
  border-bottom: 1px solid var(--mcc-border);
  background: linear-gradient(180deg, var(--mcc-surface) 0%, var(--mcc-bg) 100%);
}

.ui-mcc__recap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 20px;
  margin-bottom: 4px;
}

.ui-mcc__recap-label {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--mcc-subtle);
}

.ui-mcc__recap-hint {
  font-size: 11px;
  color: var(--mcc-subtle);
}

.ui-mcc__recap-tooltip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--mcc-fg);
}

.ui-mcc__recap-detail {
  color: var(--mcc-muted);
}

.ui-mcc__recap-time {
  font-family: var(--mcc-mono);
  font-size: 10.5px;
  color: var(--mcc-subtle);
}

.ui-mcc__curve-wrap {
  position: relative;
  height: 64px;
  width: 100%;
}

.ui-mcc__curve-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.ui-mcc__peak-btn {
  position: absolute;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border: 0;
  border-radius: 999px;
  background: var(--mcc-bg);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
  cursor: pointer;
  transition: transform 140ms ease;
}

.ui-mcc__peak-btn:hover,
.ui-mcc__peak-btn[data-active="true"] {
  transform: translate(-50%, -50%) scale(1.22);
  z-index: 2;
}

.ui-mcc__peak-dot,
.ui-mcc__ev-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #10b981;
}

.ui-mcc__peak-btn[data-kind="needs"] .ui-mcc__peak-dot,
.ui-mcc__ev-dot[data-kind="needs"] {
  background: #f59e0b;
}

.ui-mcc__peak-btn[data-kind="failed"] .ui-mcc__peak-dot,
.ui-mcc__ev-dot[data-kind="failed"] {
  background: #ef4444;
}

.ui-mcc__peak-count {
  font-family: var(--mcc-mono);
  font-size: 9.5px;
  font-weight: 600;
  padding: 0 3px;
  color: var(--mcc-fg);
}

/* Main Split */
.ui-mcc__main {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(260px, 1fr);
}

@media (max-width: 820px) {
  .ui-mcc__main {
    grid-template-columns: 1fr;
  }
}

.ui-mcc__fleet {
  border-right: 1px solid var(--mcc-border);
}

@media (max-width: 820px) {
  .ui-mcc__fleet {
    border-right: 0;
    border-bottom: 1px solid var(--mcc-border);
  }
}

.ui-mcc__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 14px;
  border-bottom: 1px solid var(--mcc-border);
  background: var(--mcc-surface);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--mcc-subtle);
}

.ui-mcc__fleet-list {
  display: flex;
  flex-direction: column;
}

.ui-mcc__lead-group {
  border-bottom: 1px solid var(--mcc-border);
  transition: opacity 150ms ease, background 150ms ease;
}

.ui-mcc__lead-group:last-child {
  border-bottom: 0;
}

.ui-mcc__lead-group[data-dimmed="true"] {
  opacity: 0.42;
}

.ui-mcc__lead-group[data-spotlight="true"] {
  background: color-mix(in srgb, var(--mcc-accent) 6%, transparent);
}

.ui-mcc__agent-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
}

.ui-mcc__agent-main {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
}

.ui-mcc__status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
  background: #94a3b8;
}

.ui-mcc__status-dot[data-status="running"] {
  background: #0070f3;
}

.ui-mcc__status-dot[data-status="waiting"] {
  background: #f59e0b;
}

.ui-mcc__status-dot[data-status="failed"] {
  background: #ef4444;
}

.ui-mcc__status-dot[data-status="done"] {
  background: #10b981;
}

.ui-mcc__agent-name {
  font-weight: 600;
  color: var(--mcc-fg);
  white-space: nowrap;
}

.ui-mcc__sub-name {
  font-weight: 500;
  color: var(--mcc-fg);
  white-space: nowrap;
}

.ui-mcc__model {
  font-family: var(--mcc-mono);
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--mcc-surface);
  color: var(--mcc-muted);
  flex-shrink: 0;
}

.ui-mcc__task {
  color: var(--mcc-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-mcc__agent-right {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.ui-mcc__tools {
  display: inline-flex;
  gap: 4px;
}

.ui-mcc__tool-chip {
  font-family: var(--mcc-mono);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--mcc-border);
  color: var(--mcc-muted);
}

.ui-mcc__timer,
.ui-mcc__cost {
  font-family: var(--mcc-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--mcc-subtle);
}

.ui-mcc__badge {
  font-size: 10.5px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  text-transform: capitalize;
  background: var(--mcc-surface);
  color: var(--mcc-muted);
}

.ui-mcc__badge[data-status="running"] {
  background: rgba(0, 112, 243, 0.12);
  color: #0070f3;
}

.ui-mcc__badge[data-status="waiting"] {
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
}

.ui-mcc__badge[data-status="failed"] {
  background: rgba(239, 68, 68, 0.14);
  color: #dc2626;
}

.ui-mcc__badge[data-status="done"] {
  background: rgba(16, 185, 129, 0.14);
  color: #059669;
}

:where(.dark, [data-theme="dark"]) .ui-mcc__badge[data-status="running"] {
  color: #60a5fa;
}
:where(.dark, [data-theme="dark"]) .ui-mcc__badge[data-status="waiting"] {
  color: #fbbf24;
}
:where(.dark, [data-theme="dark"]) .ui-mcc__badge[data-status="failed"] {
  color: #f87171;
}
:where(.dark, [data-theme="dark"]) .ui-mcc__badge[data-status="done"] {
  color: #34d399;
}

.ui-mcc__sub-list {
  display: flex;
  flex-direction: column;
  padding: 0 14px 8px 28px;
  gap: 4px;
}

.ui-mcc__sub-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--mcc-surface);
  font-size: 11.5px;
}

.ui-mcc__sub-row .ui-mcc__agent-right {
  margin-left: auto;
}

.ui-mcc__sub-branch {
  width: 8px;
  height: 8px;
  border-left: 1.5px solid var(--mcc-subtle);
  border-bottom: 1.5px solid var(--mcc-subtle);
  opacity: 0.45;
  margin-right: 2px;
}

/* Inbox Column */
.ui-mcc__inbox {
  display: flex;
  flex-direction: column;
  background: var(--mcc-bg);
}

.ui-mcc__inbox-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--mcc-subtle);
  font-size: 12px;
}

.ui-mcc__inbox-list {
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 8px;
}

.ui-mcc__inbox-card {
  border: 1px solid var(--mcc-border);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--mcc-bg);
  transition: opacity 150ms ease, border-color 150ms ease;
}

.ui-mcc__inbox-card[data-status="waiting"] {
  border-left: 3px solid #f59e0b;
}

.ui-mcc__inbox-card[data-status="failed"] {
  border-left: 3px solid #ef4444;
}

.ui-mcc__inbox-card[data-dimmed="true"] {
  opacity: 0.42;
}

.ui-mcc__inbox-card[data-spotlight="true"] {
  border-color: var(--mcc-accent);
}

.ui-mcc__inbox-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--mcc-fg);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.ui-mcc__inbox-name {
  flex: 1;
  font-weight: 600;
  color: var(--mcc-fg);
}

.ui-mcc__inbox-prompt {
  margin: 6px 0 8px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--mcc-muted);
}

.ui-mcc__inbox-detail {
  margin-bottom: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--mcc-surface);
  font-family: var(--mcc-mono);
  font-size: 11px;
  color: var(--mcc-muted);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ui-mcc__inbox-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ui-mcc__btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--mcc-border);
  background: var(--mcc-surface);
  color: var(--mcc-fg);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
}

.ui-mcc__btn:hover {
  background: var(--mcc-hover);
}

.ui-mcc__btn--primary {
  background: var(--aui-primary, var(--mcc-fg));
  color: var(--aui-on-primary, var(--mcc-bg));
  border-color: var(--aui-primary, var(--mcc-fg));
}

.ui-mcc__btn--primary:hover {
  opacity: 0.9;
  background: var(--aui-primary, var(--mcc-fg));
}
`;
