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
import {
  BarChart3,
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Target,
  PieChart,
  Zap,
  RefreshCw,
  Crown,
  ExternalLink,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const asArray = <T,>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value : [];
const asNumber = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export default function AITradingAssistant() {
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell" | "short" | "cover">("buy");
  const [entryPrice, setEntryPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [timeframe, setTimeframe] = useState<"1D" | "1W" | "1M">("1D");

  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>([]);
  const [accountSize, setAccountSize] = useState("10000");
  const [riskTolerance, setRiskTolerance] = useState<"conservative" | "moderate" | "aggressive">("moderate");
  const normalizedSelectedSymbol = useMemo(() => selectedSymbol.trim().toUpperCase(), [selectedSymbol]);

  // API calls
  const selectedQuote = trpc.market.quotes.useQuery(
    { symbols: normalizedSelectedSymbol },
    { enabled: normalizedSelectedSymbol.length > 0, refetchInterval: REALTIME_INTERVALS.quote }
  );
  const liveQuote = selectedQuote.data?.[0];

  const predictTrade = trpc.aiAssistant.predictTradeOutcomes.useQuery(
    {
      symbol: normalizedSelectedSymbol,
      side: tradeSide,
      entryPrice,
      quantity,
      stopLoss: stopLoss || undefined,
      takeProfit: takeProfit || undefined,
      timeframe,
    },
    {
      enabled: false,
    }
  );

  const sentimentAnalysis = trpc.aiAssistant.getSentimentAnalysis.useQuery(
    { symbols: portfolioSymbols.filter(Boolean) },
    { enabled: false }
  );

  const tradeSignals = trpc.aiAssistant.getTradeSignals.useQuery(
    { symbols: portfolioSymbols.filter(Boolean) },
    { enabled: false }
  );

  const portfolioOptimization = trpc.aiAssistant.optimizePortfolio.useQuery(
    {
      accountSize,
      riskTolerance,
      targetSymbols: portfolioSymbols.filter(Boolean),
    },
    { enabled: false }
  );

  const handlePredictTrade = async () => {
    if (!normalizedSelectedSymbol || !entryPrice || !quantity) {
      toast.error("Please fill in symbol, entry price, and quantity");
      return;
    }
    const result = await predictTrade.refetch();
    if (result.error) toast.error(result.error.message);
  };

  const handleSentimentAnalysis = async () => {
    if (portfolioSymbols.length === 0) {
      toast.error("Please add at least one symbol");
      return;
    }
    const result = await sentimentAnalysis.refetch();
    if (result.error) toast.error(result.error.message);
  };

  const handleTradeSignals = async () => {
    if (portfolioSymbols.length === 0) {
      toast.error("Please add at least one symbol");
      return;
    }
    const result = await tradeSignals.refetch();
    if (result.error) toast.error(result.error.message);
  };

  const handlePortfolioOptimization = async () => {
    if (!accountSize) {
      toast.error("Please enter account size");
      return;
    }
    const result = await portfolioOptimization.refetch();
    if (result.error) toast.error(result.error.message);
  };

  const predictionKeyFactors = asArray<string>(predictTrade.data?.keyFactors);
  const sentimentItems = asArray(sentimentAnalysis.data);
  const signalItems = asArray(tradeSignals.data);
  const recommendedAllocations = asArray<any>(portfolioOptimization.data?.recommendedAllocations);
  const rebalancingActions = asArray<string>(portfolioOptimization.data?.rebalancingActions);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
              <Brain className="h-8 w-8 text-primary" />
              AI Trading Assistant
            </h1>
            <p className="text-muted-foreground mt-1">
              Advanced AI-powered trading insights and portfolio optimization
            </p>
          </div>
          <Badge variant="secondary" className="flex items-center gap-1">
            <Crown className="h-3 w-3" />
            Premium Feature
          </Badge>
        </div>

        <Tabs defaultValue="predictions" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="predictions">Trade Predictions</TabsTrigger>
            <TabsTrigger value="sentiment">Market Sentiment</TabsTrigger>
            <TabsTrigger value="signals">Trade Signals</TabsTrigger>
            <TabsTrigger value="portfolio">Portfolio Optimization</TabsTrigger>
          </TabsList>

          <TabsContent value="predictions" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Trade Outcome Prediction
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="symbol">Symbol</Label>
                    <Input
                      id="symbol"
                      placeholder="AAPL"
                      value={selectedSymbol}
                      onChange={(e) => setSelectedSymbol(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="side">Side</Label>
                    <Select value={tradeSide} onValueChange={(value: any) => setTradeSide(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="buy">Buy</SelectItem>
                        <SelectItem value="sell">Sell</SelectItem>
                        <SelectItem value="short">Short</SelectItem>
                        <SelectItem value="cover">Cover</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="entry">Entry Price</Label>
                    <Input
                      id="entry"
                      placeholder="150.00"
                      value={entryPrice}
                      onChange={(e) => setEntryPrice(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quantity">Quantity</Label>
                    <Input
                      id="quantity"
                      placeholder="100"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="stopLoss">Stop Loss (Optional)</Label>
                    <Input
                      id="stopLoss"
                      placeholder="145.00"
                      value={stopLoss}
                      onChange={(e) => setStopLoss(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="takeProfit">Take Profit (Optional)</Label>
                    <Input
                      id="takeProfit"
                      placeholder="160.00"
                      value={takeProfit}
                      onChange={(e) => setTakeProfit(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="timeframe">Timeframe</Label>
                    <Select value={timeframe} onValueChange={(value: any) => setTimeframe(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1D">1 Day</SelectItem>
                        <SelectItem value="1W">1 Week</SelectItem>
                        <SelectItem value="1M">1 Month</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {normalizedSelectedSymbol && (
                  <div className="rounded-xl border border-border bg-muted/10 p-3">
                    {liveQuote ? (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground">Live {liveQuote.symbol} quote for this prediction</p>
                          <p className="text-lg font-bold text-foreground">
                            ${liveQuote.last.toFixed(2)}
                            <span className={liveQuote.change >= 0 ? "ml-2 text-sm text-emerald-500" : "ml-2 text-sm text-destructive"}>
                              {liveQuote.change >= 0 ? "+" : ""}{liveQuote.change.toFixed(2)} ({liveQuote.changePercent >= 0 ? "+" : ""}{liveQuote.changePercent.toFixed(2)}%)
                            </span>
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={() => setEntryPrice(liveQuote.last.toFixed(2))}>
                            Use Live Entry
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => selectedQuote.refetch()}>
                            <RefreshCw className="mr-2 h-3 w-3" /> Refresh Quote
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {selectedQuote.isError ? `Live quote unavailable: ${selectedQuote.error.message}` : `Loading live quote for ${normalizedSelectedSymbol}...`}
                      </p>
                    )}
                  </div>
                )}

                <Button onClick={handlePredictTrade} disabled={predictTrade.isFetching}>
                  {predictTrade.isFetching ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Brain className="h-4 w-4 mr-2" />
                      Predict Outcome
                    </>
                  )}
                </Button>

                {predictTrade.data && (
                  <Card className="mt-6">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        {predictTrade.data.prediction === "bullish" ? (
                          <TrendingUp className="h-5 w-5 text-green-500" />
                        ) : predictTrade.data.prediction === "bearish" ? (
                          <TrendingDown className="h-5 w-5 text-red-500" />
                        ) : (
                          <BarChart3 className="h-5 w-5 text-gray-500" />
                        )}
                        Prediction: {predictTrade.data.prediction.toUpperCase()}
                        <Badge variant={predictTrade.data.confidence > 70 ? "default" : "secondary"}>
                          {predictTrade.data.confidence}% Confidence
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm font-medium">Expected Return</Label>
                          <p className="text-2xl font-bold">
                            {asNumber(predictTrade.data.expectedReturn) >= 0 ? "+" : ""}
                            {asNumber(predictTrade.data.expectedReturn).toFixed(1)}%
                          </p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium">Risk Score</Label>
                          <p className="text-2xl font-bold">{asNumber(predictTrade.data.riskScore)}/10</p>
                        </div>
                      </div>

                      <div>
                        <Label className="text-sm font-medium">Analysis</Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          {predictTrade.data.reasoning}
                        </p>
                      </div>

                      {predictionKeyFactors.length > 0 && (
                        <div>
                          <Label className="text-sm font-medium">Key Factors</Label>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {predictionKeyFactors.map((factor: string, index: number) => (
                              <Badge key={index} variant="outline">
                                {factor}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {asArray<any>(predictTrade.data.sources).length > 0 && (
                        <div>
                          <Label className="text-sm font-medium">Sources</Label>
                          <div className="mt-2 space-y-2">
                            {asArray<any>(predictTrade.data.sources).map((source: any, index: number) => (
                              <a
                                key={`${source.url || source.title}-${index}`}
                                href={source.url || undefined}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`block rounded-lg border border-border p-3 text-xs transition-colors ${source.url ? "hover:border-primary/50 hover:bg-muted/20" : "cursor-default"}`}
                                onClick={(event) => {
                                  if (!source.url) event.preventDefault();
                                }}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="font-semibold text-foreground">[S{index + 1}] {source.title}</p>
                                    <p className="mt-1 text-muted-foreground">
                                      {source.source ?? "Market source"}{source.recency ? ` • ${source.recency}` : ""}
                                    </p>
                                  </div>
                                  {source.url && <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sentiment" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Market Sentiment Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Symbols (comma-separated)</Label>
                  <Input
                    placeholder="AAPL, MSFT, TSLA"
                    value={portfolioSymbols.join(", ")}
                    onChange={(e) => setPortfolioSymbols(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                  />
                </div>

                <Button onClick={handleSentimentAnalysis} disabled={sentimentAnalysis.isFetching}>
                  {sentimentAnalysis.isFetching ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <BarChart3 className="h-4 w-4 mr-2" />
                      Analyze Sentiment
                    </>
                  )}
                </Button>

                {sentimentItems.length > 0 && (
                  <div className="grid gap-4 mt-6">
                    {sentimentItems.map((analysis) => {
                      const keyThemes = asArray<string>(analysis.keyThemes);
                      return (
                      <Card key={analysis.symbol}>
                        <CardHeader>
                          <CardTitle className="flex items-center justify-between">
                            <span>{analysis.symbol}</span>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  analysis.sentiment === "positive" ? "default" :
                                  analysis.sentiment === "negative" ? "destructive" : "secondary"
                                }
                              >
                                {analysis.sentiment}
                              </Badge>
                              <Badge variant="outline">
                                {analysis.confidence}% confidence
                              </Badge>
                            </div>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground mb-3">
                            {analysis.summary}
                          </p>
                          {keyThemes.length > 0 && (
                            <div>
                              <Label className="text-sm font-medium">Key Themes</Label>
                              <div className="flex flex-wrap gap-2 mt-2">
                                {keyThemes.map((theme: string, index: number) => (
                                  <Badge key={index} variant="outline" className="text-xs">
                                    {theme}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );})}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="signals" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Automated Trade Signals
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Symbols (comma-separated)</Label>
                  <Input
                    placeholder="AAPL, MSFT, TSLA"
                    value={portfolioSymbols.join(", ")}
                    onChange={(e) => setPortfolioSymbols(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                  />
                </div>

                <Button onClick={handleTradeSignals} disabled={tradeSignals.isFetching}>
                  {tradeSignals.isFetching ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Generating Signals...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      Generate Signals
                    </>
                  )}
                </Button>

                {signalItems.length > 0 && (
                  <div className="grid gap-4 mt-6">
                    {signalItems.map((signal) => (
                      <Card key={signal.symbol}>
                        <CardHeader>
                          <CardTitle className="flex items-center justify-between">
                            <span>{signal.symbol}</span>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  signal.signal === "BUY" ? "default" :
                                  signal.signal === "SELL" ? "destructive" : "secondary"
                                }
                              >
                                {signal.signal}
                              </Badge>
                              <Badge variant="outline">
                                {signal.confidence}% confidence
                              </Badge>
                            </div>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground">
                            {signal.reasoning}
                          </p>

                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <Label className="font-medium">Entry Price</Label>
                              <p>{signal.entryPrice}</p>
                            </div>
                            <div>
                              <Label className="font-medium">Current Price</Label>
                              <p>${asNumber(signal.currentPrice).toFixed(2)}</p>
                            </div>
                            <div>
                              <Label className="font-medium">Stop Loss</Label>
                              <p>{signal.stopLoss}</p>
                            </div>
                            <div>
                              <Label className="font-medium">Take Profit</Label>
                              <p>{signal.takeProfit}</p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-sm">
                            <span>
                              <Label className="font-medium">Timeframe:</Label> {signal.timeframe}
                            </span>
                            <span>
                              <Label className="font-medium">Change:</Label>{" "}
                              <span className={asNumber(signal.changePercent) >= 0 ? "text-green-600" : "text-red-600"}>
                                {asNumber(signal.changePercent) >= 0 ? "+" : ""}{asNumber(signal.changePercent).toFixed(2)}%
                              </span>
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="portfolio" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChart className="h-5 w-5" />
                  Portfolio Optimization
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="accountSize">Account Size</Label>
                    <Input
                      id="accountSize"
                      placeholder="10000"
                      value={accountSize}
                      onChange={(e) => setAccountSize(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="riskTolerance">Risk Tolerance</Label>
                    <Select value={riskTolerance} onValueChange={(value: any) => setRiskTolerance(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="conservative">Conservative</SelectItem>
                        <SelectItem value="moderate">Moderate</SelectItem>
                        <SelectItem value="aggressive">Aggressive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Target Symbols (optional)</Label>
                  <Input
                    placeholder="AAPL, MSFT, TSLA"
                    value={portfolioSymbols.join(", ")}
                    onChange={(e) => setPortfolioSymbols(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                  />
                </div>

                <Button onClick={handlePortfolioOptimization} disabled={portfolioOptimization.isFetching}>
                  {portfolioOptimization.isFetching ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Optimizing...
                    </>
                  ) : (
                    <>
                      <PieChart className="h-4 w-4 mr-2" />
                      Optimize Portfolio
                    </>
                  )}
                </Button>

                {portfolioOptimization.data && (
                  <div className="space-y-6 mt-6">
                    <div className="grid grid-cols-3 gap-4">
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold">{asNumber(portfolioOptimization.data.diversificationScore)}/10</div>
                          <p className="text-xs text-muted-foreground">Diversification Score</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold">{portfolioOptimization.data.totalRisk}</div>
                          <p className="text-xs text-muted-foreground">Risk Level</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold">${asNumber(portfolioOptimization.data.riskPerTrade).toFixed(2)}</div>
                          <p className="text-xs text-muted-foreground">Risk per Trade</p>
                        </CardContent>
                      </Card>
                    </div>

                    {recommendedAllocations.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle>Recommended Allocations</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {recommendedAllocations.map((alloc: any) => (
                              <div key={alloc.symbol} className="flex items-center justify-between p-3 border rounded">
                                <div>
                                  <div className="font-medium">{alloc.symbol}</div>
                                  <div className="text-sm text-muted-foreground">{alloc.reasoning}</div>
                                </div>
                                <div className="text-right">
                                  <div className="font-medium">{asNumber(alloc.allocationPercent).toFixed(1)}%</div>
                                  <div className="text-sm text-muted-foreground">
                                    ${asNumber(alloc.positionSize).toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {rebalancingActions.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle>Rebalancing Actions</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ul className="space-y-2">
                            {rebalancingActions.map((action: string, index: number) => (
                              <li key={index} className="flex items-start gap-2">
                                <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-500" />
                                <span className="text-sm">{action}</span>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
