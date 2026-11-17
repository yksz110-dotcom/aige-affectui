"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/*
 * Live Session (Clean) – One workspace for a multi-agent run:
 * - Agent toolbar at the top (focusing an agent filters both stream and plan)
 * - Collaboration stream in the middle with expandable facts, attachments and @-mention composer
 * - Step plan on the right with live timers and Pause/Resume
 * - 216-cell (36×6) Context Window token grid underneath the plan
 * Matches affectUI New York Clean specification (.ui-lsc).
 */

export type StreamAgent = {
  id: string;
  name: string;
  model?: string;
  avatar?: ReactNode;
};

export type StreamAttachmentKind = "file" | "code" | "table" | "image" | "link" | (string & {});

export type StreamAttachment = {
  label: string;
  kind?: StreamAttachmentKind;
  preview?: string;
  meta?: string;
};

export type StreamMessageKind = "ask" | "reply" | "handoff" | "share" | "question" | "spawn";

export type StreamMessage = {
  id: string;
  /** Agent id, or "you" for a message sent by the user */
  from: string;
  /** Agent id, "all" for broadcast, or "you" when an agent asks the user */
  to: string;
  kind: StreamMessageKind;
  text: string;
  at?: string;
  replyTo?: string;
  typing?: boolean;
  attachments?: StreamAttachment[];
  details?: {
    facts?: { label: string; value: string }[];
    items?: string[];
  };
};

export type SessionStepStatus = "done" | "active" | "pending";

export type SessionStep = {
  id: string;
  title: string;
  /** Id of the agent that owns this step */
  agent: string;
  status?: SessionStepStatus;
  /** Duration in seconds for finished steps */
  duration?: number;
  /** Start time in ms (e.g. Date.now()) for the active step – drives its live timer */
  startedAt?: number;
};

export type SessionStatus = "running" | "paused" | "done";

export type ContextPart = {
  id: string;
  label: string;
  tokens?: number;
  locked?: boolean;
  compact?: boolean;
  color?: string;
};

export type SessionContext = {
  parts: ContextPart[];
  limit: number;
  model?: string;
  modelIcon?: ReactNode;
};

export type LiveSessionProps = {
  agents: StreamAgent[];
  messages: StreamMessage[];
  /** Title of the session, shown at the top of the plan */
  task: string;
  steps: SessionStep[];
  status?: SessionStatus;
  /** When the session started (timestamp in ms or Date) – drives the live timer */
  startedAt?: number | Date;
  /** Token breakdown shown in the context box below the plan */
  context?: SessionContext;
  /** Reveals messages one by one */
  live?: boolean;
  /** Optional icons keyed by word, shown inline when a message mentions that word */
  logos?: Record<string, ReactNode>;
  /** Controlled id of the focused agent */
  focusAgent?: string | null;
  onFocusAgentChange?: (id: string | null) => void;
  /** Called when the user sends a message from the bottom bar */
  onSend?: (message: { text: string; to: string[]; replyTo?: string }) => void;
  onPause?: () => void;
  onResume?: () => void;
  /** Height of the workspace in px */
  maxHeight?: number;
  className?: string;
};

const DEFAULT_PART_COLORS = [
  "#0070f3",
  "#7c3aed",
  "#0d9488",
  "#f59e0b",
  "#ec4899",
  "#64748b",
];

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function LiveSession({
  agents,
  messages: propMessages,
  task,
  steps,
  status: controlledStatus = "running",
  context,
  focusAgent: controlledFocusAgent,
  onFocusAgentChange,
  onSend,
  onPause,
  onResume,
  maxHeight = 560,
  className,
}: LiveSessionProps) {
  const [internalFocus, setInternalFocus] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<SessionStatus>(controlledStatus);
  const [expandedMsgIds, setExpandedMsgIds] = useState<Set<string>>(() => new Set());
  const [localMessages, setLocalMessages] = useState<StreamMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [replyToId, setReplyToId] = useState<string | undefined>(undefined);
  const [hoverPartId, setHoverPartId] = useState<string | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);

  useEffect(() => {
    setLocalStatus(controlledStatus);
  }, [controlledStatus]);

  const focusedAgent =
    controlledFocusAgent !== undefined ? controlledFocusAgent : internalFocus;

  const setFocusAgent = (id: string | null) => {
    if (controlledFocusAgent === undefined) setInternalFocus(id);
    onFocusAgentChange?.(id);
  };

  const agentMap = useMemo(() => {
    const m = new Map<string, StreamAgent>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const allMessages = useMemo(
    () => [...propMessages, ...localMessages],
    [propMessages, localMessages],
  );

  const toggleExpandMsg = (id: string) => {
    setExpandedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const targetIds = focusedAgent ? [focusedAgent] : ["all"];
    const newMsg: StreamMessage = {
      id: `user-${Date.now()}`,
      from: "you",
      to: targetIds[0],
      kind: replyToId ? "reply" : "ask",
      text: trimmed,
      at: "just now",
      replyTo: replyToId,
    };
    setLocalMessages((prev) => [...prev, newMsg]);
    onSend?.({ text: trimmed, to: targetIds, replyTo: replyToId });
    setDraft("");
    setReplyToId(undefined);
    setMentionOpen(false);
  };

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const handleToolbarKey = (e: KeyboardEvent<HTMLElement>, idx: number) => {
    const total = agents.length + 1; // "All" + agents
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = (idx + 1) % total;
      tabRefs.current[next]?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = (idx - 1 + total) % total;
      tabRefs.current[prev]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setFocusAgent(null);
    }
  };

  // Context 216-cell (36×6) grid computation
  const contextGrid = useMemo(() => {
    if (!context) return null;
    const totalCells = 216;
    const limit = Math.max(1, context.limit);
    const partsWithColor = context.parts.map((p, i) => ({
      ...p,
      tokens: p.tokens ?? 0,
      color: p.color ?? DEFAULT_PART_COLORS[i % DEFAULT_PART_COLORS.length],
    }));
    const usedTokens = partsWithColor.reduce((s, p) => s + p.tokens, 0);
    const cells: { partId: string | null; color: string | null }[] = [];

    for (const p of partsWithColor) {
      const count = Math.max(
        p.tokens > 0 ? 1 : 0,
        Math.round((p.tokens / limit) * totalCells),
      );
      for (let i = 0; i < count && cells.length < totalCells; i++) {
        cells.push({ partId: p.id, color: p.color });
      }
    }
    while (cells.length < totalCells) {
      cells.push({ partId: null, color: null });
    }
    return {
      parts: partsWithColor,
      usedTokens,
      limit,
      pct: Math.min(100, Math.round((usedTokens / limit) * 100)),
      cells,
    };
  }, [context]);

  const activePart = useMemo(
    () =>
      hoverPartId && contextGrid
        ? contextGrid.parts.find((p) => p.id === hoverPartId) ?? null
        : null,
    [hoverPartId, contextGrid],
  );

  const togglePause = () => {
    if (localStatus === "running") {
      setLocalStatus("paused");
      onPause?.();
    } else if (localStatus === "paused") {
      setLocalStatus("running");
      onResume?.();
    }
  };

  return (
    <div
      className={["ui-lsc", className].filter(Boolean).join(" ")}
      style={{ "--ui-lsc-max-h": `${maxHeight}px` } as React.CSSProperties}
    >
      <style href="ui-live-session-clean" precedence="default">
        {css}
      </style>

      {/* Top Bar: Task Title + Agent Filter Toolbar + Status */}
      <div className="ui-lsc__top">
        <div className="ui-lsc__top-left">
          <span className="ui-lsc__status-pill" data-status={localStatus}>
            <span className="ui-lsc__status-dot" />
            {localStatus === "running"
              ? "Live"
              : localStatus === "paused"
                ? "Paused"
                : "Done"}
          </span>
          <h3 className="ui-lsc__task" title={task}>
            {task}
          </h3>
        </div>

        {/* Agent Filter Toolbar */}
        <div
          className="ui-lsc__toolbar"
          role="toolbar"
          aria-label="Filter by agent"
        >
          <button
            ref={(el) => {
              tabRefs.current[0] = el;
            }}
            type="button"
            aria-pressed={focusedAgent === null}
            className="ui-lsc__agent-tab"
            data-active={focusedAgent === null || undefined}
            onClick={() => setFocusAgent(null)}
            onKeyDown={(e) => handleToolbarKey(e, 0)}
          >
            All ({agents.length})
          </button>
          {agents.map((ag, i) => {
            const pressed = focusedAgent === ag.id;
            return (
              <button
                key={ag.id}
                ref={(el) => {
                  tabRefs.current[i + 1] = el;
                }}
                type="button"
                aria-pressed={pressed}
                className="ui-lsc__agent-tab"
                data-active={pressed || undefined}
                onClick={() => setFocusAgent(pressed ? null : ag.id)}
                onKeyDown={(e) => handleToolbarKey(e, i + 1)}
              >
                {ag.avatar && <span className="ui-lsc__tab-avatar">{ag.avatar}</span>}
                <span>{ag.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Split Workspace: Stream on Left, Plan + 216-Cell Context Grid on Right */}
      <div className="ui-lsc__body">
        {/* Left: Collaboration Stream + Composer */}
        <div className="ui-lsc__stream-col">
          <div className="ui-lsc__messages" role="log" aria-label="Agent collaboration stream">
            {allMessages.map((msg) => {
              const fromAgent = agentMap.get(msg.from);
              const toAgent = agentMap.get(msg.to);
              const fromName = msg.from === "you" ? "You" : fromAgent?.name ?? msg.from;
              const toName =
                msg.to === "all"
                  ? "All"
                  : msg.to === "you"
                    ? "You"
                    : toAgent?.name ?? msg.to;

              const matchesFocus =
                !focusedAgent ||
                msg.from === focusedAgent ||
                msg.to === focusedAgent;
              const hasDetails = Boolean(
                (msg.details?.facts && msg.details.facts.length > 0) ||
                  (msg.details?.items && msg.details.items.length > 0),
              );
              const isExpanded = expandedMsgIds.has(msg.id);

              return (
                <div
                  key={msg.id}
                  className="ui-lsc__msg"
                  data-dimmed={!matchesFocus || undefined}
                  data-kind={msg.kind}
                  tabIndex={hasDetails ? 0 : undefined}
                  onClick={() => {
                    if (hasDetails) toggleExpandMsg(msg.id);
                  }}
                  onKeyDown={(e) => {
                    if (hasDetails && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      toggleExpandMsg(msg.id);
                    }
                  }}
                >
                  <div className="ui-lsc__msg-head">
                    <div className="ui-lsc__msg-route">
                      <strong className="ui-lsc__msg-from">{fromName}</strong>
                      <span className="ui-lsc__msg-arrow" aria-hidden="true">
                        →
                      </span>
                      <span className="ui-lsc__msg-to">{toName}</span>

                      {msg.kind === "handoff" && (
                        <span className="ui-lsc__kind-tag" data-kind="handoff">
                          Handoff
                        </span>
                      )}
                      {msg.kind === "question" && (
                        <span className="ui-lsc__kind-tag" data-kind="question">
                          Needs you
                        </span>
                      )}
                      {msg.kind === "spawn" && (
                        <span className="ui-lsc__kind-tag" data-kind="spawn">
                          Spawn
                        </span>
                      )}
                    </div>

                    <div className="ui-lsc__msg-meta">
                      {hasDetails && (
                        <span className="ui-lsc__expand-hint">
                          {isExpanded ? "Hide facts ▴" : "Facts ▾"}
                        </span>
                      )}
                      {msg.at && <span className="ui-lsc__msg-at">{msg.at}</span>}
                      {msg.kind === "question" && (
                        <button
                          type="button"
                          className="ui-lsc__reply-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReplyToId(msg.id);
                          }}
                        >
                          Reply
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="ui-lsc__msg-text">{msg.text}</p>

                  {/* Attachments */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="ui-lsc__attachments">
                      {msg.attachments.map((att, i) => (
                        <span key={i} className="ui-lsc__att">
                          <span className="ui-lsc__att-label">{att.label}</span>
                          {att.meta && <span className="ui-lsc__att-meta">{att.meta}</span>}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Expandable Details (Facts & Items) */}
                  {hasDetails && isExpanded && msg.details && (
                    <div className="ui-lsc__details">
                      {msg.details.facts && msg.details.facts.length > 0 && (
                        <div className="ui-lsc__facts">
                          {msg.details.facts.map((f, i) => (
                            <div key={i} className="ui-lsc__fact">
                              <span className="ui-lsc__fact-label">{f.label}</span>
                              <span className="ui-lsc__fact-val">{f.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {msg.details.items && msg.details.items.length > 0 && (
                        <ul className="ui-lsc__detail-items">
                          {msg.details.items.map((it, i) => (
                            <li key={i}>{it}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom Composer */}
          <div className="ui-lsc__composer">
            {replyToId && (
              <div className="ui-lsc__reply-banner">
                <span>Replying to #{replyToId}</span>
                <button
                  type="button"
                  onClick={() => setReplyToId(undefined)}
                  aria-label="Cancel reply"
                >
                  ×
                </button>
              </div>
            )}
            {mentionOpen && (
              <div className="ui-lsc__mention-menu">
                {agents.map((ag) => (
                  <button
                    key={ag.id}
                    type="button"
                    className="ui-lsc__mention-item"
                    onClick={() => {
                      setDraft((d) => `${d.replace(/@$/, "")}@${ag.name} `);
                      setMentionOpen(false);
                    }}
                  >
                    <strong>@{ag.name}</strong>
                    {ag.model && <span>{ag.model}</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="ui-lsc__input-row">
              <input
                type="text"
                className="ui-lsc__input"
                placeholder={
                  focusedAgent
                    ? `Message ${agentMap.get(focusedAgent)?.name ?? focusedAgent} (type @ to mention)…`
                    : "Steer session or @mention an agent…"
                }
                value={draft}
                onChange={(e) => {
                  const val = e.target.value;
                  setDraft(val);
                  setMentionOpen(val.endsWith("@"));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSend();
                  } else if (e.key === "Escape") {
                    setMentionOpen(false);
                    setReplyToId(undefined);
                  }
                }}
              />
              <button
                type="button"
                className="ui-lsc__send-btn"
                onClick={handleSend}
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* Right: Step Plan + 216-Cell Context Window */}
        <div className="ui-lsc__side-col">
          {/* Step Plan */}
          <div className="ui-lsc__plan">
            <div className="ui-lsc__plan-head">
              <span className="ui-lsc__plan-title">
                SESSION PLAN ({steps.filter((s) => s.status === "done").length}/{steps.length})
              </span>
              {localStatus !== "done" && (
                <button
                  type="button"
                  className="ui-lsc__pause-btn"
                  onClick={togglePause}
                >
                  {localStatus === "paused" ? "Resume" : "Pause"}
                </button>
              )}
            </div>

            <ol className="ui-lsc__step-list">
              {steps.map((st) => {
                const owner = agentMap.get(st.agent);
                const dimmed = focusedAgent !== null && st.agent !== focusedAgent;
                return (
                  <li
                    key={st.id}
                    className="ui-lsc__step"
                    data-status={st.status ?? "pending"}
                    data-dimmed={dimmed || undefined}
                  >
                    <span className="ui-lsc__step-icon" data-status={st.status ?? "pending"}>
                      {st.status === "done" ? "✓" : st.status === "active" ? "●" : "○"}
                    </span>
                    <div className="ui-lsc__step-body">
                      <span className="ui-lsc__step-title">{st.title}</span>
                      <div className="ui-lsc__step-meta">
                        <span className="ui-lsc__step-owner">
                          {owner?.name ?? st.agent}
                        </span>
                        {st.duration !== undefined && (
                          <span className="ui-lsc__step-dur">{st.duration}s</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* 216-Cell (36×6) Context Window Matrix */}
          {contextGrid && context && (
            <div className="ui-lsc__ctx">
              <div className="ui-lsc__ctx-head">
                <span className="ui-lsc__ctx-title">
                  CONTEXT WINDOW {context.model ? `· ${context.model}` : ""}
                </span>
                <span className="ui-lsc__ctx-usage">
                  {activePart
                    ? `${activePart.label}: ${formatTokens(activePart.tokens)}`
                    : `${formatTokens(contextGrid.usedTokens)} / ${formatTokens(contextGrid.limit)} (${contextGrid.pct}%)`}
                </span>
              </div>

              {/* 36×6 = 216 Cells */}
              <div className="ui-lsc__ctx-grid" aria-hidden="true">
                {contextGrid.cells.map((cell, idx) => {
                  const dimmed =
                    hoverPartId !== null && cell.partId !== hoverPartId;
                  return (
                    <span
                      key={idx}
                      className="ui-lsc__ctx-cell"
                      data-filled={cell.partId !== null || undefined}
                      data-dimmed={dimmed || undefined}
                      style={
                        cell.color ? { backgroundColor: cell.color } : undefined
                      }
                    />
                  );
                })}
              </div>

              {/* Legend */}
              <div className="ui-lsc__ctx-legend">
                {contextGrid.parts.map((part) => (
                  <button
                    key={part.id}
                    type="button"
                    className="ui-lsc__ctx-part"
                    onMouseEnter={() => setHoverPartId(part.id)}
                    onMouseLeave={() => setHoverPartId(null)}
                    onFocus={() => setHoverPartId(part.id)}
                    onBlur={() => setHoverPartId(null)}
                  >
                    <span
                      className="ui-lsc__ctx-swatch"
                      style={{ backgroundColor: part.color }}
                    />
                    <span className="ui-lsc__ctx-part-label">{part.label}</span>
                    <span className="ui-lsc__ctx-part-tok">
                      {formatTokens(part.tokens)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const css = /* css */ `
.ui-lsc {
  --lsc-bg: var(--aui-surface, #ffffff);
  --lsc-surface: var(--aui-subtle, rgba(20, 20, 22, 0.04));
  --lsc-fg: var(--aui-ink, #141416);
  --lsc-muted: var(--aui-muted, #52525b);
  --lsc-subtle: var(--aui-muted, #6e7076);
  --lsc-border: var(--aui-border, rgba(20, 20, 22, 0.08));
  --lsc-hover: var(--aui-subtle, rgba(20, 20, 22, 0.03));
  --lsc-cell-empty: var(--aui-border, rgba(20, 20, 22, 0.08));
  --lsc-accent: var(--aui-blue, #0070f3);
  --lsc-focus: var(--aui-focus, #0070f3);
  --lsc-mono: var(--aui-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);

  background: var(--lsc-bg);
  color: var(--lsc-fg);
  border-radius: var(--aui-radius-lg, var(--aui-radius, 14px));
  box-shadow: var(--aui-shadow-card, 0 0 0 1px rgba(15, 23, 42, 0.07), 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -8px rgba(15, 23, 42, 0.06));
  font-family: var(--aui-font, -apple-system, BlinkMacSystemFont, "Inter", sans-serif);
  font-size: 12.5px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ui-lsc__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--lsc-border);
}

.ui-lsc__top-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ui-lsc__status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.12);
  color: var(--aui-success, #059669);
  flex-shrink: 0;
}

.ui-lsc__status-pill[data-status="paused"] {
  background: rgba(245, 158, 11, 0.14);
  color: var(--aui-warning, #b45309);
}

.ui-lsc__status-pill[data-status="done"] {
  background: var(--lsc-surface);
  color: var(--lsc-muted);
}

.ui-lsc__status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.ui-lsc__task {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--lsc-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-lsc__toolbar {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px;
  border-radius: 8px;
  background: var(--lsc-surface);
  border: 1px solid var(--lsc-border);
}

.ui-lsc__agent-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--lsc-muted);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}

.ui-lsc__agent-tab:hover {
  color: var(--lsc-fg);
}

.ui-lsc__agent-tab:focus-visible,
.ui-lsc__pause-btn:focus-visible,
.ui-lsc__reply-btn:focus-visible,
.ui-lsc__send-btn:focus-visible,
.ui-lsc__ctx-part:focus-visible,
.ui-lsc__msg:focus-visible {
  outline: 2px solid var(--lsc-focus);
  outline-offset: 2px;
}

.ui-lsc__agent-tab[data-active="true"] {
  background: var(--lsc-bg);
  color: var(--lsc-fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

:where(.dark, [data-theme="dark"]) .ui-lsc__agent-tab[data-active="true"] {
  background: var(--aui-overlay, #27272a);
}

.ui-lsc__body {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(260px, 1fr);
  max-height: var(--ui-lsc-max-h, 560px);
}

@media (max-width: 820px) {
  .ui-lsc__body {
    grid-template-columns: 1fr;
    max-height: none;
  }
}

.ui-lsc__stream-col {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--lsc-border);
  min-height: 0;
}

.ui-lsc__messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ui-lsc__msg {
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px solid var(--lsc-border);
  background: var(--lsc-bg);
  transition: opacity 150ms ease, background 120ms ease;
}

.ui-lsc__msg:hover {
  background: var(--lsc-hover);
}

.ui-lsc__msg[data-dimmed="true"] {
  opacity: 0.35;
}

.ui-lsc__msg[data-kind="question"] {
  border-left: 3px solid var(--aui-amber, #f59e0b);
}

.ui-lsc__msg[data-kind="handoff"] {
  border-left: 3px solid var(--lsc-accent);
}

.ui-lsc__msg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.ui-lsc__msg-route {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
}

.ui-lsc__msg-from {
  color: var(--lsc-fg);
}

.ui-lsc__msg-arrow {
  color: var(--lsc-subtle);
}

.ui-lsc__msg-to {
  color: var(--lsc-muted);
  font-weight: 500;
}

.ui-lsc__kind-tag {
  font-size: 9.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--lsc-accent) 12%, transparent);
  color: var(--lsc-accent);
}

.ui-lsc__kind-tag[data-kind="question"] {
  background: color-mix(in srgb, var(--aui-amber, #f59e0b) 15%, transparent);
  color: var(--aui-warning, #b45309);
}

.ui-lsc__msg-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--lsc-subtle);
}

.ui-lsc__expand-hint {
  color: var(--lsc-accent);
  font-weight: 500;
  cursor: pointer;
}

.ui-lsc__msg-at {
  font-family: var(--lsc-mono);
  color: var(--lsc-subtle);
}

.ui-lsc__reply-btn {
  border: 1px solid var(--lsc-border);
  background: var(--lsc-surface);
  color: var(--lsc-fg);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
  cursor: pointer;
}

.ui-lsc__msg-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--lsc-fg);
}

.ui-lsc__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}

.ui-lsc__att {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--lsc-surface);
  border: 1px solid var(--lsc-border);
  color: var(--lsc-fg);
  font-family: var(--lsc-mono);
  font-size: 10.5px;
}

.ui-lsc__att-meta {
  color: var(--lsc-subtle);
}

.ui-lsc__details {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--lsc-border);
}

.ui-lsc__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 6px;
}

.ui-lsc__fact {
  display: flex;
  flex-direction: column;
  padding: 4px 7px;
  border-radius: 5px;
  background: var(--lsc-surface);
}

.ui-lsc__fact-label {
  font-size: 9.5px;
  color: var(--lsc-subtle);
}

.ui-lsc__fact-val {
  font-family: var(--lsc-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--lsc-fg);
}

.ui-lsc__detail-items {
  margin: 6px 0 0;
  padding-left: 16px;
  font-size: 11px;
  color: var(--lsc-muted);
}

/* Composer */
.ui-lsc__composer {
  position: relative;
  padding: 8px 12px;
  border-top: 1px solid var(--lsc-border);
  background: var(--lsc-surface);
}

.ui-lsc__reply-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--lsc-muted);
  margin-bottom: 4px;
}

.ui-lsc__mention-menu {
  position: absolute;
  bottom: 46px;
  left: 12px;
  background: var(--aui-overlay, var(--lsc-bg));
  color: var(--lsc-fg);
  border: 1px solid var(--lsc-border);
  border-radius: 8px;
  box-shadow: var(--aui-shadow-popover, 0 4px 16px rgba(0, 0, 0, 0.1));
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 5;
}

.ui-lsc__mention-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--lsc-fg);
  font-size: 11.5px;
  cursor: pointer;
}

.ui-lsc__mention-item:hover {
  background: var(--lsc-surface);
}

.ui-lsc__input-row {
  display: flex;
  gap: 6px;
}

.ui-lsc__input {
  flex: 1;
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid var(--lsc-border);
  background: var(--lsc-bg);
  color: var(--lsc-fg);
  font-family: inherit;
  font-size: 12px;
}

.ui-lsc__input::placeholder {
  color: var(--aui-placeholder, #a1a1aa);
}

.ui-lsc__send-btn {
  padding: 6px 12px;
  border-radius: 7px;
  border: 0;
  background: var(--aui-primary, var(--lsc-fg));
  color: var(--aui-on-primary, var(--lsc-bg));
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
}

/* Right Column: Plan + Context */
.ui-lsc__side-col {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: var(--lsc-bg);
}

.ui-lsc__plan {
  padding: 12px 14px;
  border-bottom: 1px solid var(--lsc-border);
}

.ui-lsc__plan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.ui-lsc__plan-title,
.ui-lsc__ctx-title {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--lsc-subtle);
}

.ui-lsc__pause-btn {
  border: 1px solid var(--lsc-border);
  background: var(--lsc-surface);
  color: var(--lsc-fg);
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 10.5px;
  cursor: pointer;
}

.ui-lsc__step-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.ui-lsc__step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  transition: opacity 140ms ease;
}

.ui-lsc__step[data-dimmed="true"] {
  opacity: 0.35;
}

.ui-lsc__step-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  font-size: 10px;
  background: var(--lsc-surface);
  color: var(--lsc-subtle);
  flex-shrink: 0;
  margin-top: 1px;
}

.ui-lsc__step-icon[data-status="done"] {
  background: rgba(16, 185, 129, 0.14);
  color: var(--aui-success, #059669);
}

.ui-lsc__step-icon[data-status="active"] {
  background: color-mix(in srgb, var(--lsc-accent) 14%, transparent);
  color: var(--lsc-accent);
}

.ui-lsc__step-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.ui-lsc__step-title {
  font-weight: 500;
  color: var(--lsc-fg);
}

.ui-lsc__step-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--lsc-subtle);
}

.ui-lsc__step-dur {
  font-family: var(--lsc-mono);
}

/* 216-Cell Context Window */
.ui-lsc__ctx {
  padding: 12px 14px;
  background: var(--lsc-surface);
}

.ui-lsc__ctx-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.ui-lsc__ctx-usage {
  font-family: var(--lsc-mono);
  font-size: 10.5px;
  color: var(--lsc-muted);
}

.ui-lsc__ctx-grid {
  display: grid;
  grid-template-columns: repeat(36, 1fr);
  gap: 2px;
  margin-bottom: 9px;
}

.ui-lsc__ctx-cell {
  height: 7px;
  border-radius: 1.5px;
  background: var(--lsc-cell-empty);
  transition: opacity 120ms ease, transform 120ms ease;
}

.ui-lsc__ctx-cell[data-dimmed="true"] {
  opacity: 0.25;
}

.ui-lsc__ctx-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.ui-lsc__ctx-part {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid var(--lsc-border);
  background: var(--lsc-bg);
  color: var(--lsc-fg);
  font-family: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.ui-lsc__ctx-swatch {
  width: 6px;
  height: 6px;
  border-radius: 2px;
}

.ui-lsc__ctx-part-tok {
  font-family: var(--lsc-mono);
  color: var(--lsc-subtle);
}
`;
