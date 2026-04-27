import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

const AICoach = lazy(() => import("./pages/AICoach"));
const AITradingAssistant = lazy(() => import("./pages/AITradingAssistant"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Automation = lazy(() => import("./pages/Automation"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const DailyPlan = lazy(() => import("./pages/DailyPlan"));
const Home = lazy(() => import("./pages/Home"));
const MarketData = lazy(() => import("./pages/MarketData"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Sessions = lazy(() => import("./pages/Sessions"));
const Settings = lazy(() => import("./pages/Settings"));
const TradeHistory = lazy(() => import("./pages/TradeHistory"));
const Upgrade = lazy(() => import("./pages/Upgrade"));
const VoiceRecording = lazy(() => import("./pages/VoiceRecording"));

function RouteFallback() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/plan" component={DailyPlan} />
        <Route path="/record" component={VoiceRecording} />
        <Route path="/history" component={TradeHistory} />
        <Route path="/coach" component={AICoach} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/settings" component={Settings} />
        <Route path="/automation" component={Automation} />
        <Route path="/upgrade" component={Upgrade} />
        <Route path="/sessions" component={Sessions} />
        <Route path="/ai-assistant" component={AITradingAssistant} />
        <Route path="/market-data" component={MarketData} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster theme="dark" position="top-right" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
