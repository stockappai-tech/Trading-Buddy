import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Brain,
  Calendar,
  ChevronRight,
  Flame,
  Mic,
  RefreshCw,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocation } from "wouter";

type Period = "1D" | "1W" | "1M" | "6M" | "1Y";

function getPeriodDates(period: Period): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  if (period === "1D") from.setDate(from.getDate() - 1);
  else if (period === "1W") from.setDate(from.getDate() - 7);
  else if (period === "1M") from.setMonth(from.getMonth() - 1);
  else if (period === "6M") from.setMonth(from.getMonth() - 6);
  else from.setFullYear(from.getFullYear() - 1);
  return { from, to };
}

function formatPnl(val: number) {
  const sign = val >= 0 ? "+" : "";
  return `${sign}$${Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>("1M");
  const [, navigate] = useLocation();
  const { from, to } = useMemo(() => getPeriodDates(period), [period]);

  const { data: summary, isLoading: summaryLoading } = trpc.analytics.summary.useQuery({ from, to });
  const { data: pnlData, isLoading: pnlLoading } = trpc.analytics.pnlByPeriod.useQuery({ from, to });
  const { data: openTrades } = trpc.trades.openTrades.useQuery();
  const { data: prefs } = trpc.preferences.get.useQuery();
  const { data: recentTrades } = trpc.trades.list.useQuery({ limit: 5 });
  const utils = trpc.useUtils();
  const fixOrphaned = trpc.trades.fixOrphaned.useMutation({
    onSuccess: (data) => {
      if (data.fixed > 0) {
        utils.trades.openTrades.invalidate();
        utils.analytics.summary.invalidate();
      }
    },
  });

  const deduplicateClosing = trpc.trades.deduplicateClosing.useMutation({
    onSuccess: (data) => {
      if (data.removed > 0) {
        utils.trades.list.invalidate();
        utils.analytics.summary.invalidate();
      }
    },
  });

  // On mount: (1) auto-fix orphaned open trades, (2) deduplicate any historical SELL/COVER duplicates
  useEffect(() => {
    fixOrphaned.mutate();
    deduplicateClosing.mutate();
  }, []);

  // Get symbols from open trades for live quotes
  const symbols = useMemo(() => {
    if (!openTrades || openTrades.length === 0) return "";
    const symbolSet = new Set(openTrades.map((t) => t.symbol));
    return Array.from(symbolSet).join(",");
  }, [openTrades]);

  const { data: quotes, refetch: refetchQuotes } = trpc.market.quotes.useQuery(
    { symbols },
    { enabled: !!symbols, refetchInterval: 30000 }
  );

  // Calculate cumulative PnL for chart
  const chartData = useMemo(() => {
    if (!pnlData) return [];
    let cumulative = 0;
    return pnlData.map((d) => {
      cumulative += Number(d.totalPnl ?? 0);
      return {
        date: d.date,
        daily: Number(d.totalPnl ?? 0),
        cumulative,
        trades: Number(d.tradeCount ?? 0),
      };
    });
  }, [pnlData]);

  // Live PnL from open positions
  const livePnl = useMemo(() => {
    if (!openTrades || !quotes) return 0;
    return openTrades.reduce((sum, trade) => {
      const quote = quotes.find((q: any) => q.symbol === trade.symbol);
      if (!quote) return sum;
      const qty = parseFloat(trade.quantity);
      const entry = parseFloat(trade.entryPrice);
      const current = quote.last;
      const pnl = trade.side === "short" ? (entry - current) * qty : (current - entry) * qty;
      return sum + pnl;
    }, 0);
  }, [openTrades, quotes]);

  const totalPnl = (summary?.totalPnl ?? 0) + livePnl;
  const isProfitable = totalPnl >= 0;

  // ─── Streak calculation (days with at least 1 closed trade) ───────────────
  const { data: allTrades } = trpc.trades.list.useQuery({});

  // ─── Weekly Report (last 7 days vs prior 7 days) ──────────────────────────
  const thisWeekFrom = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; }, []);
  const prevWeekFrom = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 14); return d; }, []);
  const prevWeekTo = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; }, []);
  const { data: thisWeekSummary } = trpc.analytics.summary.useQuery({ from: thisWeekFrom, to: new Date() });
  const { data: prevWeekSummary } = trpc.analytics.summary.useQuery({ from: prevWeekFrom, to: prevWeekTo });

  const weeklyReport = useMemo(() => {
    if (!thisWeekSummary) return null;
    const pnlDiff = thisWeekSummary.totalPnl - (prevWeekSummary?.totalPnl ?? 0);
    const winRateDiff = thisWeekSummary.winRate - (prevWeekSummary?.winRate ?? 0);
    const tradesDiff = thisWeekSummary.tradeCount - (prevWeekSummary?.tradeCount ?? 0);
    return { thisWeek: thisWeekSummary, prevWeek: prevWeekSummary, pnlDiff, winRateDiff, tradesDiff };
  }, [thisWeekSummary, prevWeekSummary]);

  // ─── Pattern Alerts (computed from time-of-day + symbol performance) ─────
  const sixMonthsAgo = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d; }, []);
  const { data: timeOfDayData } = trpc.analytics.timeOfDay.useQuery({ from: sixMonthsAgo, to: new Date() });
  const { data: symbolData } = trpc.analytics.symbolPerformance.useQuery({ from: sixMonthsAgo, to: new Date() });

  const patternAlerts = useMemo(() => {
    const alerts: { icon: string; message: string; severity: "warning" | "danger" }[] = [];
    if (timeOfDayData && timeOfDayData.length >= 3) {
      const badHours = timeOfDayData.filter((h: any) => {
        const trades = Number(h.tradeCount ?? 0);
        const winRate = trades > 0 ? (Number(h.winCount ?? 0) / trades) * 100 : 0;
        return trades >= 3 && winRate < 35;
      });
      if (badHours.length > 0) {
        const worst = badHours.sort((a: any, b: any) => Number(a.totalPnl ?? 0) - Number(b.totalPnl ?? 0))[0];
        const h = Number(worst.hour);
        const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
        alerts.push({ icon: '⏰', message: `You lose most often around ${label} — consider avoiding trades in that window.`, severity: 'warning' });
      }
    }
    if (symbolData && symbolData.length >= 2) {
      const badSymbols = (symbolData as any[]).filter((s: any) => {
        const trades = Number(s.tradeCount ?? 0);
        const pnl = Number(s.totalPnl ?? 0);
        return trades >= 3 && pnl < -200;
      });
      if (badSymbols.length > 0) {
        const worst = badSymbols.sort((a: any, b: any) => Number(a.totalPnl ?? 0) - Number(b.totalPnl ?? 0))[0];
        alerts.push({ icon: '📉', message: `${worst.symbol} is your biggest P&L drain (${formatPnl(Number(worst.totalPnl ?? 0))} over ${worst.tradeCount} trades). Review your edge on this ticker.`, severity: 'danger' });
      }
    }
    if (allTrades) {
      const recentLosses = allTrades.filter((t) => t.status === 'closed' && parseFloat(t.pnl ?? '0') < 0).slice(0, 5);
      if (recentLosses.length >= 3) {
        alerts.push({ icon: '🔁', message: `Your last ${recentLosses.length} closed trades were losses. Consider stepping back and reviewing your setup before the next trade.`, severity: 'danger' });
      }
    }
    return alerts;
  }, [timeOfDayData, symbolData, allTrades]);
  const streak = useMemo(() => {
    if (!allTrades || allTrades.length === 0) return 0;
    const closedDays = new Set(
      allTrades
        .filter((t) => t.status === "closed" && t.closedAt)
        .map((t) => new Date(t.closedAt!).toDateString())
    );
    let count = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      if (closedDays.has(d.toDateString())) count++;
      else if (i > 0) break; // gap breaks streak
    }
    return count;
  }, [allTrades]);

  // ─── Badges ───────────────────────────────────────────────────────────────
  const badges = useMemo(() => {
    const earned: { icon: React.ReactNode; label: string; color: string }[] = [];
    const total = summary?.tradeCount ?? 0;
    const winRate = summary?.winRate ?? 0;
    const pnl = summary?.totalPnl ?? 0;
    if (total >= 1)  earned.push({ icon: <Star className="h-3.5 w-3.5" />, label: "First Trade",     color: "text-yellow-500 border-yellow-500/30 bg-yellow-500/10" });
    if (total >= 10) earned.push({ icon: <BarChart3 className="h-3.5 w-3.5" />, label: "10 Trades",  color: "text-blue-400 border-blue-400/30 bg-blue-400/10" });
    if (total >= 50) earned.push({ icon: <Trophy className="h-3.5 w-3.5" />, label: "50 Trades",     color: "text-purple-400 border-purple-400/30 bg-purple-400/10" });
    if (streak >= 7) earned.push({ icon: <Flame className="h-3.5 w-3.5" />, label: "7-Day Streak",   color: "text-orange-500 border-orange-500/30 bg-orange-500/10" });
    if (winRate >= 60) earned.push({ icon: <TrendingUp className="h-3.5 w-3.5" />, label: "Sharp Shooter", color: "text-green-500 border-green-500/30 bg-green-500/10" });
    if (pnl > 0)     earned.push({ icon: <Sparkles className="h-3.5 w-3.5" />, label: "In the Green", color: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" });
    return earned;
  }, [summary, streak]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Your trading performance overview</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-primary live-dot" />
              Live
            </div>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-24 h-8 text-xs bg-card border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {(["1D", "1W", "1M", "6M", "1Y"] as Period[]).map((p) => (
                  <SelectItem key={p} value={p} className="text-xs">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => navigate("/record")} className="h-8 text-xs border-border">
              <Mic className="h-3 w-3 mr-1" /> Record
            </Button>
          </div>
        </div>

        {/* Streak + Badges Row */}
        {(streak > 0 || badges.length > 0) && (
          <div className="flex flex-wrap items-center gap-3">
            {streak > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-orange-500/30 bg-orange-500/10">
                <Flame className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-bold text-orange-500">{streak}</span>
                <span className="text-xs text-orange-400/80">day streak</span>
              </div>
            )}
            {badges.map((b) => (
              <div key={b.label} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${b.color}`}>
                {b.icon} {b.label}
              </div>
            ))}
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Total P&L</span>
                {isProfitable ? (
                  <TrendingUp className="h-4 w-4 text-[oklch(0.65_0.18_160)]" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-destructive" />
                )}
              </div>
              <p className={`text-2xl font-bold ${isProfitable ? "text-[oklch(0.65_0.18_160)]" : "text-destructive"}`}>
                {formatPnl(totalPnl)}
              </p>
              {livePnl !== 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Incl. {formatPnl(livePnl)} unrealized
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Win Rate</span>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold text-foreground">
                {summaryLoading ? "—" : `${(summary?.winRate ?? 0).toFixed(1)}%`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {summary?.winCount ?? 0}W / {summary?.lossCount ?? 0}L
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Profit Factor</span>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold text-foreground">
                {summaryLoading ? "—" : (summary?.profitFactor ?? 0).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{summary?.tradeCount ?? 0} trades</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Avg Win / Loss</span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-sm font-bold text-[oklch(0.65_0.18_160)]">
                {formatPnl(summary?.avgWin ?? 0)}
              </p>
              <p className="text-sm font-bold text-destructive">
                {formatPnl(summary?.avgLoss ?? 0)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* PnL Chart */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Cumulative P&L</CardTitle>
          </CardHeader>
          <CardContent>
            {pnlLoading ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">Loading chart...</div>
            ) : chartData.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-muted-foreground">
                <BarChart3 className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">No closed trades in this period</p>
                <Button size="sm" variant="outline" className="mt-3 text-xs border-border" onClick={() => navigate("/record")}>
                  Record your first session
                </Button>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.65 0.18 160)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="oklch(0.65 0.18 160)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.01 240)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "oklch(0.55 0.01 240)" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "oklch(0.55 0.01 240)" }} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "oklch(0.15 0.01 240)", border: "1px solid oklch(0.22 0.01 240)", borderRadius: "6px", fontSize: "12px" }}
                    labelStyle={{ color: "oklch(0.92 0.01 240)" }}
                    formatter={(value: number) => [formatPnl(value), "Cumulative P&L"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    stroke="oklch(0.65 0.18 160)"
                    strokeWidth={2}
                    fill="url(#pnlGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Open Positions */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground">Open Positions</CardTitle>
              {symbols && (
                <Button size="sm" variant="ghost" onClick={() => refetchQuotes()} className="h-6 w-6 p-0 text-muted-foreground">
                  <RefreshCw className="h-3 w-3" />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {!openTrades || openTrades.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No open positions</p>
              ) : (
                <div className="space-y-2">
                  {openTrades.map((trade) => {
                    const quote = quotes?.find((q: any) => q.symbol === trade.symbol);
                    const qty = parseFloat(trade.quantity);
                    const entry = parseFloat(trade.entryPrice);
                    const current = quote?.last ?? entry;
                    const unrealizedPnl = trade.side === "short" ? (entry - current) * qty : (current - entry) * qty;
                    const isProfit = unrealizedPnl >= 0;
                    return (
                      <div key={trade.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-xs ${trade.side === "buy" ? "border-[oklch(0.65_0.18_160)] text-[oklch(0.65_0.18_160)]" : "border-destructive text-destructive"}`}>
                            {trade.side.toUpperCase()}
                          </Badge>
                          <span className="font-mono font-bold text-sm">{trade.symbol}</span>
                          <span className="text-xs text-muted-foreground">{qty} @ ${entry.toFixed(2)}</span>
                        </div>
                        <div className="text-right">
                          {quote && <p className="text-xs text-muted-foreground">${current.toFixed(2)}</p>}
                          <p className={`text-sm font-bold ${isProfit ? "text-[oklch(0.65_0.18_160)]" : "text-destructive"}`}>
                            {isProfit ? "+" : ""}{unrealizedPnl.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Trades */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground">Recent Trades</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => navigate("/history")} className="text-xs text-muted-foreground h-6">
                View all
              </Button>
            </CardHeader>
            <CardContent>
              {!recentTrades || recentTrades.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No trades yet</p>
              ) : (
                <div className="space-y-2">
                  {recentTrades.map((trade) => {
                    const pnl = parseFloat(trade.pnl ?? "0");
                    const isProfit = pnl >= 0;
                    return (
                      <div key={trade.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-xs ${trade.side === "buy" || trade.side === "cover" ? "border-[oklch(0.65_0.18_160)] text-[oklch(0.65_0.18_160)]" : "border-destructive text-destructive"}`}>
                            {trade.side.toUpperCase()}
                          </Badge>
                          <span className="font-mono font-bold text-sm">{trade.symbol}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-xs ${trade.status === "open" ? "border-yellow-500/50 text-yellow-500" : "border-border text-muted-foreground"}`}>
                            {trade.status}
                          </Badge>
                          {trade.status === "closed" && (
                            <span className={`text-sm font-bold ${isProfit ? "text-[oklch(0.65_0.18_160)]" : "text-destructive"}`}>
                              {isProfit ? "+" : ""}{pnl.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Weekly Performance Report */}
        {weeklyReport && weeklyReport.thisWeek.tradeCount > 0 && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  This Week's Report
                </CardTitle>
                <Button size="sm" variant="ghost" onClick={() => navigate("/analytics")} className="text-xs text-muted-foreground h-6 gap-1">
                  Full Analytics <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-2 rounded-md bg-secondary/50">
                  <p className="text-xs text-muted-foreground mb-1">P&L</p>
                  <p className={`text-sm font-bold ${weeklyReport.thisWeek.totalPnl >= 0 ? 'text-[oklch(0.65_0.18_160)]' : 'text-destructive'}`}>
                    {formatPnl(weeklyReport.thisWeek.totalPnl)}
                  </p>
                  {weeklyReport.prevWeek && (
                    <p className={`text-xs mt-0.5 ${weeklyReport.pnlDiff >= 0 ? 'text-[oklch(0.65_0.18_160)]' : 'text-destructive'}`}>
                      {weeklyReport.pnlDiff >= 0 ? '▲' : '▼'} vs last week
                    </p>
                  )}
                </div>
                <div className="text-center p-2 rounded-md bg-secondary/50">
                  <p className="text-xs text-muted-foreground mb-1">Win Rate</p>
                  <p className="text-sm font-bold text-foreground">{weeklyReport.thisWeek.winRate.toFixed(0)}%</p>
                  {weeklyReport.prevWeek && (
                    <p className={`text-xs mt-0.5 ${weeklyReport.winRateDiff >= 0 ? 'text-[oklch(0.65_0.18_160)]' : 'text-destructive'}`}>
                      {weeklyReport.winRateDiff >= 0 ? '▲' : '▼'} {Math.abs(weeklyReport.winRateDiff).toFixed(0)}%
                    </p>
                  )}
                </div>
                <div className="text-center p-2 rounded-md bg-secondary/50">
                  <p className="text-xs text-muted-foreground mb-1">Trades</p>
                  <p className="text-sm font-bold text-foreground">{weeklyReport.thisWeek.tradeCount}</p>
                  {weeklyReport.prevWeek && (
                    <p className={`text-xs mt-0.5 ${weeklyReport.tradesDiff >= 0 ? 'text-[oklch(0.65_0.18_160)]' : 'text-muted-foreground'}`}>
                      {weeklyReport.tradesDiff >= 0 ? '+' : ''}{weeklyReport.tradesDiff} vs last week
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pattern Alerts */}
        {patternAlerts.length > 0 && (
          <Card className="bg-card border-yellow-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Behavioral Pattern Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {patternAlerts.map((alert, i) => (
                <div key={i} className={`flex items-start gap-2 p-2 rounded-md text-xs ${alert.severity === 'danger' ? 'bg-destructive/10 border border-destructive/20' : 'bg-yellow-500/10 border border-yellow-500/20'}`}>
                  <span className="text-base leading-none mt-0.5">{alert.icon}</span>
                  <p className={alert.severity === 'danger' ? 'text-destructive' : 'text-yellow-500'}>{alert.message}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Daily Pre-Market Briefing (Pro/Elite teaser) */}
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Brain className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-foreground">Daily Briefing</p>
                  <Badge className="text-xs bg-purple-500/20 text-purple-400 border-purple-500/30">Elite</Badge>
                </div>
                {prefs?.isPremium ? (
                  <p className="text-xs text-muted-foreground">
                    Your AI briefing will appear here each morning — market sentiment, your last 3 mistakes, and today's focus.
                    <span className="text-primary ml-1 cursor-pointer underline" onClick={() => navigate("/upgrade")}>Upgrade to Elite to unlock</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Get a personalized AI morning note with market context and your behavioral patterns.
                    <span className="text-primary ml-1 cursor-pointer underline" onClick={() => navigate("/upgrade")}>Upgrade to unlock</span>
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Best/Worst Trade */}
        {summary && (summary.bestTrade || summary.worstTrade) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {summary.bestTrade && (
              <Card className="bg-card border-[oklch(0.65_0.18_160)]/30">
                <CardContent className="p-4 flex items-center gap-3">
                  <ArrowUpRight className="h-8 w-8 text-[oklch(0.65_0.18_160)] flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Best Trade</p>
                    <p className="font-bold">{summary.bestTrade.symbol} <span className="text-[oklch(0.65_0.18_160)]">{formatPnl(parseFloat(summary.bestTrade.pnl ?? "0"))}</span></p>
                  </div>
                </CardContent>
              </Card>
            )}
            {summary.worstTrade && (
              <Card className="bg-card border-destructive/30">
                <CardContent className="p-4 flex items-center gap-3">
                  <ArrowDownRight className="h-8 w-8 text-destructive flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Worst Trade</p>
                    <p className="font-bold">{summary.worstTrade.symbol} <span className="text-destructive">{formatPnl(parseFloat(summary.worstTrade.pnl ?? "0"))}</span></p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
