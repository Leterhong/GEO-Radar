"use client";

import { EmptyState } from "@/components/shared/kpi-card";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { formatPercent } from "@/lib/utils";

export function OverviewTrendChart({
  data,
  hasBrand = false,
}: {
  data: Array<{ date: string; appearanceRate: number | null; officialRate?: number | null; thirdPartyRate?: number | null; validSamples: number }>;
  hasBrand?: boolean;
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-[15px] font-semibold">品牌出现趋势</h3>
        <EmptyState
          title={hasBrand ? "暂无趋势数据" : "选择品牌后查看趋势"}
          description={
            hasBrand
              ? "趋势图只使用数据库中的真实历史记录，不会生成虚构曲线。至少完成两轮真实搜索后，这里会出现逐日变化。"
              : "当前为全部品牌视图，无法混合计算单品牌趋势。请在右上角选择一个品牌。"
          }
          className="mt-4 border-none py-8"
        />
      </div>
    );
  }
  const chartData = data.map((d) => ({
    ...d,
    rate: d.appearanceRate === null ? null : Number((d.appearanceRate * 100).toFixed(1)),
    official: d.officialRate === null || d.officialRate === undefined ? null : Number((d.officialRate * 100).toFixed(1)),
    thirdParty: d.thirdPartyRate === null || d.thirdPartyRate === undefined ? null : Number((d.thirdPartyRate * 100).toFixed(1)),
  }));
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
              formatter={(value, name) => [`${value}%`, name === "rate" ? "品牌出现率" : name === "official" ? "官网覆盖率" : "第三方覆盖率"]}
              labelFormatter={(label) => {
                const point = chartData.find((d) => d.date === label);
                return point ? `${label}（样本 ${point.validSamples}）` : String(label);
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="rate" name="品牌出现率" stroke="var(--chart-1)" strokeWidth={2.2} dot={{ r: 3, fill: "#4677E8", strokeWidth: 0 }} activeDot={{ r: 4.5 }} connectNulls={false} />
            <Line type="monotone" dataKey="official" name="官网覆盖率" stroke="var(--chart-2)" strokeWidth={1.8} dot={{ r: 2.5 }} connectNulls={false} />
            <Line type="monotone" dataKey="thirdParty" name="第三方覆盖率" stroke="var(--chart-3)" strokeWidth={1.8} dot={{ r: 2.5 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-quaternary">
        口径：当日有效已完成问题中品牌被确认出现的比例；样本不足的日期不会显示数据点。当前展示为 {formatPercent(chartData[chartData.length - 1]?.appearanceRate ?? null)}（最新一天）。
      </p>
    </div>
  );
}
