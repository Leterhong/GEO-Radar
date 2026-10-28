"use client";

import { EmptyState } from "@/components/shared/kpi-card";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { formatPercent } from "@/lib/utils";

export function OverviewTrendChart({
  data,
}: {
  data: Array<{ date: string; appearanceRate: number | null; validSamples: number }>;
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-[15px] font-semibold">品牌出现趋势</h3>
        <EmptyState
          title="暂无趋势数据"
          description="趋势图只使用数据库中的真实历史记录，不会生成虚构曲线。执行多次搜索任务后，这里会出现逐日变化。"
          className="mt-4 border-none py-8"
        />
      </div>
    );
  }
  const chartData = data.map((d) => ({ ...d, rate: d.appearanceRate === null ? null : Number((d.appearanceRate * 100).toFixed(1)) }));
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">品牌出现趋势</h3>
        <span className="text-[11px] text-quaternary">仅展示有真实数据的日期</span>
      </div>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="#EAEFF6" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#98A2B3" }} stroke="#E6EAF0" tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: "#98A2B3" }}
              stroke="#E6EAF0"
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              contentStyle={{ background: "#FFFFFF", border: "1px solid #E6EAF0", borderRadius: 10, fontSize: 12, boxShadow: "0 8px 24px -12px rgba(16,24,40,0.18)", color: "#172033" }}
              formatter={(value) => [`${value}%`, "品牌出现率"]}
              labelFormatter={(label) => {
                const point = chartData.find((d) => d.date === label);
                return point ? `${label}（样本 ${point.validSamples}）` : String(label);
              }}
            />
            <Line type="monotone" dataKey="rate" stroke="var(--chart-1)" strokeWidth={2.2} dot={{ r: 3, fill: "#4677E8", strokeWidth: 0 }} activeDot={{ r: 4.5 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-quaternary">
        口径：当日有效已完成问题中品牌被确认出现的比例；样本不足的日期不会显示数据点。当前展示为 {formatPercent(chartData[chartData.length - 1]?.appearanceRate ?? null)}（最新一天）。
      </p>
    </div>
  );
}
