"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimelinePoint } from "@/lib/types";
import { EmptyState, number } from "./ui";

export function TimelineChart({ points }: { points: TimelinePoint[] }) {
  const data = useMemo(() => {
    const buckets = new Map<
      string,
      { month: string; added: number; removed: number; commits: number }
    >();
    for (const point of points) {
      const date = new Date(point.day * 1000);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      const row = buckets.get(key) || {
        month: key,
        added: 0,
        removed: 0,
        commits: 0,
      };
      row.added += point.added;
      row.removed += point.removed;
      row.commits += point.commits;
      buckets.set(key, row);
    }
    return [...buckets.values()];
  }, [points]);

  return (
    <section className="panel timeline-panel">
      <div className="panel-heading">
        <div>
          <h2>Change over time</h2>
          <p className="muted">
            Monthly added and removed lines in the current commit set and scope.
          </p>
        </div>
        <span className="eyebrow">COMMITTER DATE</span>
      </div>
      {!data.length ? (
        <EmptyState title="No timeline data">
          <p>No measurable text changes exist for this selection.</p>
        </EmptyState>
      ) : (
        <div
          className="chart-wrap"
          aria-label="Monthly line additions and removals chart"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 18, left: 0, bottom: 4 }}
            >
              <defs>
                <linearGradient id="addedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#9dd6b8" stopOpacity={0.42} />
                  <stop offset="1" stopColor="#9dd6b8" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="removedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#e78ca3" stopOpacity={0.32} />
                  <stop offset="1" stopColor="#e78ca3" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="#2a2e3d"
                strokeDasharray="3 4"
                vertical={false}
              />
              <XAxis
                dataKey="month"
                stroke="#8e96aa"
                tickLine={false}
                axisLine={false}
                minTickGap={34}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                stroke="#8e96aa"
                tickLine={false}
                axisLine={false}
                width={45}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) =>
                  Intl.NumberFormat("en-US", { notation: "compact" }).format(v)
                }
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="added"
                name="Added"
                stroke="#9dd6b8"
                fill="url(#addedFill)"
                strokeWidth={1.7}
              />
              <Area
                type="monotone"
                dataKey="removed"
                name="Removed"
                stroke="#e78ca3"
                fill="url(#removedFill)"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    payload: { commits: number };
  }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={item.name} style={{ color: item.color }}>
          {item.name}: {number(item.value)}
        </span>
      ))}
      <small>
        {number(payload[0].payload.commits)} commits with measured changes
      </small>
    </div>
  );
}
