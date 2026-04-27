import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { BarChart3, Bot, Mic, Shield, TrendingUp, Zap } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";

export default function Home() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && user) navigate("/dashboard");
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-6 w-6 text-primary animate-pulse" />
          <span className="text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  const features = [
    { icon: Mic, title: "Voice Recording", desc: "Capture trades naturally with voice — AI extracts symbols, prices & PnL automatically." },
    { icon: Bot, title: "AI Trading Coach", desc: "Choose your coach style: Tough Sergeant, Supportive Friend, or Expert Companion." },
    { icon: TrendingUp, title: "Live Market Data", desc: "Real-time quotes via Tradier Brokerage with live PnL on open positions." },
    { icon: BarChart3, title: "Deep Analytics", desc: "Win/loss ratios, time-of-day heatmaps, symbol performance & pattern analysis." },
    { icon: Zap, title: "Smart Alerts", desc: "Get notified when positions hit profit targets or stop losses automatically." },
    { icon: Shield, title: "Secure & Private", desc: "Your trading data stays private with enterprise-grade security." },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <TrendingUp className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-lg">Trading Buddy AI</span>
        </div>
        <Button onClick={() => (window.location.href = getLoginUrl())} className="bg-primary text-primary-foreground hover:bg-primary/90">
          Get Started
        </Button>
      </header>

      {/* Hero */}
      <section className="px-6 py-20 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-6">
          <span className="w-2 h-2 rounded-full bg-primary live-dot" />
          Powered by AI + Tradier Brokerage
        </div>
        <h1 className="text-5xl font-bold mb-6 leading-tight">
          Your AI-Powered
          <br />
          <span className="text-primary">Trading Journal</span>
        </h1>
        <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
          Record sessions with your voice, get AI coaching, track real-time PnL, and uncover patterns that make you a better trader.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Button
            size="lg"
            onClick={() => navigate("/dashboard")}
            className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 h-12 text-base"
          >
            Start Free Today
          </Button>
          <Button size="lg" variant="outline" className="border-border text-foreground hover:bg-accent px-8 h-12 text-base">
            View Demo
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-16 max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-12">Everything you need to trade smarter</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className="p-6 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-16 text-center border-t border-border">
        <h2 className="text-3xl font-bold mb-4">Ready to level up your trading?</h2>
        <p className="text-muted-foreground mb-8">Join traders who use AI to stay disciplined and profitable.</p>
        <Button
          size="lg"
          onClick={() => (window.location.href = getLoginUrl())}
          className="bg-primary text-primary-foreground hover:bg-primary/90 px-10 h-12"
        >
          Sign In with Manus
        </Button>
      </section>

      <footer className="border-t border-border px-6 py-6 text-center text-sm text-muted-foreground">
        © 2025 Trading Buddy AI. Built with Tradier Brokerage API.
      </footer>
    </div>
  );
}
