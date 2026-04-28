import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { CalendarCheck, CheckCircle2, ClipboardCheck, RotateCcw, ShieldAlert, Target, TimerReset } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export const PLAN_STORAGE_KEY = "trading_buddy_daily_plan";

export type PlanState = {
  date: string;
  marketBias: string;
  focusTickers: string;
  keyLevels: string;
  aPlusSetup: string;
  noTradeRules: string;
  maxLoss: string;
  maxTrades: string;
  preMarketChecks: string[];
  executionChecks: string[];
  postMarketRecap: string;
};

const PRE_MARKET_CHECKS = [
  "Reviewed overnight news and major market catalysts",
  "Marked key levels before the open",
  "Defined A+ setup and invalidation",
  "Confirmed max daily loss before trading",
  "Checked emotional state before first trade",
];

const EXECUTION_CHECKS = [
  "Trade matches the planned setup",
  "Stop loss is defined before entry",
  "Risk/reward is acceptable",
  "Position size respects risk limit",
  "No revenge trade or FOMO entry",
];

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function createDefaultPlan(maxLoss = ""): PlanState {
  return {
    date: todayKey(),
    marketBias: "",
    focusTickers: "",
    keyLevels: "",
    aPlusSetup: "",
    noTradeRules: "",
    maxLoss,
    maxTrades: "3",
    preMarketChecks: [],
    executionChecks: [],
    postMarketRecap: "",
  };
}

export function loadPlan(maxLoss = "") {
  try {
    const raw = window.localStorage.getItem(PLAN_STORAGE_KEY);
    if (!raw) return createDefaultPlan(maxLoss);
    const parsed = JSON.parse(raw) as PlanState;
    return parsed.date === todayKey() ? { ...createDefaultPlan(maxLoss), ...parsed } : createDefaultPlan(maxLoss);
  } catch {
    return createDefaultPlan(maxLoss);
  }
}

export default function DailyPlan() {
  const { data: prefs } = trpc.preferences.get.useQuery();
  const profileMaxLoss = prefs?.maxDailyLoss ?? "";
  const [plan, setPlan] = useState<PlanState>(() => loadPlan());

  useEffect(() => {
    if (!plan.maxLoss && profileMaxLoss) {
      setPlan((prev) => ({ ...prev, maxLoss: profileMaxLoss }));
    }
  }, [profileMaxLoss, plan.maxLoss]);

  useEffect(() => {
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
  }, [plan]);

  const completion = useMemo(() => {
    const total = PRE_MARKET_CHECKS.length + EXECUTION_CHECKS.length;
    const done = plan.preMarketChecks.length + plan.executionChecks.length;
    return Math.round((done / total) * 100);
  }, [plan.executionChecks.length, plan.preMarketChecks.length]);

  const isReady = completion >= 80 && plan.aPlusSetup.trim() && plan.maxLoss.trim();

  const toggleCheck = (field: "preMarketChecks" | "executionChecks", item: string) => {
    setPlan((prev) => {
      const current = new Set(prev[field]);
      if (current.has(item)) current.delete(item);
      else current.add(item);
      return { ...prev, [field]: Array.from(current) };
    });
  };

  const resetPlan = () => {
    setPlan(createDefaultPlan(profileMaxLoss));
    toast.success("Daily plan reset");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <CalendarCheck className="h-6 w-6 text-primary" />
              Daily Trading Plan
            </h1>
            <p className="text-sm text-muted-foreground">Define the day before the market defines you.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={isReady ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-yellow-500/15 text-yellow-500 border-yellow-500/30"}>
              {isReady ? "Ready to Trade" : "Plan Incomplete"}
            </Badge>
            <Button size="sm" variant="outline" onClick={resetPlan} className="h-8 border-border text-xs">
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
          <div className="space-y-6">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  Pre-Market Plan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Market Bias</label>
                    <Input value={plan.marketBias} onChange={(e) => setPlan({ ...plan, marketBias: e.target.value })} placeholder="Bullish above SPY 510" className="bg-input border-border text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Focus Tickers</label>
                    <Input value={plan.focusTickers} onChange={(e) => setPlan({ ...plan, focusTickers: e.target.value.toUpperCase() })} placeholder="NVDA, AAPL, TSLA" className="bg-input border-border text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Key Levels</label>
                  <Textarea value={plan.keyLevels} onChange={(e) => setPlan({ ...plan, keyLevels: e.target.value })} placeholder="SPY 510 support, 515 resistance. NVDA watch 900 breakout." className="bg-input border-border text-sm min-h-20" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">A+ Setup Only</label>
                  <Textarea value={plan.aPlusSetup} onChange={(e) => setPlan({ ...plan, aPlusSetup: e.target.value })} placeholder="Opening range breakout with volume confirmation and clean stop under structure." className="bg-input border-border text-sm min-h-20" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">No-Trade Rules</label>
                  <Textarea value={plan.noTradeRules} onChange={(e) => setPlan({ ...plan, noTradeRules: e.target.value })} placeholder="No trades after two losses. No trades in first 5 minutes unless setup is perfect." className="bg-input border-border text-sm min-h-20" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-primary" />
                  Post-Market Recap
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea value={plan.postMarketRecap} onChange={(e) => setPlan({ ...plan, postMarketRecap: e.target.value })} placeholder="What did I follow? What did I violate? What is the one fix for tomorrow?" className="bg-input border-border text-sm min-h-28" />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-primary" />
                  Risk Guardrails
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Max Daily Loss</label>
                    <Input type="number" value={plan.maxLoss} onChange={(e) => setPlan({ ...plan, maxLoss: e.target.value })} placeholder="500" className="bg-input border-border text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Max Trades</label>
                    <Input type="number" value={plan.maxTrades} onChange={(e) => setPlan({ ...plan, maxTrades: e.target.value })} placeholder="3" className="bg-input border-border text-sm" />
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-3">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-muted-foreground">Discipline readiness</span>
                    <span className="font-semibold text-foreground">{completion}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-background overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${completion}%` }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TimerReset className="h-4 w-4 text-primary" />
                  Pre-Market Checklist
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {PRE_MARKET_CHECKS.map((item) => {
                  const checked = plan.preMarketChecks.includes(item);
                  return (
                    <button key={item} onClick={() => toggleCheck("preMarketChecks", item)} className="w-full flex items-start gap-2 text-left rounded-md border border-border bg-secondary/20 p-2 hover:bg-secondary/40 transition-colors">
                      <CheckCircle2 className={`h-4 w-4 mt-0.5 ${checked ? "text-emerald-400" : "text-muted-foreground/50"}`} />
                      <span className={`text-xs ${checked ? "text-foreground" : "text-muted-foreground"}`}>{item}</span>
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-primary" />
                  Trade Entry Checklist
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {EXECUTION_CHECKS.map((item) => {
                  const checked = plan.executionChecks.includes(item);
                  return (
                    <button key={item} onClick={() => toggleCheck("executionChecks", item)} className="w-full flex items-start gap-2 text-left rounded-md border border-border bg-secondary/20 p-2 hover:bg-secondary/40 transition-colors">
                      <CheckCircle2 className={`h-4 w-4 mt-0.5 ${checked ? "text-emerald-400" : "text-muted-foreground/50"}`} />
                      <span className={`text-xs ${checked ? "text-foreground" : "text-muted-foreground"}`}>{item}</span>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
