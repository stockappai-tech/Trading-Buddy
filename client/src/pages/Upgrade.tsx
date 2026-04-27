import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  BarChart3, Bot, Brain, Calendar, Check, Crown, FileText,
  Flame, Shield, Sparkles, Star, TrendingUp, Volume2, X, Zap
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

// ─── Tier definitions ────────────────────────────────────────────────────────

const TIERS = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Try everything free",
    price: "$0",
    period: "30 days",
    subtext: "No credit card required",
    badge: null,
    badgeColor: "",
    borderColor: "border-border",
    headerGradient: "",
    ctaLabel: "Start Free Trial",
    ctaClass: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    ctaDisabled: true,
    ctaNote: "Your current plan",
    features: [
      { icon: Volume2,   text: "Voice journaling & AI trade extraction" },
      { icon: BarChart3, text: "Dashboard with P&L, win rate & analytics" },
      { icon: Bot,       text: "Basic AI Coach (Friend mode)" },
      { icon: TrendingUp,text: "Up to 30 trades per month" },
      { icon: FileText,  text: "Trade history & manual entry" },
      { icon: Zap,       text: "Market news feed" },
    ],
    locked: [
      "Advanced coach personalities",
      "Unlimited trades",
      "Discipline Score per trade",
      "Pattern & behavior alerts",
      "Weekly AI report",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For serious traders",
    price: "$29",
    period: "/ month",
    subtext: "Cancel anytime",
    badge: "Most Popular",
    badgeColor: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
    borderColor: "border-yellow-500/40",
    headerGradient: "from-yellow-500 to-yellow-300",
    ctaLabel: "Upgrade to Pro",
    ctaClass: "bg-yellow-500 text-black hover:bg-yellow-400 font-semibold",
    ctaDisabled: false,
    ctaNote: "No contracts. Cancel anytime.",
    features: [
      { icon: Bot,       text: "All 3 AI Coach personalities + voice TTS" },
      { icon: BarChart3, text: "Unlimited trades & full analytics" },
      { icon: TrendingUp,text: "Real-time Tradier quotes & live P&L" },
      { icon: Zap,       text: "Price alerts & push notifications" },
      { icon: Flame,     text: "Trade streak tracker & daily briefing" },
      { icon: Star,      text: "Performance badges & milestones" },
      { icon: FileText,  text: "Session PDF export" },
      { icon: Calendar,  text: "Emotional heatmap calendar" },
      { icon: Shield,    text: "Priority support" },
    ],
    locked: [
      "AI Discipline Score per trade",
      "Behavioral pattern alerts",
      "Weekly AI performance report",
      "Trade replay timeline",
    ],
  },
  {
    id: "elite",
    name: "Elite",
    tagline: "The unfair advantage",
    price: "$79",
    period: "/ month",
    subtext: "Everything in Pro, plus",
    badge: "Best Results",
    badgeColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    borderColor: "border-purple-500/40",
    headerGradient: "from-purple-500 to-blue-400",
    ctaLabel: "Go Elite",
    ctaClass: "bg-gradient-to-r from-purple-600 to-blue-500 text-white hover:opacity-90 font-semibold",
    ctaDisabled: false,
    ctaNote: "For traders who want an edge.",
    features: [
      { icon: Brain,     text: "AI Discipline Score on every trade (1–10)" },
      { icon: Sparkles,  text: "Behavioral pattern detection & alerts" },
      { icon: BarChart3, text: "Weekly AI performance report (email + in-app)" },
      { icon: TrendingUp,text: "Trade replay timeline with price chart" },
      { icon: Bot,       text: "Personalized rule-breaking analysis" },
      { icon: Star,      text: "Elite badge & early access to new features" },
      { icon: Shield,    text: "Dedicated support & onboarding call" },
    ],
    locked: [],
  },
];

// ─── Comparison table rows ────────────────────────────────────────────────────

const COMPARISON = [
  { feature: "Voice journaling",              starter: true,  pro: true,  elite: true  },
  { feature: "AI trade extraction",           starter: true,  pro: true,  elite: true  },
  { feature: "Dashboard & analytics",         starter: true,  pro: true,  elite: true  },
  { feature: "Trades per month",              starter: "30",  pro: "∞",   elite: "∞"   },
  { feature: "AI Coach personalities",        starter: "1",   pro: "3",   elite: "3"   },
  { feature: "Coach voice (TTS)",             starter: false, pro: true,  elite: true  },
  { feature: "Real-time quotes",              starter: false, pro: true,  elite: true  },
  { feature: "Price alerts",                  starter: false, pro: true,  elite: true  },
  { feature: "Trade streak & badges",         starter: false, pro: true,  elite: true  },
  { feature: "Emotional heatmap",             starter: false, pro: true,  elite: true  },
  { feature: "PDF export",                    starter: false, pro: true,  elite: true  },
  { feature: "AI Discipline Score",           starter: false, pro: false, elite: true  },
  { feature: "Behavioral pattern alerts",     starter: false, pro: false, elite: true  },
  { feature: "Weekly AI report",              starter: false, pro: false, elite: true  },
  { feature: "Trade replay timeline",         starter: false, pro: false, elite: true  },
  { feature: "Onboarding call",               starter: false, pro: false, elite: true  },
];

function Cell({ value }: { value: boolean | string }) {
  if (typeof value === "string") return <span className="text-sm font-semibold text-foreground">{value}</span>;
  return value
    ? <Check className="h-4 w-4 text-green-500 mx-auto" />
    : <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Upgrade() {
  const [, navigate] = useLocation();
  const { data: prefs } = trpc.preferences.get.useQuery();
  const utils = trpc.useUtils();

  const updatePrefs = trpc.preferences.update.useMutation({
    onSuccess: (_, vars) => {
      utils.preferences.get.invalidate();
      const tier = vars.isPremium ? "Pro" : "Starter";
      toast.success(`🎉 Welcome to Trading Buddy AI ${tier}!`);
      navigate("/dashboard");
    },
  });

  const handleUpgrade = (tierId: string) => {
    if (tierId === "starter") return;
    // In production: redirect to Stripe checkout
    // For now: activate premium directly (demo mode)
    updatePrefs.mutate({ isPremium: true });
  };

  if (prefs?.isPremium) {
    return (
      <DashboardLayout>
        <div className="p-6 max-w-lg mx-auto text-center space-y-6 pt-16">
          <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto">
            <Crown className="h-8 w-8 text-yellow-500" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">You're already Pro!</h1>
          <p className="text-muted-foreground">You have full access to all Trading Buddy AI features. Want to go Elite?</p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => navigate("/dashboard")} className="border-border">
              Back to Dashboard
            </Button>
            <Button
              onClick={() => toast.info("Elite upgrade coming soon — stay tuned!")}
              className="bg-gradient-to-r from-purple-600 to-blue-500 text-white"
            >
              <Sparkles className="h-4 w-4 mr-1" /> Go Elite
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-10">

        {/* Hero */}
        <div className="text-center space-y-3">
          <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30 text-sm px-3 py-1">
            <Crown className="h-3.5 w-3.5 mr-1 inline" /> Trading Buddy AI
          </Badge>
          <h1 className="text-4xl font-bold text-foreground">
            The journal that makes you a{" "}
            <span className="text-yellow-500">better trader</span>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Start free for 30 days. No credit card. Upgrade when you're ready to unlock your full edge.
          </p>
        </div>

        {/* Tier Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TIERS.map((tier) => (
            <Card key={tier.id} className={`bg-card ${tier.borderColor} relative overflow-hidden flex flex-col`}>
              {tier.headerGradient && (
                <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${tier.headerGradient}`} />
              )}
              <CardContent className="p-6 flex flex-col flex-1">
                {/* Header */}
                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-xl text-foreground">{tier.name}</h3>
                    {tier.badge && (
                      <Badge className={`text-xs ${tier.badgeColor}`}>{tier.badge}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{tier.tagline}</p>
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-bold text-foreground">{tier.price}</span>
                    <span className="text-sm text-muted-foreground mb-1">{tier.period}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{tier.subtext}</p>
                </div>

                {/* Included features */}
                <ul className="space-y-2.5 flex-1">
                  {tier.features.map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-start gap-2 text-sm text-foreground">
                      <Icon className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                      {text}
                    </li>
                  ))}
                  {tier.locked.map((text) => (
                    <li key={text} className="flex items-start gap-2 text-sm text-muted-foreground/50 line-through">
                      <X className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      {text}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="mt-6">
                  <Button
                    onClick={() => handleUpgrade(tier.id)}
                    disabled={tier.ctaDisabled || updatePrefs.isPending}
                    className={`w-full ${tier.ctaClass}`}
                  >
                    {updatePrefs.isPending && !tier.ctaDisabled ? "Activating..." : tier.ctaLabel}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center mt-2">{tier.ctaNote}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Comparison Table */}
        <div>
          <h2 className="text-xl font-bold text-foreground mb-4 text-center">Full Feature Comparison</h2>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-card border-b border-border">
                  <th className="text-left p-3 text-muted-foreground font-medium w-1/2">Feature</th>
                  <th className="text-center p-3 text-foreground font-semibold">Starter</th>
                  <th className="text-center p-3 text-yellow-500 font-semibold">Pro</th>
                  <th className="text-center p-3 text-purple-400 font-semibold">Elite</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr key={row.feature} className={i % 2 === 0 ? "bg-card/50" : "bg-card"}>
                    <td className="p-3 text-muted-foreground">{row.feature}</td>
                    <td className="p-3 text-center"><Cell value={row.starter} /></td>
                    <td className="p-3 text-center"><Cell value={row.pro} /></td>
                    <td className="p-3 text-center"><Cell value={row.elite} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Social proof / FAQ teaser */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
          {[
            { stat: "30 days", label: "Free trial, no card needed" },
            { stat: "< 60 sec", label: "To log a trade by voice" },
            { stat: "Cancel", label: "Anytime, no questions asked" },
          ].map(({ stat, label }) => (
            <div key={stat} className="p-4 rounded-xl border border-border bg-card/50">
              <p className="text-2xl font-bold text-foreground">{stat}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Questions?{" "}
            <button onClick={() => navigate("/coach")} className="text-primary underline">
              Ask the AI Coach
            </button>
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
