import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Dashboard from "./pages/Dashboard";
import TradeHistory from "./pages/TradeHistory";
import VoiceRecording from "./pages/VoiceRecording";
import AICoach from "./pages/AICoach";
import Analytics from "./pages/Analytics";
import MarketData from "./pages/MarketData";
import Settings from "./pages/Settings";
import Upgrade from "./pages/Upgrade";
import Sessions from "./pages/Sessions";
import Automation from "./pages/Automation";
import Home from "./pages/Home";
import AITradingAssistant from "./pages/AITradingAssistant";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
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
