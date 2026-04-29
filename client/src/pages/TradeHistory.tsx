import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { REALTIME_INTERVALS } from "@/lib/realtime";
import { trpc } from "@/lib/trpc";
import { format } from "date-fns";
import { Brain, Download, Filter, Plus, Search, Trash2, X } from "lucide-react";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";

type TradeFormData = {
  symbol: string;
  side: "buy" | "sell" | "short" | "cover";
  quantity: string;
  entryPrice: string;
  exitPrice: string;
  pnl: string;
  status: "open" | "closed";
  notes: string;
};

export default function TradeHistory() {
  const [search, setSearch] = useState("");
  const [filterSide, setFilterSide] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [scoringId, setScoringId] = useState<number | null>(null);
  const [expandedScore, setExpandedScore] = useState<number | null>(null);
  const [form, setForm] = useState<TradeFormData>({
    symbol: "", side: "buy", quantity: "", entryPrice: "", exitPrice: "", pnl: "", status: "open", notes: "",
  });

  const utils = trpc.useUtils();
  const { data: trades, isLoading } = trpc.trades.list.useQuery({ limit: 500 }, { refetchInterval: REALTIME_INTERVALS.dashboard });
  const quoteSymbol = form.symbol.trim().toUpperCase();
  const { data: liveQuoteData, refetch: refetchLiveQuote } = trpc.market.quotes.useQuery(
    { symbols: quoteSymbol },
    { enabled: showAddDialog && quoteSymbol.length > 0, refetchInterval: REALTIME_INTERVALS.quote }
  );
  const liveQuote = liveQuoteData?.[0];

  const createTrade = trpc.trades.create.useMutation({
    onSuccess: () => {
      utils.trades.list.invalidate();
      utils.analytics.summary.invalidate();
      setShowAddDialog(false);
      setForm({ symbol: "", side: "buy", quantity: "", entryPrice: "", exitPrice: "", pnl: "", status: "open", notes: "" });
      toast.success("Trade added successfully");
    },
    onError: (e) => toast.error(e.message),
  });

  const scoreDiscipline = trpc.trades.scoreDiscipline.useMutation({
    onSuccess: (data, vars) => {
      utils.trades.list.invalidate();
      setScoringId(null);
      setExpandedScore(vars.tradeId);
      toast.success(`Discipline score: ${data.score}/10`);
    },
    onError: (e) => { setScoringId(null); toast.error(e.message); },
  });

  const deleteTrade = trpc.trades.delete.useMutation({
    onSuccess: () => {
      utils.trades.list.invalidate();
      utils.analytics.summary.invalidate();
      toast.success("Trade deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    if (!trades) return [];
    return trades.filter((t) => {
      const matchSearch = !search || t.symbol.toLowerCase().includes(search.toLowerCase()) || (t.notes ?? "").toLowerCase().includes(search.toLowerCase());
      const matchSide = filterSide === "all" || t.side === filterSide;
      const matchStatus = filterStatus === "all" || t.status === filterStatus;
      return matchSearch && matchSide && matchStatus;
    });
  }, [trades, search, filterSide, filterStatus]);

  const totalPnl = useMemo(() => filtered.filter((t) => t.status === "closed").reduce((s, t) => s + parseFloat(t.pnl ?? "0"), 0), [filtered]);
  const winCount = useMemo(() => filtered.filter((t) => t.status === "closed" && parseFloat(t.pnl ?? "0") > 0).length, [filtered]);
  const closedCount = useMemo(() => filtered.filter((t) => t.status === "closed").length, [filtered]);

  const handleSubmit = () => {
    if (!form.symbol || !form.quantity || !form.entryPrice) {
      toast.error("Symbol, quantity, and entry price are required");
      return;
    }
    // Auto-calculate PnL if exit price provided
    let pnl = form.pnl;
    if (form.exitPrice && !form.pnl) {
      const qty = parseFloat(form.quantity);
      const entry = parseFloat(form.entryPrice);
      const exit = parseFloat(form.exitPrice);
      const calc = form.side === "short" ? (entry - exit) * qty : (exit - entry) * qty;
      pnl = calc.toFixed(2);
    }
    createTrade.mutate({ ...form, symbol: form.symbol.toUpperCase(), pnl: pnl || undefined, exitPrice: form.exitPrice || undefined });
  };

  const exportCsv = () => {
    const headers = ["Date", "Symbol", "Side", "Qty", "Entry", "Exit", "PnL", "Status", "Notes"];
    const rows = filtered.map((t) => [
      format(new Date(t.tradeDate), "yyyy-MM-dd HH:mm"),
      t.symbol, t.side, t.quantity, t.entryPrice, t.exitPrice ?? "", t.pnl ?? "", t.status, t.notes ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "trades.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Trade History</h1>
            <p className="text-sm text-muted-foreground">{filtered.length} trades · Win rate: {closedCount > 0 ? ((winCount / closedCount) * 100).toFixed(1) : 0}%</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv} className="h-8 text-xs border-border">
              <Download className="h-3 w-3 mr-1" /> Export CSV
            </Button>
            <Button size="sm" onClick={() => setShowAddDialog(true)} className="h-8 text-xs bg-primary text-primary-foreground">
              <Plus className="h-3 w-3 mr-1" /> Add Trade
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Total P&L</p>
              <p className={`text-xl font-bold ${totalPnl >= 0 ? "text-[oklch(0.65_0.18_160)]" : "text-destructive"}`}>
                {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Win Rate</p>
              <p className="text-xl font-bold text-foreground">
                {closedCount > 0 ? ((winCount / closedCount) * 100).toFixed(1) : 0}%
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Total Trades</p>
              <p className="text-xl font-bold text-foreground">{filtered.length}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search symbol or notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8 text-xs bg-card border-border"
            />
          </div>
          <Select value={filterSide} onValueChange={setFilterSide}>
            <SelectTrigger className="w-28 h-8 text-xs bg-card border-border">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">All Sides</SelectItem>
              <SelectItem value="buy">Buy</SelectItem>
              <SelectItem value="sell">Sell</SelectItem>
              <SelectItem value="short">Short</SelectItem>
              <SelectItem value="cover">Cover</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-28 h-8 text-xs bg-card border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          {(search || filterSide !== "all" || filterStatus !== "all") && (
            <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setFilterSide("all"); setFilterStatus("all"); }} className="h-8 text-xs text-muted-foreground">
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          )}
        </div>

        {/* Table */}
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading trades...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No trades found</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-xs text-muted-foreground">Date</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Symbol</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Side</TableHead>
                      <TableHead className="text-xs text-muted-foreground text-right">Qty</TableHead>
                      <TableHead className="text-xs text-muted-foreground text-right">Entry</TableHead>
                      <TableHead className="text-xs text-muted-foreground text-right">Exit</TableHead>
                      <TableHead className="text-xs text-muted-foreground text-right">P&L</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Notes</TableHead>
                      <TableHead className="text-xs text-muted-foreground">Discipline</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((trade) => {
                      const pnl = parseFloat(trade.pnl ?? "0");
                      const isProfit = pnl > 0;
                      return (
                        <React.Fragment key={`frag-${trade.id}`}>
                        <TableRow key={`row-${trade.id}`} className="border-border hover:bg-accent/30">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(trade.tradeDate), "MM/dd HH:mm")}
                          </TableCell>
                          <TableCell className="font-mono font-bold text-sm">{trade.symbol}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${trade.side === "buy" || trade.side === "cover" ? "border-[oklch(0.65_0.18_160)] text-[oklch(0.65_0.18_160)]" : "border-destructive text-destructive"}`}>
                              {trade.side.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm font-mono">{parseFloat(trade.quantity)}</TableCell>
                          <TableCell className="text-right text-sm font-mono">${parseFloat(trade.entryPrice).toFixed(2)}</TableCell>
                          <TableCell className="text-right text-sm font-mono text-muted-foreground">
                            {trade.exitPrice ? `$${parseFloat(trade.exitPrice).toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {trade.status === "closed" ? (
                              <span className={`text-sm font-bold ${isProfit ? "text-[oklch(0.65_0.18_160)]" : "text-destructive"}`}>
                                {isProfit ? "+" : ""}${Math.abs(pnl).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${trade.status === "open" ? "border-yellow-500/50 text-yellow-500" : "border-border text-muted-foreground"}`}>
                              {trade.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-32 truncate">{trade.notes ?? "—"}</TableCell>
                          <TableCell>
                            {trade.status === "closed" ? (
                              <div className="flex items-center gap-1">
                                {trade.disciplineScore ? (
                                  <button
                                    onClick={() => setExpandedScore(expandedScore === trade.id ? null : trade.id)}
                                    className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border transition-colors ${
                                      trade.disciplineScore >= 8 ? "border-[oklch(0.65_0.18_160)] text-[oklch(0.65_0.18_160)] bg-[oklch(0.65_0.18_160)]/10" :
                                      trade.disciplineScore >= 5 ? "border-yellow-500/50 text-yellow-500 bg-yellow-500/10" :
                                      "border-destructive/50 text-destructive bg-destructive/10"
                                    }`}
                                  >
                                    <Brain className="h-2.5 w-2.5" />
                                    {trade.disciplineScore}/10
                                  </button>
                                ) : (
                                  <Button
                                    size="sm" variant="ghost"
                                    disabled={scoringId === trade.id}
                                    onClick={() => { setScoringId(trade.id); scoreDiscipline.mutate({ tradeId: trade.id }); }}
                                    className="h-6 px-2 text-xs text-muted-foreground hover:text-primary"
                                    title="Score this trade's discipline"
                                  >
                                    {scoringId === trade.id ? (
                                      <span className="animate-pulse">Scoring...</span>
                                    ) : (
                                      <><Brain className="h-3 w-3 mr-1" />Score</>  
                                    )}
                                  </Button>
                                )}
                              </div>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => { if (confirm("Delete this trade?")) deleteTrade.mutate({ id: trade.id }); }}
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {expandedScore === trade.id && trade.disciplineFeedback && (
                          <TableRow key={`score-${trade.id}`} className="border-border bg-accent/20">
                            <TableCell colSpan={11} className="py-2 px-4">
                              <div className="flex items-start gap-2">
                                <Brain className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                                <p className="text-xs text-muted-foreground italic">{trade.disciplineFeedback}</p>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        </React.Fragment>
                      ); // end Fragment
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Trade Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>Add Trade Manually</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Symbol *</label>
                <Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} placeholder="AAPL" className="bg-input border-border h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Side *</label>
                <Select value={form.side} onValueChange={(v) => setForm({ ...form, side: v as any })}>
                  <SelectTrigger className="bg-input border-border h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="buy">Buy</SelectItem>
                    <SelectItem value="sell">Sell</SelectItem>
                    <SelectItem value="short">Short</SelectItem>
                    <SelectItem value="cover">Cover</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {quoteSymbol && (
              <div className="rounded-lg border border-border bg-secondary/40 p-3">
                {liveQuote ? (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Live {liveQuote.symbol} price</p>
                      <p className="text-lg font-bold text-foreground">${liveQuote.last.toFixed(2)}</p>
                      <p className={liveQuote.change >= 0 ? "text-xs text-[oklch(0.65_0.18_160)]" : "text-xs text-destructive"}>
                        {liveQuote.change >= 0 ? "+" : ""}{liveQuote.change.toFixed(2)} ({liveQuote.changePercent >= 0 ? "+" : ""}{liveQuote.changePercent.toFixed(2)}%)
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-border"
                        onClick={() => setForm({ ...form, entryPrice: liveQuote.last.toFixed(2) })}
                      >
                        Use Entry
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => refetchLiveQuote()}
                      >
                        Refresh
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Loading live quote for {quoteSymbol}...</p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Quantity *</label>
                <Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="100" className="bg-input border-border h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Entry Price *</label>
                <Input type="number" value={form.entryPrice} onChange={(e) => setForm({ ...form, entryPrice: e.target.value })} placeholder="150.00" className="bg-input border-border h-8 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Exit Price</label>
                <div className="flex gap-1">
                  <Input type="number" value={form.exitPrice} onChange={(e) => setForm({ ...form, exitPrice: e.target.value })} placeholder="155.00" className="bg-input border-border h-8 text-sm" />
                  {liveQuote && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs border-border"
                      onClick={() => setForm({ ...form, exitPrice: liveQuote.last.toFixed(2) })}
                    >
                      Live
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">P&L (auto-calc)</label>
                <Input type="number" value={form.pnl} onChange={(e) => setForm({ ...form, pnl: e.target.value })} placeholder="500.00" className="bg-input border-border h-8 text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Status</label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
                <SelectTrigger className="bg-input border-border h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Trade notes..." className="bg-input border-border h-8 text-sm" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowAddDialog(false)} className="flex-1 border-border">Cancel</Button>
              <Button onClick={handleSubmit} disabled={createTrade.isPending} className="flex-1 bg-primary text-primary-foreground">
                {createTrade.isPending ? "Adding..." : "Add Trade"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
