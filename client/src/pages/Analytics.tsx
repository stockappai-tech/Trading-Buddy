import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { BarChart3, Crown, Lock, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PieChart,
  Pie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocation } from "wouter";

type Period = "1W" | "1M" | "3M" | "6M" | "1Y";

function getPeriodDates(period: Period) {
  const to = new Date();
  const from = new Date();
  if (period === "1W") from.setDate(from.getDate() - 7);
  else if (period === "1M") from.setMonth(from.getMonth() - 1);
  else if (period === "3M") from.setMonth(from.getMonth() - 3);
  else if (period === "6M") from.setMonth(from.getMonth() - 6);
  else from.setFullYear(from.getFullYear() - 1);
  return { from, to };
}

const PROFIT_COLOR = "oklch(0.65 0.18 160)";
const LOSS_COLOR = "oklch(0.60 0.22 25)";

export default function Analytics() {
  const [period, setPeriod] = useState<Period>("1M");
  const [, navigate] = useLocation();
  const { from, to } = useMemo(() => getPeriodDates(period), [period]);

  const { data: prefs } = trpc.preferences.get.useQuery();
  const { data: summary } = trpc.analytics.summary.useQuery({ from, to });
  const { data: symbolData } = trpc.analytics.symbolPerformance.useQuery({ from, to });
  const { data: timeData } = trpc.analytics.timeOfDay.useQuery({ from, to });
  const { data: pnlData } = trpc.analytics.pnlByPeriod.useQuery({ from, to });
  const [accountSize, setAccountSize] = useState("10000");
  const [riskTolerance, setRiskTolerance] = useState<"conservative" | "moderate" | "aggressive">("moderate");

  useEffect(() => {
    if (prefs?.accountSize) {
      setAccountSize(prefs.accountSize);
    }
  }, [prefs?.accountSize]);

  const { data: sizingData } = trpc.analytics.positionSizing.useQuery(
    { accountSize, riskTolerance },
    { enabled: Boolean(accountSize) }
  );
  const { data: heatmapData } = trpc.analytics.portfolioHeatMap.useQuery();
  const { data: stressData } = trpc.analytics.stressTest.useQuery(
    { accountSize, simulations: 500, tradesToSimulate: 50, from, to },
    { enabled: Boolean(from && to) }
  );
  const { data: correlationData } = trpc.analytics.correlationMatrix.useQuery({ from, to });

  const isPremium = prefs?.isPremium || false;

  // Win/Loss pie data
  const winLossData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: "Wins", value: summary.winCount, color: PROFIT_COLOR },
      { name: "Losses", value: summary.lossCount, color: LOSS_COLOR },
    ].filter((d) => d.value > 0);
  }, [summary]);

  // Symbol bar data
  const symbolBarData = useMemo(() => {
    if (!symbolData) return [];
    return symbolData.slice(0, 10).map((s) => ({
      symbol: s.symbol,
      pnl: Number(s.totalPnl ?? 0),
      trades: Number(s.tradeCount ?? 0),
    }));
  }, [symbolData]);

  // Time of day data
  const timeBarData = useMemo(() => {
    if (!timeData) return [];
    return timeData.map((t) => ({
      hour: `${String(t.hour).padStart(2, "0")}:00`,
      pnl: Number(t.totalPnl ?? 0),
      trades: Number(t.tradeCount ?? 0),
    }));
  }, [timeData]);

  // Daily PnL bar
  const dailyBarData = useMemo(() => {
    if (!pnlData) return [];
    return pnlData.slice(-30).map((d) => ({
      date: d.date,
      pnl: Number(d.totalPnl ?? 0),
    }));
  }, [pnlData]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
            <p className="text-sm text-muted-foreground">Deep dive into your trading performance</p>
          </div>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-24 h-8 text-xs bg-card border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {(["1W", "1M", "3M", "6M", "1Y"] as Period[]).map((p) => (
                <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total P&L", value: `${(summary?.totalPnl ?? 0) >= 0 ? "+" : ""}$${Math.abs(summary?.totalPnl ?? 0).toFixed(2)}`, positive: (summary?.totalPnl ?? 0) >= 0 },
            { label: "Win Rate", value: `${(summary?.winRate ?? 0).toFixed(1)}%`, positive: (summary?.winRate ?? 0) >= 50 },
            { label: "Profit Factor", value: (summary?.profitFactor ?? 0).toFixed(2), positive: (summary?.profitFactor ?? 0) >= 1 },
            { label: "Trades", value: String(summary?.tradeCount ?? 0), positive: true },
          ].map((stat) => (
            <Card key={stat.label} className="bg-card border-border">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
                <p className={`text-xl font-bold ${stat.positive ? "text-[oklch(0.65_0.18_160)]" : "text-destructive"}`}>{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Win/Loss Ratio */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Win / Loss Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {winLossData.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No closed trades</div>
              ) : (
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width={140} height={140}>
                    <PieChart>
                      <Pie data={winLossData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" strokeWidth={0}>
                        {winLossData.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: PROFIT_COLOR }} />
                      <div>
                        <p className="text-xs text-muted-foreground">Wins</p>
                        <p className="font-bold text-[oklch(0.65_0.18_160)]">{summary?.winCount ?? 0} ({(summary?.winRate ?? 0).toFixed(1)}%)</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: LOSS_COLOR }} />
                      <div>
                        <p className="text-xs text-muted-foreground">Losses</p>
                        <p className="font-bold text-destructive">{summary?.lossCount ?? 0} ({(100 - (summary?.winRate ?? 0)).toFixed(1)}%)</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Avg Win</p>
                      <p className="text-sm font-bold text-[oklch(0.65_0.18_160)]">+${(summary?.avgWin ?? 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Avg Loss</p>
                      <p className="text-sm font-bold text-destructive">${(summary?.avgLoss ?? 0).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Daily P&L */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Daily P&L</CardTitle>
            </CardHeader>
            <CardContent>
              {dailyBarData.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={dailyBarData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.01 240)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "oklch(0.55 0.01 240)" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: "oklch(0.55 0.01 240)" }} tickLine={false} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "oklch(0.15 0.01 240)", border: "1px solid oklch(0.22 0.01 240)", borderRadius: "6px", fontSize: "11px" }}
                      formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]}
                    />
                    <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                      {dailyBarData.map((entry, index) => (
                        <Cell key={index} fill={entry.pnl >= 0 ? PROFIT_COLOR : LOSS_COLOR} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Symbol Performance */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Symbol Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {symbolBarData.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={symbolBarData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.01 240)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "oklch(0.55 0.01 240)" }} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="symbol" tick={{ fontSize: 10, fill: "oklch(0.92 0.01 240)", fontWeight: 600 }} tickLine={false} width={50} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "oklch(0.15 0.01 240)", border: "1px solid oklch(0.22 0.01 240)", borderRadius: "6px", fontSize: "11px" }}
                    formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]}
                  />
                  <Bar dataKey="pnl" radius={[0, 2, 2, 0]}>
                    {symbolBarData.map((entry, index) => (
                      <Cell key={index} fill={entry.pnl >= 0 ? PROFIT_COLOR : LOSS_COLOR} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Dynamic Position Sizing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="accountSize">Account Size</Label>
                  <Input
                    id="accountSize"
                    value={accountSize}
                    onChange={(event) => setAccountSize(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="riskTolerance">Risk Tolerance</Label>
                  <Select value={riskTolerance} onValueChange={(value: any) => setRiskTolerance(value)}>
                    <SelectTrigger id="riskTolerance">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="conservative">Conservative</SelectItem>
                      <SelectItem value="moderate">Moderate</SelectItem>
                      <SelectItem value="aggressive">Aggressive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Kelly Metrics</Label>
                  <div className="rounded-lg border border-border p-3 bg-card">
                    <p className="text-xs text-muted-foreground">Kelly</p>
                    <p className="text-xl font-semibold">{sizingData?.kelly ?? "--"}%</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-border p-4 bg-card">
                  <p className="text-xs text-muted-foreground">Optimal f</p>
                  <p className="text-2xl font-bold">{sizingData?.optimalF ?? "--"}%</p>
                </div>
                <div className="rounded-lg border border-border p-4 bg-card">
                  <p className="text-xs text-muted-foreground">Suggested risk</p>
                  <p className="text-2xl font-bold">{sizingData?.suggestedRiskPercent ?? "--"}%</p>
                  <p className="text-sm text-muted-foreground">${sizingData?.suggestedRiskAmount ?? "--"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Portfolio Heat Map</CardTitle>
            </CardHeader>
            <CardContent>
              {heatmapData?.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={heatmapData.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.01 240)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: "oklch(0.55 0.01 240)" }} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="symbol" tick={{ fontSize: 10, fill: "oklch(0.92 0.01 240)", fontWeight: 600 }} width={70} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "oklch(0.15 0.01 240)", border: "1px solid oklch(0.22 0.01 240)", borderRadius: "6px", fontSize: "11px" }}
                      formatter={(value: number) => [`${value}%`, "Exposure"]}
                    />
                    <Bar dataKey="weight" radius={[0, 2, 2, 0]} fill="#38bdf8" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No open positions found</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Stress Testing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {stressData ? (
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg border border-border p-4 bg-card">
                      <p className="text-xs text-muted-foreground">Median outcome</p>
                      <p className="text-xl font-semibold">${stressData.medianFinalValue}</p>
                    </div>
                    <div className="rounded-lg border border-border p-4 bg-card">
                      <p className="text-xs text-muted-foreground">90th percentile</p>
                      <p className="text-xl font-semibold">${stressData.p90}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg border border-border p-4 bg-card">
                      <p className="text-xs text-muted-foreground">10th percentile</p>
                      <p className="text-xl font-semibold">${stressData.p10}</p>
                    </div>
                    <div className="rounded-lg border border-border p-4 bg-card">
                      <p className="text-xs text-muted-foreground">Average outcome</p>
                      <p className="text-xl font-semibold">${stressData.averageFinalValue}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-4 bg-card text-sm text-muted-foreground">
                    Monte Carlo uses your recent trade returns to simulate future portfolio scenarios.
                  </div>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Loading stress test...</div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Correlation Matrix</CardTitle>
            </CardHeader>
            <CardContent>
              {correlationData?.symbols?.length ? (
                <div className="overflow-auto rounded-lg border border-border">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-muted text-muted-foreground text-xs uppercase">
                      <tr>
                        <th className="px-3 py-2"></th>
                        {correlationData.symbols.map((symbol) => (
                          <th key={symbol} className="px-3 py-2">{symbol}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {correlationData.matrix.map((row) => (
                        <tr key={row.symbol} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-muted-foreground">{row.symbol}</td>
                          {row.correlations.map((value, index) => (
                            <td key={index} className="px-3 py-2">
                              <span className={value > 0.5 ? "text-emerald-500" : value < -0.5 ? "text-red-500" : "text-muted-foreground"}>
                                {value.toFixed(2)}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Not enough data for correlation analysis.</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Time of Day Performance */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Time of Day Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {timeBarData.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={timeBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.01 240)" />
                  <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "oklch(0.55 0.01 240)" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "oklch(0.55 0.01 240)" }} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "oklch(0.15 0.01 240)", border: "1px solid oklch(0.22 0.01 240)", borderRadius: "6px", fontSize: "11px" }}
                    formatter={(v: number, name: string) => [name === "pnl" ? `$${v.toFixed(2)}` : v, name === "pnl" ? "P&L" : "Trades"]}
                  />
                  <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                    {timeBarData.map((entry, index) => (
                      <Cell key={index} fill={entry.pnl >= 0 ? PROFIT_COLOR : LOSS_COLOR} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Premium Pattern Analysis */}
        {!isPremium && (
          <Card className="bg-card border-yellow-500/20 border">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center flex-shrink-0">
                <Lock className="h-6 w-6 text-yellow-500" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Crown className="h-4 w-4 text-yellow-500" />
                  <h3 className="font-semibold text-foreground">Advanced Pattern Analysis</h3>
                  <Badge className="text-xs bg-yellow-500/20 text-yellow-500 border-yellow-500/30">Pro</Badge>
                </div>
                <p className="text-sm text-muted-foreground">Unlock AI-powered pattern detection, correlation analysis, and personalized improvement recommendations.</p>
              </div>
              <Button onClick={() => navigate("/upgrade")} className="bg-yellow-500 text-black hover:bg-yellow-400 flex-shrink-0">
                Upgrade
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
