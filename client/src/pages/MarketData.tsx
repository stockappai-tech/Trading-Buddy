import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { REALTIME_INTERVALS } from "@/lib/realtime";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, PieChart, RefreshCw, Zap } from "lucide-react";

const assetOptions = ["stock", "crypto"] as const;
const timeframeOptions = ["1D", "1W", "1M"] as const;

function formatChange(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function calculateSMA(data: any[], windowSize = 10) {
  if (!data.length) return [];
  return data.map((point, index) => {
    if (index < windowSize - 1) return { date: point.date, value: undefined };
    const slice = data.slice(index - windowSize + 1, index + 1);
    const sum = slice.reduce((acc, p) => acc + Number(p.close ?? 0), 0);
    return { date: point.date, value: sum / windowSize };
  });
}

function calculateEMA(data: any[], period = 10) {
  if (!data.length) return [];
  const k = 2 / (period + 1);
  return data.reduce((acc: any[], point, index) => {
    if (index === 0) {
      acc.push({ date: point.date, value: Number(point.close ?? 0) });
    } else {
      const prev = acc[index - 1].value;
      const value = Number(point.close ?? 0) * k + prev * (1 - k);
      acc.push({ date: point.date, value });
    }
    return acc;
  }, []);
}

export default function MarketData() {
  const [symbol, setSymbol] = useState("AAPL");
  const [assetType, setAssetType] = useState<(typeof assetOptions)[number]>("stock");
  const [timeframe, setTimeframe] = useState<(typeof timeframeOptions)[number]>("1D");
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [indicator, setIndicator] = useState<"none" | "sma" | "ema">("none");

  const historical1D = trpc.market.historicalPrices.useQuery(
    { symbol, assetType, resolution: "1D", count: 30 },
    { enabled: Boolean(symbol) }
  );
  const historical1W = trpc.market.historicalPrices.useQuery(
    { symbol, assetType, resolution: "1W", count: 16 },
    { enabled: Boolean(symbol) }
  );
  const historical1M = trpc.market.historicalPrices.useQuery(
    { symbol, assetType, resolution: "1M", count: 30 },
    { enabled: Boolean(symbol) }
  );

  const optionsChain = trpc.market.optionsChain.useQuery(
    { symbol: symbol.toUpperCase(), expiration: selectedExpiry || undefined },
    { enabled: Boolean(symbol) && assetType === "stock" }
  );

  const stockQuotes = trpc.market.quotes.useQuery(
    { symbols: symbol.toUpperCase() },
    { enabled: Boolean(symbol) && assetType === "stock", refetchInterval: REALTIME_INTERVALS.quote }
  );

  const cryptoQuotes = trpc.market.cryptoQuotes.useQuery(
    { symbols: assetType === "crypto" ? [symbol] : [] },
    { enabled: Boolean(symbol) && assetType === "crypto", refetchInterval: REALTIME_INTERVALS.quote }
  );

  useEffect(() => {
    if (optionsChain.data?.expirationDates?.[0]) {
      setSelectedExpiry(optionsChain.data.expirationDates[0]);
    }
  }, [optionsChain.data]);

  const selectedHistorical = useMemo(() => {
    if (timeframe === "1D") return historical1D.data ?? [];
    if (timeframe === "1W") return historical1W.data ?? [];
    return historical1M.data ?? [];
  }, [historical1D.data, historical1W.data, historical1M.data, timeframe]);

  const combinedChartData = useMemo(() => {
    const sma = calculateSMA(selectedHistorical, 10);
    const ema = calculateEMA(selectedHistorical, 10);
    return selectedHistorical.map((point: any, index: number) => ({
      ...point,
      sma: sma[index]?.value,
      ema: ema[index]?.value,
    }));
  }, [selectedHistorical]);

  const latestCryptoQuote = cryptoQuotes.data?.[0];
  const latestStockQuote = stockQuotes.data?.[0];
  const optionExpirations = optionsChain.data?.expirationDates ?? [];
  const optionCalls = optionsChain.data?.calls ?? [];
  const optionPuts = optionsChain.data?.puts ?? [];
  const isLoading = historical1D.isLoading || historical1W.isLoading || historical1M.isLoading;
  const marketDataError =
    historical1D.error?.message ||
    historical1W.error?.message ||
    historical1M.error?.message ||
    stockQuotes.error?.message ||
    cryptoQuotes.error?.message;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
              <Zap className="h-8 w-8 text-primary" />
              Enhanced Market Data
            </h1>
            <p className="text-muted-foreground mt-1">
              Interactive charts, multi-timeframe analysis, options chains, and crypto price tracking.
            </p>
          </div>
          <Badge variant="secondary" className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Updates every 10s
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Market Controls</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="symbol">Symbol</Label>
              <Input
                id="symbol"
                placeholder={assetType === "crypto" ? "BTC" : "AAPL"}
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assetType">Asset Type</Label>
              <Select value={assetType} onValueChange={(value: any) => setAssetType(value)}>
                <SelectTrigger id="assetType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assetOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="timeframe">Timeframe</Label>
              <Select value={timeframe} onValueChange={(value: any) => setTimeframe(value)}>
                <SelectTrigger id="timeframe">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timeframeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="indicator">Indicators</Label>
              <Select value={indicator} onValueChange={(value: any) => setIndicator(value)}>
                <SelectTrigger id="indicator">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="sma">SMA</SelectItem>
                  <SelectItem value="ema">EMA</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-4">
                <span>Price Chart ({symbol.toUpperCase()})</span>
                <div className="text-xs text-muted-foreground">{timeframe} view</div>
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[380px]">
              {marketDataError ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <p>Market data could not load right now.</p>
                  <p className="max-w-md text-xs">{marketDataError}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      historical1D.refetch();
                      historical1W.refetch();
                      historical1M.refetch();
                      stockQuotes.refetch();
                      optionsChain.refetch();
                      cryptoQuotes.refetch();
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" /> Try Again
                  </Button>
                </div>
              ) : isLoading ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">Loading chart...</div>
              ) : combinedChartData.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <p>No historical data available for {symbol.toUpperCase()}.</p>
                  <p className="text-xs">Try a liquid US ticker like AAPL, NVDA, MSFT, META, or GOOGL.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={combinedChartData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.22 0.01 240)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} minTickGap={20} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} domain={["dataMin", "dataMax"]} />
                    <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, "Price"]} />
                    <Legend verticalAlign="top" height={24} />
                    <Line type="monotone" dataKey="close" stroke="#339af0" strokeWidth={2} dot={false} name="Close" />
                    {indicator === "sma" && <Line type="monotone" dataKey="sma" stroke="#22c55e" strokeWidth={2} dot={false} name="SMA" />}
                    {indicator === "ema" && <Line type="monotone" dataKey="ema" stroke="#f59e0b" strokeWidth={2} dot={false} name="EMA" />}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Market Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {assetType === "crypto" ? (
                  latestCryptoQuote ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-medium">Current Price</p>
                        <p className="text-xl font-bold">${latestCryptoQuote.price.toFixed(2)}</p>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm text-muted-foreground">24h Change</p>
                        <p className={latestCryptoQuote.change24h >= 0 ? "text-emerald-500" : "text-red-500"}>{formatChange(latestCryptoQuote.change24h)}</p>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm text-muted-foreground">Market Cap</p>
                        <p>${(latestCryptoQuote.marketCap ?? 0).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm text-muted-foreground">24h Volume</p>
                        <p>${(latestCryptoQuote.volume24h ?? 0).toLocaleString()}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Loading crypto quote...</div>
                  )
                ) : latestStockQuote ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-medium">Current Price</p>
                      <p className="text-xl font-bold">${latestStockQuote.last.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm text-muted-foreground">Today</p>
                      <p className={latestStockQuote.change >= 0 ? "text-emerald-500" : "text-red-500"}>
                        {latestStockQuote.change >= 0 ? "+" : ""}{latestStockQuote.change.toFixed(2)} ({formatChange(latestStockQuote.changePercent)})
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm text-muted-foreground">Open</p>
                      <p>${latestStockQuote.open.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm text-muted-foreground">High / Low</p>
                      <p>${latestStockQuote.high.toFixed(2)} / ${latestStockQuote.low.toFixed(2)}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Live quote refreshes automatically every 10 seconds.</p>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>{stockQuotes.isError ? "Stock quote could not load." : "Loading stock quote..."}</p>
                    {stockQuotes.error?.message && <p className="text-xs">{stockQuotes.error.message}</p>}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Timeframe Snapshot</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                {[{ title: "1D", data: historical1D.data }, { title: "1W", data: historical1W.data }, { title: "1M", data: historical1M.data }].map((frame) => (
                  <Card key={frame.title} className="border border-border">
                    <CardContent className="space-y-2">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>{frame.title}</span>
                        <span>{frame.data?.length ?? 0} points</span>
                      </div>
                      <div className="h-24">
                        {frame.data?.length ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={frame.data} margin={{ top: 4, right: 0, left: 0, bottom: 4 }}>
                              <Line type="monotone" dataKey="close" stroke="#60a5fa" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No data</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        <Tabs defaultValue={assetType === "stock" ? "options" : "crypto"} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="options">Options Chain</TabsTrigger>
            <TabsTrigger value="crypto">Crypto Quotes</TabsTrigger>
          </TabsList>

          <TabsContent value="options" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Options Chain for {symbol.toUpperCase()}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {optionsChain.error?.message && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                    Options data could not load: {optionsChain.error.message}
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="expiration">Expiration</Label>
                    <Select value={selectedExpiry} onValueChange={(value: any) => setSelectedExpiry(value)}>
                      <SelectTrigger id="expiration">
                        <SelectValue placeholder="Select expiry" />
                      </SelectTrigger>
                      <SelectContent>
                        {optionExpirations.map((expiry: string) => (
                          <SelectItem key={expiry} value={expiry}>
                            {expiry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!optionsChain.isLoading && optionExpirations.length === 0 && (
                      <p className="text-xs text-muted-foreground">No live options expirations available for this symbol.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Underlying Price</Label>
                    <p className="text-xl font-semibold">{optionsChain.data?.latestPrice ? `$${optionsChain.data.latestPrice.toFixed(2)}` : "--"}</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold mb-3">Calls</h3>
                    <div className="overflow-auto rounded-lg border border-border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-muted text-muted-foreground text-xs uppercase">
                          <tr>
                            <th className="px-3 py-2">Strike</th>
                            <th className="px-3 py-2">Bid</th>
                            <th className="px-3 py-2">Ask</th>
                            <th className="px-3 py-2">IV</th>
                          </tr>
                        </thead>
                        <tbody>
                          {optionCalls.length > 0 ? optionCalls.map((option: any) => (
                            <tr key={`${option.strike}-call`} className="border-t border-border even:bg-muted/50">
                              <td className="px-3 py-2">${option.strike}</td>
                              <td className="px-3 py-2">${option.bid.toFixed(2)}</td>
                              <td className="px-3 py-2">${option.ask.toFixed(2)}</td>
                              <td className="px-3 py-2">{(option.impliedVolatility * 100).toFixed(1)}%</td>
                            </tr>
                          )) : <tr><td colSpan={4} className="px-3 py-4 text-center text-sm text-muted-foreground">No live calls available</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-3">Puts</h3>
                    <div className="overflow-auto rounded-lg border border-border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-muted text-muted-foreground text-xs uppercase">
                          <tr>
                            <th className="px-3 py-2">Strike</th>
                            <th className="px-3 py-2">Bid</th>
                            <th className="px-3 py-2">Ask</th>
                            <th className="px-3 py-2">IV</th>
                          </tr>
                        </thead>
                        <tbody>
                          {optionPuts.length > 0 ? optionPuts.map((option: any) => (
                            <tr key={`${option.strike}-put`} className="border-t border-border even:bg-muted/50">
                              <td className="px-3 py-2">${option.strike}</td>
                              <td className="px-3 py-2">${option.bid.toFixed(2)}</td>
                              <td className="px-3 py-2">${option.ask.toFixed(2)}</td>
                              <td className="px-3 py-2">{(option.impliedVolatility * 100).toFixed(1)}%</td>
                            </tr>
                          )) : <tr><td colSpan={4} className="px-3 py-4 text-center text-sm text-muted-foreground">No live puts available</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="crypto" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Crypto Price Feed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-muted-foreground">Symbol</p>
                    <p className="mt-2 text-xl font-semibold">{symbol.toUpperCase()}</p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-muted-foreground">Last Price</p>
                    <p className="mt-2 text-xl font-semibold">${latestCryptoQuote?.price?.toFixed(2) ?? "--"}</p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm text-muted-foreground">24h Change</p>
                    <p className={`mt-2 text-xl font-semibold ${(latestCryptoQuote?.change24h ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {latestCryptoQuote ? formatChange(latestCryptoQuote.change24h) : "--"}
                    </p>
                  </div>
                </div>

                <div className="overflow-auto rounded-lg border border-border">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-muted text-muted-foreground text-xs uppercase">
                      <tr>
                        <th className="px-3 py-2">Metric</th>
                        <th className="px-3 py-2">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2">Market Cap</td>
                        <td className="px-3 py-2">${latestCryptoQuote?.marketCap?.toLocaleString() ?? "--"}</td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2">24h Volume</td>
                        <td className="px-3 py-2">${latestCryptoQuote?.volume24h?.toLocaleString() ?? "--"}</td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2">Updated</td>
                        <td className="px-3 py-2">{latestCryptoQuote?.updatedAt ? new Date(latestCryptoQuote.updatedAt).toLocaleTimeString() : "--"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Button variant="secondary" className="w-full md:w-auto" onClick={() => {
          historical1D.refetch();
          historical1W.refetch();
          historical1M.refetch();
          optionsChain.refetch();
          cryptoQuotes.refetch();
          stockQuotes.refetch();
        }}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh Data
        </Button>
      </div>
    </DashboardLayout>
  );
}
