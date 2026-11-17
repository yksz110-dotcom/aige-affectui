"use client";

import { useMemo, useState, type ReactNode } from "react";

/*
 * Breakdown Chart – Clean style (.ui-bcc, affectUI Pro specification).
 * Interactive measure, slice and segment pickers with horizontal stacked bars,
 * toggleable legend chips, and a synchronized summary table.
 */

export type BreakdownRecord = Record<string, string | number | boolean | null | undefined>;

export type BreakdownDimension = {
  key: string;
  label: string;
  values: string[];
  colors?: Record<string, string>;
  icons?: Record<string, ReactNode>;
};

export type BreakdownMeasure = {
  key: string;
  label: string;
  unit?: string;
  field?: string;
  /** Default "sum" when field exists; set "avg" or "max" for rate/ratio metrics */
  aggregate?: "sum" | "avg" | "max";
  format?: (n: number) => string;
};

export type BreakdownChartProps = {
  records: BreakdownRecord[];
  dimensions: BreakdownDimension[];
  measures: BreakdownMeasure[];
  title?: ReactNode;
  defaultMeasure?: string;
  defaultSlice?: string;
  defaultSegment?: string;
  action?: ReactNode;
  onSelectSlice?: (sliceValue: string) => void;
  showTable?: boolean;
  maxRows?: number;
  className?: string;
};

const PALETTE = ["#0070f3", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b"];

function aggregateValue(recs: BreakdownRecord[], measure: BreakdownMeasure): number {
  if (!measure.field) return recs.length;
  const nums = recs
    .map((r) => r[measure.field!])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return 0;
  if (measure.aggregate === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (measure.aggregate === "max") return Math.max(...nums);
  return nums.reduce((a, b) => a + b, 0);
}

export function BreakdownChart({
  records,
  dimensions,
  measures,
  title = "Breakdown",
  defaultMeasure,
  defaultSlice,
  defaultSegment,
  action,
  onSelectSlice,
  showTable = false,
  maxRows = 10,
  className,
}: BreakdownChartProps) {
  const [measureKey, setMeasureKey] = useState(defaultMeasure ?? measures[0]?.key ?? "");
  const [sliceKey, setSliceKey] = useState(defaultSlice ?? dimensions[0]?.key ?? "");
  const [segmentKey, setSegmentKey] = useState<string>(
    defaultSegment ?? (dimensions.length > 1 ? dimensions[1].key : "none"),
  );
  const [hiddenSegments, setHiddenSegments] = useState<Set<string>>(() => new Set());
  const [hoverSlice, setHoverSlice] = useState<string | null>(null);

  const measure = measures.find((m) => m.key === measureKey) ?? measures[0];
  const sliceDim = dimensions.find((d) => d.key === sliceKey) ?? dimensions[0];
  const segmentDim =
    segmentKey === "none" ? null : dimensions.find((d) => d.key === segmentKey && d.key !== sliceDim?.key) ?? null;

  const fmtVal = (v: number) => {
    if (measure?.format) return measure.format(v);
    const rounded = Math.abs(v % 1) > 0.005 ? v.toFixed(1) : String(Math.round(v));
    return measure?.unit ? `${rounded}${measure.unit}` : rounded;
  };

  const segmentValues = useMemo(() => {
    if (!segmentDim) return ["total"];
    return segmentDim.values;
  }, [segmentDim]);

  const rows = useMemo(() => {
    if (!sliceDim || !measure) return [];
    const sliceOrder =
      sliceDim.values.length > 0
        ? sliceDim.values
        : Array.from(new Set(records.map((r) => String(r[sliceDim.key] ?? "其他"))));

    return sliceOrder
      .map((sliceVal) => {
        const sliceRecs = records.filter((r) => String(r[sliceDim.key] ?? "") === sliceVal);
        const parts = segmentValues.map((segVal, idx) => {
          if (hiddenSegments.has(segVal)) {
            return { segVal, value: 0, color: segmentDim?.colors?.[segVal] ?? PALETTE[idx % PALETTE.length] };
          }
          const subRecs = segmentDim
            ? sliceRecs.filter((r) => String(r[segmentDim.key] ?? "") === segVal)
            : sliceRecs;
          const color = segmentDim?.colors?.[segVal] ?? sliceDim.colors?.[sliceVal] ?? PALETTE[idx % PALETTE.length];
          return {
            segVal,
            value: subRecs.length > 0 ? aggregateValue(subRecs, measure) : 0,
            color,
          };
        });
        const activeParts = parts.filter((p) => p.value > 0);
        const rowTotal =
          measure.aggregate === "avg" && activeParts.length > 0
            ? activeParts.reduce((a, b) => a + b.value, 0) / activeParts.length
            : parts.reduce((a, b) => a + b.value, 0);

        return { sliceVal, parts, total: rowTotal, count: sliceRecs.length };
      })
      .filter((r) => r.count > 0 || r.total > 0)
      .slice(0, maxRows);
  }, [records, sliceDim, segmentDim, measure, segmentValues, hiddenSegments, maxRows]);

  const maxRowTotal = useMemo(
    () => Math.max(1e-6, ...rows.map((r) => r.total)),
    [rows],
  );

  const toggleSegment = (segVal: string) => {
    setHiddenSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segVal)) next.delete(segVal);
      else if (next.size < segmentValues.length - 1) next.add(segVal);
      return next;
    });
  };

  return (
    <>
      <style href="ui-breakdown-chart-clean" precedence="default">
        {css}
      </style>
      <section className={["ui-bcc", className].filter(Boolean).join(" ")} aria-label={typeof title === "string" ? title : "Breakdown Chart"}>
        <header className="ui-bcc__head">
          <div className="ui-bcc__title-row">
            <h3 className="ui-bcc__title">{title}</h3>
            {action}
          </div>

          <div className="ui-bcc__controls">
            {measures.length > 1 && (
              <div className="ui-bcc__pills" role="group" aria-label="度量指标">
                {measures.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    aria-pressed={m.key === measure?.key}
                    data-active={m.key === measure?.key || undefined}
                    className="ui-bcc__pill"
                    onClick={() => setMeasureKey(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            {dimensions.length > 1 && (
              <div className="ui-bcc__selects">
                <label className="ui-bcc__label">
                  <span>维度</span>
                  <select
                    aria-label="分组维度"
                    className="ui-bcc__select"
                    value={sliceDim?.key}
                    onChange={(e) => setSliceKey(e.target.value)}
                  >
                    {dimensions.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="ui-bcc__label">
                  <span>分段</span>
                  <select
                    aria-label="分段维度"
                    className="ui-bcc__select"
                    value={segmentDim ? segmentDim.key : "none"}
                    onChange={(e) => {
                      setHiddenSegments(new Set());
                      setSegmentKey(e.target.value);
                    }}
                  >
                    <option value="none">不拆分</option>
                    {dimensions
                      .filter((d) => d.key !== sliceDim?.key)
                      .map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.label}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        </header>

        {/* Horizontal Bars */}
        <div className="ui-bcc__bars">
          {rows.map((row) => {
            const dim = hoverSlice !== null && hoverSlice !== row.sliceVal;
            const barWidthPct = Math.max(2, (row.total / maxRowTotal) * 100);
            return (
              <button
                key={row.sliceVal}
                type="button"
                className="ui-bcc__bar-row"
                data-dim={dim || undefined}
                data-hover={hoverSlice === row.sliceVal || undefined}
                onPointerEnter={() => setHoverSlice(row.sliceVal)}
                onPointerLeave={() => setHoverSlice(null)}
                onFocus={() => setHoverSlice(row.sliceVal)}
                onBlur={() => setHoverSlice(null)}
                onClick={() => onSelectSlice?.(row.sliceVal)}
              >
                <span className="ui-bcc__slice-name" title={row.sliceVal}>
                  {row.sliceVal}
                </span>
                <span className="ui-bcc__track" aria-hidden="true">
                  <span className="ui-bcc__fill" style={{ width: `${barWidthPct}%` }}>
                    {row.parts.map((part) => {
                      if (part.value <= 0 || row.total <= 0) return null;
                      const partPct = (part.value / row.total) * 100;
                      return (
                        <span
                          key={part.segVal}
                          className="ui-bcc__part"
                          style={{ width: `${partPct}%`, background: part.color }}
                        />
                      );
                    })}
                  </span>
                </span>
                <span className="ui-bcc__val">{fmtVal(row.total)}</span>
              </button>
            );
          })}
        </div>

        {/* Toggleable Legend when segmented */}
        {segmentDim && (
          <div className="ui-bcc__legend">
            {segmentValues.map((segVal, idx) => {
              const hidden = hiddenSegments.has(segVal);
              const color = segmentDim.colors?.[segVal] ?? PALETTE[idx % PALETTE.length];
              return (
                <button
                  key={segVal}
                  type="button"
                  aria-pressed={!hidden}
                  data-off={hidden || undefined}
                  className="ui-bcc__leg-btn"
                  onClick={() => toggleSegment(segVal)}
                >
                  <span className="ui-bcc__dot" style={{ background: color }} aria-hidden="true" />
                  <span>{segVal}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Linked Summary Table synced with hovered bar */}
        {showTable && rows.length > 0 && (
          <div className="ui-bcc__table-wrap">
            <table className="ui-bcc__table">
              <thead>
                <tr>
                  <th>{sliceDim?.label}</th>
                  {segmentDim &&
                    segmentValues
                      .filter((s) => !hiddenSegments.has(s))
                      .map((s) => <th key={s}>{s}</th>)}
                  <th>{measure?.label}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.sliceVal}
                    data-hover={hoverSlice === row.sliceVal || undefined}
                    onPointerEnter={() => setHoverSlice(row.sliceVal)}
                    onPointerLeave={() => setHoverSlice(null)}
                  >
                    <td>{row.sliceVal}</td>
                    {segmentDim &&
                      row.parts
                        .filter((p) => !hiddenSegments.has(p.segVal))
                        .map((p) => (
                          <td key={p.segVal}>{p.value > 0 ? fmtVal(p.value) : "—"}</td>
                        ))}
                    <td>
                      <strong>{fmtVal(row.total)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

const css = /* css */ `
.ui-bcc {
  --ui-bcc-surface: var(--aui-surface, #ffffff);
  --ui-bcc-strong: var(--aui-ink, #09090b);
  --ui-bcc-ink: var(--aui-ink, rgba(0, 0, 0, 0.88));
  --ui-bcc-muted: var(--aui-muted, rgba(0, 0, 0, 0.56));
  --ui-bcc-line: var(--aui-border, rgba(0, 0, 0, 0.075));
  --ui-bcc-track: var(--aui-subtle, rgba(0, 0, 0, 0.055));
  --ui-bcc-shadow: var(--aui-shadow-card, 0 0 0 0.5px rgba(0, 0, 0, 0.07), 0 1px 2px rgba(0, 0, 0, 0.04));
  --ui-bcc-radius: var(--aui-radius-lg, 12px);
  --ui-bcc-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));

  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  padding: 20px 22px;
  border-radius: var(--ui-bcc-radius);
  background: var(--ui-bcc-surface);
  box-shadow: var(--ui-bcc-shadow);
  color: var(--ui-bcc-ink);
  font-family: var(--aui-font, -apple-system, BlinkMacSystemFont, "PingFang SC", "Inter", sans-serif);
}

:where(.dark, [data-theme="dark"]) .ui-bcc {
  --ui-bcc-surface: var(--aui-surface, #18181b);
  --ui-bcc-strong: var(--aui-ink, #fafafa);
  --ui-bcc-ink: var(--aui-ink, rgba(255, 255, 255, 0.9));
  --ui-bcc-muted: var(--aui-muted, rgba(255, 255, 255, 0.58));
  --ui-bcc-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-bcc-track: rgba(255, 255, 255, 0.06);
  --ui-bcc-shadow: var(--aui-shadow-card, 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 4px 16px rgba(0, 0, 0, 0.4));
}

.ui-bcc__head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ui-bcc__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ui-bcc__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-bcc-strong);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ui-bcc__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ui-bcc__pills {
  display: inline-flex;
  flex-wrap: wrap;
  padding: 2px;
  border-radius: 7px;
  background: var(--ui-bcc-track);
  gap: 2px;
}

.ui-bcc__pill {
  padding: 3px 8px;
  border-radius: 5px;
  border: 0;
  background: transparent;
  color: var(--ui-bcc-muted);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}
.ui-bcc__pill:focus-visible,
.ui-bcc__bar-row:focus-visible,
.ui-bcc__leg-btn:focus-visible,
.ui-bcc__select:focus-visible {
  outline: 2px solid var(--aui-focus, rgba(0, 112, 243, 0.65));
  outline-offset: 2px;
}
.ui-bcc__pill[data-active="true"] {
  background: var(--ui-bcc-surface);
  color: var(--ui-bcc-strong);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.ui-bcc__selects {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ui-bcc__label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--ui-bcc-muted);
}

.ui-bcc__select {
  height: 24px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--ui-bcc-line);
  background: var(--ui-bcc-surface);
  color: var(--ui-bcc-strong);
  font-size: 11px;
}

.ui-bcc__bars {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.ui-bcc__bar-row {
  display: grid;
  grid-template-columns: 92px 1fr 72px;
  align-items: center;
  gap: 10px;
  padding: 3px 4px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: opacity 140ms ease, background-color 140ms ease;
}

.ui-bcc__bar-row[data-dim="true"] {
  opacity: 0.42;
}
.ui-bcc__bar-row[data-hover="true"] {
  background: var(--ui-bcc-track);
}

.ui-bcc__slice-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--ui-bcc-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-bcc__track {
  position: relative;
  height: 16px;
  border-radius: 4px;
  background: var(--ui-bcc-track);
  overflow: hidden;
}

.ui-bcc__fill {
  display: flex;
  height: 100%;
  border-radius: 4px;
  overflow: hidden;
  transition: width 360ms var(--ui-bcc-ease);
}

.ui-bcc__part {
  height: 100%;
  transition: width 300ms var(--ui-bcc-ease);
}

.ui-bcc__val {
  text-align: right;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-bcc-strong);
  font-variant-numeric: tabular-nums;
}

.ui-bcc__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--ui-bcc-line);
}

.ui-bcc__leg-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 11px;
  color: var(--ui-bcc-muted);
  cursor: pointer;
}
.ui-bcc__leg-btn[data-off="true"] {
  opacity: 0.4;
  text-decoration: line-through;
}

.ui-bcc__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
}

.ui-bcc__table-wrap {
  overflow-x: auto;
  border-top: 1px solid var(--ui-bcc-line);
  padding-top: 8px;
}

.ui-bcc__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.ui-bcc__table th {
  text-align: right;
  font-weight: 500;
  color: var(--ui-bcc-muted);
  padding: 4px 6px;
}

.ui-bcc__table th:first-child,
.ui-bcc__table td:first-child {
  text-align: left;
}

.ui-bcc__table td {
  text-align: right;
  padding: 5px 6px;
  color: var(--ui-bcc-ink);
  border-top: 1px solid var(--ui-bcc-line);
}

.ui-bcc__table tbody tr[data-hover="true"] {
  background: var(--ui-bcc-track);
}
`;
