import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { REALTIME_INTERVALS } from "@/lib/realtime";
import { trpc } from "@/lib/trpc";
import { Zap, CheckCircle2, CalendarDays, Shield, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export default function Automation() {
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [price, setPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [duration, setDuration] = useState<"day" | "gtc">("day");

  const normalizedSymbol = useMemo(() => symbol.trim().toUpperCase(), [symbol]);

  const connection = trpc.broker.getConnection.useQuery(undefined, { refetchInterval: REALTIME_INTERVALS.account });
  const validateConnection = trpc.broker.validateConnection.useQuery(undefined, { enabled: false });
  const calendar = trpc.broker.fetchEconomicCalendar.useQuery(undefined, { refetchInterval: REALTIME_INTERVALS.calendar });
  const liveQuote = trpc.market.quotes.useQuery(
    { symbols: normalizedSymbol },
    { enabled: normalizedSymbol.length > 0, refetchInterval: REALTIME_INTERVALS.quote }
  );
  const currentQuote = liveQuote.data?.[0];

  const placeOrder = trpc.broker.placeOrder.useMutation({
    onSuccess: () => toast.success("Order sent to Tradier"),
    onError: (error) => toast.error(error.message),
  });

  const executeSignalOrder = trpc.broker.executeSignalOrder.useMutation({
    onSuccess: () => toast.success("Signal order executed"),
    onError: (error) => toast.error(error.message),
  });

  const handlePlaceOrder = () => {
    if (!symbol || !quantity) {
      toast.error("Symbol and quantity are required");
      return;
    }
    if (orderType === "limit" && !price) {
      toast.error("Limit orders require a price");
      return;
    }
    placeOrder.mutate({ symbol: normalizedSymbol, side, quantity, orderType, price: price || undefined, stopPrice: stopPrice || undefined, duration });
  };

  const handleExecuteSignal = () => {
    if (!symbol) {
      toast.error("Symbol is required to execute a signal order");
      return;
    }
    executeSignalOrder.mutate({ symbol: normalizedSymbol });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
              <Zap className="h-8 w-8 text-primary" /> Broker Automation
            </h1>
            <p className="text-muted-foreground mt-1">
              Connect your Tradier brokerage account, execute AI signals, and keep track of market-moving events.
            </p>
          </div>
          <Badge variant="secondary" className="flex items-center gap-2">
            <Shield className="h-3 w-3" /> Secure Broker Access
          </Badge>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" /> Tradier Connection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-foreground">Broker connected</p>
                <p className="text-xs text-muted-foreground">
                  {connection.data?.connected ? "Tradier credentials are configured." : "Configure Tradier credentials in Settings to enable live execution."}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => validateConnection.refetch()}
                  disabled={validateConnection.isFetching || !connection.data?.connected}
                  className="bg-primary text-primary-foreground h-9 text-xs"
                >
                  {validateConnection.isFetching ? "Validating..." : "Validate Connection"}
                </Button>
                {validateConnection.data?.message && (
                  <span className={`text-xs ${validateConnection.data.connected ? "text-emerald-400" : "text-destructive"}`}>
                    {validateConnection.data.message}
                  </span>
                )}
              </div>
              <div className="rounded-lg border border-border p-3 bg-secondary/20">
                <p className="text-xs text-muted-foreground">Account ID</p>
                <p className="font-mono text-sm text-foreground">{connection.data?.tradierAccountId ?? "Not configured"}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" /> Economic Calendar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {calendar.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading upcoming events…</p>
              ) : (
                <div className="space-y-3">
                  {calendar.data?.slice(0, 8).map((event: any, idx: number) => {
                    const eventDate = String(event.date ?? "").slice(0, 10);
                    const isToday = eventDate === new Date().toISOString().slice(0, 10);
                    return (
                    <div key={idx} className="rounded-xl border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">{event.event}</p>
                        <div className="flex items-center gap-2">
                          {isToday && <Badge className="text-[11px] uppercase tracking-[0.15em]">Today</Badge>}
                          <Badge variant="outline" className="text-[11px] uppercase tracking-[0.15em]">
                            {event.impact}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {event.category ? `${event.category} • ` : ""}{event.country} • {event.date}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">{event.description}</p>
                    </div>
                  );})}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" /> Direct Order Execution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="auto-symbol">Symbol</Label>
                <Input id="auto-symbol" placeholder="AAPL" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="auto-side">Side</Label>
                <Select value={side} onValueChange={(value: any) => setSide(value)}>
                  <SelectTrigger id="auto-side">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">Buy</SelectItem>
                    <SelectItem value="sell">Sell</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="auto-quantity">Quantity</Label>
                <Input id="auto-quantity" type="number" placeholder="100" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="auto-orderType">Order Type</Label>
                <Select value={orderType} onValueChange={(value: any) => setOrderType(value)}>
                  <SelectTrigger id="auto-orderType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market">Market</SelectItem>
                    <SelectItem value="limit">Limit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {orderType === "limit" && (
                <div className="space-y-2">
                  <Label htmlFor="auto-price">Limit Price</Label>
                  <Input id="auto-price" placeholder="150.00" value={price} onChange={(e) => setPrice(e.target.value)} />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="auto-stop">Stop Price</Label>
                <Input id="auto-stop" placeholder="145.00" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} />
              </div>
            </div>
            {normalizedSymbol && (
              <div className="rounded-xl border border-border bg-muted/10 p-3">
                {currentQuote ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Live {currentQuote.symbol} quote</p>
                      <p className="text-lg font-bold text-foreground">
                        ${currentQuote.last.toFixed(2)}
                        <span className={currentQuote.change >= 0 ? "ml-2 text-sm text-emerald-500" : "ml-2 text-sm text-destructive"}>
                          {currentQuote.change >= 0 ? "+" : ""}{currentQuote.change.toFixed(2)} ({currentQuote.changePercent >= 0 ? "+" : ""}{currentQuote.changePercent.toFixed(2)}%)
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {orderType === "limit" && (
                        <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={() => setPrice(currentQuote.last.toFixed(2))}>
                          Use Live Limit
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => liveQuote.refetch()}>
                        <RefreshCw className="mr-2 h-3 w-3" /> Refresh Quote
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {liveQuote.isError ? `Live quote unavailable: ${liveQuote.error.message}` : `Loading live quote for ${normalizedSymbol}...`}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-3 items-center">
              <Button onClick={handlePlaceOrder} disabled={placeOrder.isPending} className="bg-primary text-primary-foreground h-9 text-xs">
                {placeOrder.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Sending Order...
                  </>
                ) : (
                  <>Place Order</>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">Orders use Tradier and execute immediately when connected.</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-primary" /> AI Signal Execution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="signal-symbol">Trade Signal Symbol</Label>
                <Input id="signal-symbol" placeholder="AAPL" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              </div>
            </div>
            <Button onClick={handleExecuteSignal} disabled={executeSignalOrder.isPending} className="bg-secondary text-foreground h-9 text-xs">
              {executeSignalOrder.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Executing Signal...
                </>
              ) : (
                <>Execute AI Signal</>
              )}
            </Button>
            {executeSignalOrder.data?.signal && (
              <div className="rounded-xl border border-border p-4 bg-muted/5">
                <p className="text-sm font-semibold text-foreground">Signal: {executeSignalOrder.data.signal.signal}</p>
                <p className="text-xs text-muted-foreground mt-1">{executeSignalOrder.data.signal.reasoning}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Placed {executeSignalOrder.data.placedQuantity} shares as a {executeSignalOrder.data.placedSide} market order.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
