import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { REALTIME_INTERVALS } from "@/lib/realtime";
import { Bot, BookmarkPlus, Download, ExternalLink, FileText, Heart, Mic, Newspaper, Star, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format, subDays, startOfDay } from "date-fns";
import { useLocation } from "wouter";

// Mood emoji map based on emotional note keywords
function getMoodEmoji(note: string | null | undefined): string {
  if (!note) return '';
  const n = note.toLowerCase();
  if (n.includes('great') || n.includes('amazing') || n.includes('excellent') || n.includes('perfect')) return '🤩';
  if (n.includes('good') || n.includes('happy') || n.includes('confident') || n.includes('focused')) return '😊';
  if (n.includes('okay') || n.includes('ok') || n.includes('fine') || n.includes('neutral')) return '😐';
  if (n.includes('bad') || n.includes('frustrated') || n.includes('angry') || n.includes('mad')) return '😤';
  if (n.includes('sad') || n.includes('disappoint') || n.includes('upset')) return '😞';
  if (n.includes('anxious') || n.includes('nervous') || n.includes('scared') || n.includes('fear')) return '😰';
  if (n.includes('tired') || n.includes('exhausted') || n.includes('sleepy')) return '😴';
  if (n.includes('revenge') || n.includes('chasing') || n.includes('fomo')) return '🔥';
  return '💭';
}

function CoachFeedback({ content }: { content: string }) {
  const lines = content.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  return (
    <div className="space-y-1.5">
      {lines.map((line, index) => {
        const text = line.replace(/^[-*]\s+/, "").replace(/\*\*(.*?)\*\*/g, "$1");
        const isBullet = /^[-*]\s+/.test(line);

        return (
          <p key={index} className={isBullet ? "pl-3 before:content-['•'] before:mr-2" : ""}>
            {text}
          </p>
        );
      })}
    </div>
  );
}

type Tab = "watchlist" | "sessions";

export default function Sessions() {
  const [tab, setTab] = useState<Tab>("watchlist");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newSymbol, setNewSymbol] = useState("");
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: sessions, isLoading: sessionsLoading } = trpc.sessions.list.useQuery(undefined, { refetchInterval: REALTIME_INTERVALS.dashboard });
  const { data: watchlistItems, isLoading: watchlistLoading } = trpc.watchlist.list.useQuery(undefined, { refetchInterval: REALTIME_INTERVALS.account });
  const { data: allTrades } = trpc.trades.list.useQuery({}, { refetchInterval: REALTIME_INTERVALS.dashboard });
  const exportMutation = trpc.export.sessionPdf.useMutation();

  const addToWatchlist = trpc.watchlist.add.useMutation({
    onSuccess: () => {
      utils.watchlist.list.invalidate();
      setNewSymbol("");
      toast.success("Added to watchlist");
    },
    onError: (e) => toast.error(e.message ?? "Failed to add"),
  });

  const removeFromWatchlist = trpc.watchlist.remove.useMutation({
    onSuccess: () => {
      utils.watchlist.list.invalidate();
      toast.success("Removed from watchlist");
    },
    onError: (e) => toast.error(e.message ?? "Failed to remove"),
  });

  const handleAddSymbol = () => {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    addToWatchlist.mutate({ symbol: sym });
  };

  // News from watchlist symbols
  const watchlistSymbols = useMemo(() => {
    if (!watchlistItems || watchlistItems.length === 0) return [];
    return watchlistItems.map((w) => w.symbol).slice(0, 8);
  }, [watchlistItems]);

  const { data: news, isLoading: newsLoading } = trpc.market.news.useQuery(
    { symbols: watchlistSymbols },
    { enabled: watchlistSymbols.length > 0, refetchInterval: REALTIME_INTERVALS.news }
  );

  // Live quotes for watchlist symbols
  const { data: watchlistQuotes } = trpc.market.quotes.useQuery(
    { symbols: watchlistSymbols.join(",") },
    { enabled: watchlistSymbols.length > 0, refetchInterval: REALTIME_INTERVALS.quote }
  );
  const quoteMap = useMemo(() => {
    const m: Record<string, { last: number; changePercent: number }> = {};
    if (watchlistQuotes) (watchlistQuotes as any[]).forEach((q: any) => { m[q.symbol] = q; });
    return m;
  }, [watchlistQuotes]);

  // Emotional heatmap data
  const heatmapDays = useMemo(() => {
    const days: { date: string; pnl: number; mood: string; tradeCount: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = startOfDay(subDays(new Date(), i));
      const dateStr = format(d, 'yyyy-MM-dd');
      const dayTrades = (allTrades ?? []).filter((t) => {
        const tradeDate = format(new Date(t.createdAt), 'yyyy-MM-dd');
        return tradeDate === dateStr && t.status === 'closed';
      });
      const pnl = dayTrades.reduce((sum, t) => sum + parseFloat(t.pnl ?? '0'), 0);
      const daySession = (sessions ?? []).find((s) => format(new Date(s.createdAt), 'yyyy-MM-dd') === dateStr);
      const mood = getMoodEmoji(daySession?.emotionalNote);
      days.push({ date: dateStr, pnl, mood, tradeCount: dayTrades.length });
    }
    return days;
  }, [allTrades, sessions]);

  const handleExportPdf = async (sessionId: number) => {
    try {
      const data = await exportMutation.mutateAsync({ sessionId });
      const { exportSessionPdf } = await import("@/lib/pdfExport");
      exportSessionPdf(data.session as any, data.trades as any);
      toast.success("PDF exported successfully");
    } catch (e: any) {
      toast.error(e.message ?? "Export failed");
    }
  };

  const selectedSession = sessions?.find((s) => s.id === selectedId);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Watchlist & News</h1>
            <p className="text-sm text-muted-foreground">Track your tickers and follow market news</p>
          </div>
          <Button size="sm" onClick={() => navigate("/record")} className="bg-primary text-primary-foreground h-8 text-xs">
            <Mic className="h-3 w-3 mr-1" /> New Session
          </Button>
        </div>

        {/* Emotional Heatmap */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Heart className="h-4 w-4 text-primary" />
              Emotional Heatmap — Last 30 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-10 gap-1">
              {heatmapDays.map((day) => {
                const hasActivity = day.tradeCount > 0 || day.mood;
                const bgColor = !hasActivity
                  ? 'bg-secondary/30'
                  : day.pnl > 0
                  ? 'bg-[oklch(0.65_0.18_160)]/40 border-[oklch(0.65_0.18_160)]/40'
                  : day.pnl < 0
                  ? 'bg-destructive/30 border-destructive/30'
                  : 'bg-secondary/50';
                return (
                  <div
                    key={day.date}
                    title={`${format(new Date(day.date + 'T12:00:00'), 'MMM d')}${day.tradeCount > 0 ? ` · ${day.tradeCount} trade${day.tradeCount > 1 ? 's' : ''} · P&L: ${day.pnl >= 0 ? '+' : ''}$${day.pnl.toFixed(0)}` : ''}${day.mood ? ` · ${day.mood}` : ''}`}
                    className={`aspect-square rounded-sm border flex items-center justify-center text-xs cursor-default transition-opacity hover:opacity-80 ${bgColor}`}
                  >
                    {day.mood && <span className="leading-none">{day.mood}</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-[oklch(0.65_0.18_160)]/40 border border-[oklch(0.65_0.18_160)]/40" /> Profit day</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-destructive/30 border border-destructive/30" /> Loss day</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-secondary/30" /> No trades</div>
              <span className="ml-auto">Hover for details</span>
            </div>
          </CardContent>
        </Card>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-secondary/30 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab("watchlist")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "watchlist" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Star className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />Watchlist
          </button>
          <button
            onClick={() => setTab("sessions")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "sessions" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <FileText className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />Sessions
          </button>
        </div>

        {tab === "watchlist" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Watchlist */}
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Star className="h-4 w-4 text-primary" /> My Watchlist
              </h2>

              {/* Add ticker input */}
              <div className="flex gap-2">
                <Input
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleAddSymbol()}
                  placeholder="Add ticker (e.g. AAPL, TSLA)"
                  className="h-9 text-sm bg-card border-border font-mono"
                  maxLength={10}
                />
                <Button
                  size="sm"
                  onClick={handleAddSymbol}
                  disabled={!newSymbol.trim() || addToWatchlist.isPending}
                  className="h-9 px-3 bg-primary text-primary-foreground"
                >
                  <BookmarkPlus className="h-4 w-4" />
                </Button>
              </div>

              {watchlistLoading ? (
                <p className="text-sm text-muted-foreground">Loading watchlist...</p>
              ) : !watchlistItems || watchlistItems.length === 0 ? (
                <Card className="bg-card border-border">
                  <CardContent className="p-6 text-center">
                    <Star className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-muted-foreground">Your watchlist is empty</p>
                    <p className="text-xs text-muted-foreground mt-1">Add tickers above to follow their news</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {watchlistItems.map((item) => {
                    const q = quoteMap[item.symbol];
                    const isUp = q && q.changePercent >= 0;
                    return (
                      <Card key={item.id} className="bg-card border-border">
                        <CardContent className="p-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="font-mono text-sm border-primary/40 text-primary px-2.5 py-0.5">
                              {item.symbol}
                            </Badge>
                            {q ? (
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-foreground">${q.last.toFixed(2)}</span>
                                <span className={`text-xs font-medium ${isUp ? "text-green-500" : "text-red-500"}`}>
                                  {isUp ? "+" : ""}{q.changePercent.toFixed(2)}%
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Added {format(new Date(item.createdAt), "MMM d")}</span>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeFromWatchlist.mutate({ id: item.id })}
                            disabled={removeFromWatchlist.isPending}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Market News from Watchlist */}
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-primary" /> Market News
                {watchlistSymbols.length > 0 && (
                  <span className="text-xs text-muted-foreground font-normal">for {watchlistSymbols.join(", ")}</span>
                )}
              </h2>
              {watchlistSymbols.length === 0 ? (
                <Card className="bg-card border-border">
                  <CardContent className="p-6 text-center">
                    <Newspaper className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-muted-foreground">Add tickers to your watchlist to see news</p>
                  </CardContent>
                </Card>
              ) : newsLoading ? (
                <div className="space-y-3">
                  {[1,2,3].map(i => <div key={i} className="h-24 bg-secondary/30 rounded-lg animate-pulse" />)}
                </div>
              ) : !news || (news as any[]).length === 0 ? (
                <Card className="bg-card border-border">
                  <CardContent className="p-6 text-center">
                    <Newspaper className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-muted-foreground">No news found for your watchlist</p>
                  </CardContent>
                </Card>
              ) : (
                (news as any[]).map((item: any, i: number) => {
                  const title = item.headline ?? item.title ?? item.name ?? "";
                  const summary = item.summary ?? item.description ?? "";
                  const source = typeof item.source === "string" ? item.source : item.source?.name ?? "";
                  const url = item.url ?? "";
                  const image = item.image ?? item.urlToImage ?? "";
                  // Relative time display
                  let timeLabel = "";
                  if (item.datetime) {
                    const ms = item.datetime * 1000;
                    const diffMin = Math.floor((Date.now() - ms) / 60000);
                    if (diffMin < 60) timeLabel = `${diffMin}m ago`;
                    else if (diffMin < 1440) timeLabel = `${Math.floor(diffMin / 60)}h ago`;
                    else timeLabel = new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  }
                  // Live price for article's symbol
                  const articleSym = item.symbol;
                  const q = articleSym ? quoteMap[articleSym] : null;
                  return (
                    <Card key={i} className="bg-card border-border hover:border-primary/30 transition-colors">
                      <CardContent className="p-3">
                        <div className="flex items-start gap-3">
                          {image && (
                            <img src={image} alt="" className="w-16 h-16 object-cover rounded-md flex-shrink-0 bg-secondary" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground line-clamp-2 leading-snug">{title}</p>
                            {summary && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{summary}</p>
                            )}
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              {source && (
                                <span className="text-xs bg-secondary/60 text-muted-foreground px-1.5 py-0.5 rounded font-medium">{source}</span>
                              )}
                              {timeLabel && <span className="text-xs text-muted-foreground">{timeLabel}</span>}
                              {q && (
                                <span className={`text-xs font-mono font-semibold ${q.changePercent >= 0 ? "text-green-500" : "text-red-500"}`}>
                                  {articleSym} ${q.last.toFixed(2)} ({q.changePercent >= 0 ? "+" : ""}{q.changePercent.toFixed(2)}%)
                                </span>
                              )}
                              {url && (
                                <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-0.5 hover:underline ml-auto">
                                  Read <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        )}

        {tab === "sessions" && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Recent Sessions
            </h2>
            {sessionsLoading ? (
              <p className="text-sm text-muted-foreground">Loading sessions...</p>
            ) : !sessions || sessions.length === 0 ? (
              <Card className="bg-card border-border">
                <CardContent className="p-6 text-center">
                  <Mic className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                  <p className="text-sm text-muted-foreground">No sessions yet</p>
                  <Button size="sm" variant="outline" onClick={() => navigate("/record")} className="mt-3 border-border text-xs">
                    Record your first session
                  </Button>
                </CardContent>
              </Card>
            ) : (
              sessions.map((session) => (
                <Card
                  key={session.id}
                  className={`bg-card border cursor-pointer transition-colors ${selectedId === session.id ? "border-primary/50" : "border-border hover:border-border/80"}`}
                  onClick={() => setSelectedId(session.id === selectedId ? null : session.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-foreground truncate">{session.title ?? "Untitled Session"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(session.createdAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                        {session.emotionalNote && (
                          <p className="text-xs text-muted-foreground mt-1 italic">"{session.emotionalNote}"</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {session.coachFeedback && (
                          <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                            <Bot className="h-2.5 w-2.5 mr-1" /> AI
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); handleExportPdf(session.id); }}
                          disabled={exportMutation.isPending}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {selectedId === session.id && session.coachFeedback && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-xs text-muted-foreground mb-1 font-semibold">AI Coach Feedback:</p>
                        <div className="text-xs text-foreground/80 prose-xs">
                          <CoachFeedback content={session.coachFeedback} />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
