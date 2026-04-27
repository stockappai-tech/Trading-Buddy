import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Bell, BarChart2, CheckCircle2, Crown, Plus, Settings as SettingsIcon, Shield, Trash2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function Settings() {
  const [, navigate] = useLocation();
  const { data: prefs, isLoading } = trpc.preferences.get.useQuery();
  const { data: alerts } = trpc.alerts.list.useQuery();

  const [accountSize, setAccountSize] = useState("");
  const [riskPerTrade, setRiskPerTrade] = useState("");
  const [maxDailyLoss, setMaxDailyLoss] = useState("");
  const [tradingStyle, setTradingStyle] = useState<"scalper" | "day_trader" | "swing_trader" | "position_trader" | "options_trader">("day_trader");
  const [experienceLevel, setExperienceLevel] = useState<"beginner" | "intermediate" | "advanced" | "professional">("intermediate");
  const [mainWeakness, setMainWeakness] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [favoriteTickers, setFavoriteTickers] = useState("");
  const [coachStrictness, setCoachStrictness] = useState<"gentle" | "balanced" | "strict">("balanced");
  const [coachMode, setCoachMode] = useState<"sergeant" | "friend" | "expert">("friend");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [tradierAccountId, setTradierAccountId] = useState("");
  const [tradierToken, setTradierToken] = useState("");

  // Alert form
  const [alertSymbol, setAlertSymbol] = useState("");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertType, setAlertType] = useState<"above" | "below" | "stop_loss" | "take_profit">("above");

  useEffect(() => {
    if (prefs) {
      setAccountSize(prefs.accountSize ?? "");
      setRiskPerTrade(prefs.riskPerTrade ?? "");
      setMaxDailyLoss(prefs.maxDailyLoss ?? "");
      setTradingStyle((prefs.tradingStyle as typeof tradingStyle) ?? "day_trader");
      setExperienceLevel((prefs.experienceLevel as typeof experienceLevel) ?? "intermediate");
      setMainWeakness(prefs.mainWeakness ?? "");
      setPrimaryGoal(prefs.primaryGoal ?? "");
      setFavoriteTickers(prefs.favoriteTickers ?? "");
      setCoachStrictness((prefs.coachStrictness as typeof coachStrictness) ?? "balanced");
      setCoachMode((prefs.coachMode as any) ?? "friend");
      setNotificationsEnabled(prefs.notificationsEnabled ?? true);
      setTradierAccountId(prefs.tradierAccountId ?? "");
      setTradierToken(prefs.tradierToken ?? "");
    }
  }, [prefs]);

  const utils = trpc.useUtils();
  const updatePrefs = trpc.preferences.update.useMutation({
    onSuccess: () => { utils.preferences.get.invalidate(); toast.success("Settings saved"); },
    onError: (e) => toast.error(e.message),
  });

  const createAlert = trpc.alerts.create.useMutation({
    onSuccess: () => { utils.alerts.list.invalidate(); setAlertSymbol(""); setAlertPrice(""); toast.success("Alert created"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteAlert = trpc.alerts.delete.useMutation({
    onSuccess: () => utils.alerts.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const validateBroker = trpc.broker.validateConnection.useQuery(undefined, {
    enabled: false,
  });

  const handleSave = () => {
    updatePrefs.mutate({
      accountSize,
      riskPerTrade,
      maxDailyLoss,
      tradingStyle,
      experienceLevel,
      mainWeakness,
      primaryGoal,
      favoriteTickers,
      coachStrictness,
      coachMode,
      notificationsEnabled,
      tradierAccountId,
      tradierToken,
    });
  };

  const handleAddAlert = () => {
    if (!alertSymbol || !alertPrice) { toast.error("Symbol and price are required"); return; }
    createAlert.mutate({ symbol: alertSymbol.toUpperCase(), targetPrice: alertPrice, alertType });
  };

  if (isLoading) return <DashboardLayout><div className="p-6 text-muted-foreground">Loading...</div></DashboardLayout>;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">Configure your trading journal preferences</p>
        </div>

        {/* Market Data — included for paying members */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary" /> Live Market Data
            </CardTitle>
          </CardHeader>
          <CardContent>
            {prefs?.isPremium ? (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-[oklch(0.65_0.18_160)]/10 border border-[oklch(0.65_0.18_160)]/20">
                <CheckCircle2 className="h-5 w-5 text-[oklch(0.65_0.18_160)] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Real-time quotes included</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Your Pro/Elite plan includes live stock quotes, market news, and real-time P&amp;L — no extra setup needed. Data is powered by Finnhub.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {["Live US Quotes", "Company News", "Real-time P&L", "Watchlist Data"].map((f) => (
                      <Badge key={f} variant="outline" className="text-xs border-[oklch(0.65_0.18_160)]/40 text-[oklch(0.65_0.18_160)]">
                        {f}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30 border border-border">
                <BarChart2 className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Upgrade for live market data</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Pro and Elite members get real-time stock quotes, live P&amp;L tracking, and market news — all included, no API keys required.
                  </p>
                  <Button
                    size="sm"
                    onClick={() => navigate("/upgrade")}
                    className="mt-3 bg-yellow-500 text-black hover:bg-yellow-400 h-7 text-xs"
                  >
                    <Crown className="h-3 w-3 mr-1" /> Upgrade to Pro
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Trading Preferences */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <SettingsIcon className="h-4 w-4 text-primary" /> Trading Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Account Size ($)</label>
                <Input type="number" value={accountSize} onChange={(e) => setAccountSize(e.target.value)} placeholder="25000" className="bg-input border-border text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Risk Per Trade (%)</label>
                <Input type="number" value={riskPerTrade} onChange={(e) => setRiskPerTrade(e.target.value)} placeholder="1.0" className="bg-input border-border text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Max Daily Loss ($)</label>
                <Input type="number" value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(e.target.value)} placeholder="500" className="bg-input border-border text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Coach Strictness</label>
                <Select value={coachStrictness} onValueChange={(v) => setCoachStrictness(v as typeof coachStrictness)}>
                  <SelectTrigger className="bg-input border-border text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="gentle">Gentle</SelectItem>
                    <SelectItem value="balanced">Balanced</SelectItem>
                    <SelectItem value="strict">Strict</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Trading Style</label>
                <Select value={tradingStyle} onValueChange={(v) => setTradingStyle(v as typeof tradingStyle)}>
                  <SelectTrigger className="bg-input border-border text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="scalper">Scalper</SelectItem>
                    <SelectItem value="day_trader">Day Trader</SelectItem>
                    <SelectItem value="swing_trader">Swing Trader</SelectItem>
                    <SelectItem value="position_trader">Position Trader</SelectItem>
                    <SelectItem value="options_trader">Options Trader</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Experience Level</label>
                <Select value={experienceLevel} onValueChange={(v) => setExperienceLevel(v as typeof experienceLevel)}>
                  <SelectTrigger className="bg-input border-border text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Main Weakness</label>
              <Input value={mainWeakness} onChange={(e) => setMainWeakness(e.target.value)} placeholder="Revenge trading after losses" className="bg-input border-border text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Primary Goal</label>
              <Input value={primaryGoal} onChange={(e) => setPrimaryGoal(e.target.value)} placeholder="Stay disciplined and grow consistency" className="bg-input border-border text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Favorite Tickers</label>
              <Input value={favoriteTickers} onChange={(e) => setFavoriteTickers(e.target.value.toUpperCase())} placeholder="AAPL, NVDA, TSLA" className="bg-input border-border text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Default AI Coach Mode</label>
              <Select value={coachMode} onValueChange={(v) => setCoachMode(v as any)}>
                <SelectTrigger className="bg-input border-border text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="sergeant">🎖️ Tough Sergeant</SelectItem>
                  <SelectItem value="friend">🤝 Supportive Friend</SelectItem>
                  <SelectItem value="expert">📊 Expert Companion</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Notifications</p>
                <p className="text-xs text-muted-foreground">Alert me when price targets are hit</p>
              </div>
              <Switch checked={notificationsEnabled} onCheckedChange={setNotificationsEnabled} />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Brokerage Integration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Tradier Account ID</label>
                <Input
                  value={tradierAccountId}
                  onChange={(e) => setTradierAccountId(e.target.value)}
                  placeholder="12345"
                  className="bg-input border-border text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Tradier API Token</label>
                <Input
                  type="password"
                  value={tradierToken}
                  onChange={(e) => setTradierToken(e.target.value)}
                  placeholder="••••••••••"
                  className="bg-input border-border text-sm"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Button
                size="sm"
                onClick={() => validateBroker.refetch()}
                disabled={validateBroker.isFetching}
                className="bg-primary text-primary-foreground h-8 text-xs"
              >
                {validateBroker.isFetching ? "Checking..." : "Validate Connection"}
              </Button>
              {validateBroker.data && (
                <span className={`text-xs ${validateBroker.data.connected ? "text-emerald-400" : "text-destructive"}`}>
                  {validateBroker.data.message}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Enter your Tradier API token and account ID to enable automated order execution and broker sync.
            </p>
          </CardContent>
        </Card>

        {/* Price Alerts */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" /> Price Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Input
                value={alertSymbol}
                onChange={(e) => setAlertSymbol(e.target.value.toUpperCase())}
                placeholder="AAPL"
                className="bg-input border-border text-sm"
              />
              <Input
                type="number"
                value={alertPrice}
                onChange={(e) => setAlertPrice(e.target.value)}
                placeholder="Price"
                className="bg-input border-border text-sm"
              />
              <Select value={alertType} onValueChange={(v) => setAlertType(v as any)}>
                <SelectTrigger className="bg-input border-border text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="above">Above</SelectItem>
                  <SelectItem value="below">Below</SelectItem>
                  <SelectItem value="take_profit">Take Profit</SelectItem>
                  <SelectItem value="stop_loss">Stop Loss</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleAddAlert} disabled={createAlert.isPending} className="bg-primary text-primary-foreground h-8 text-xs">
              <Plus className="h-3 w-3 mr-1" /> Add Alert
            </Button>

            {alerts && alerts.length > 0 && (
              <div className="space-y-2 mt-2">
                {alerts.map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm">{alert.symbol}</span>
                      <Badge variant="outline" className={`text-xs ${alert.triggered ? "border-muted text-muted-foreground" : "border-primary text-primary"}`}>
                        {alert.alertType.replace("_", " ")} ${parseFloat(alert.targetPrice).toFixed(2)}
                      </Badge>
                      {alert.triggered && <Badge variant="outline" className="text-xs border-muted text-muted-foreground">Triggered</Badge>}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => deleteAlert.mutate({ id: alert.id })} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Account Status */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> Account Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Current Plan</p>
                <p className="text-xs text-muted-foreground">
                  {prefs?.isPremium ? "Full access to all features" : "Limited to basic features"}
                </p>
              </div>
              {prefs?.isPremium ? (
                <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">
                  <Crown className="h-3 w-3 mr-1" /> Pro
                </Badge>
              ) : (
                <Button size="sm" onClick={() => navigate("/upgrade")} className="bg-yellow-500 text-black hover:bg-yellow-400 h-8 text-xs">
                  <Crown className="h-3 w-3 mr-1" /> Upgrade to Pro
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={updatePrefs.isPending} className="bg-primary text-primary-foreground w-full">
          {updatePrefs.isPending ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </DashboardLayout>
  );
}
