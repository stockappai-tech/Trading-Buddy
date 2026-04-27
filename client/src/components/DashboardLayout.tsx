import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  BarChart3,
  Bot,
  Brain,
  Crown,
  FileText,
  LayoutDashboard,
  LogOut,
  Mic,
  Settings,
  History,
  TrendingUp,
  Bell,
  TrendingDown,
  Zap,
} from "lucide-react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: Mic, label: "Record Session", path: "/record" },
  { icon: History, label: "Trade History", path: "/history" },
  { icon: Bot, label: "AI Coach", path: "/coach", premium: true },
  { icon: Brain, label: "AI Trading Assistant", path: "/ai-assistant", premium: true },
  { icon: Zap, label: "Automation", path: "/automation", premium: true },
  { icon: TrendingDown, label: "Market Data", path: "/market-data" },
  { icon: BarChart3, label: "Analytics", path: "/analytics" },
  { icon: FileText, label: "Watchlist & News", path: "/sessions" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const [location, navigate] = useLocation();
  const { data: prefs } = trpc.preferences.get.useQuery(undefined, { enabled: !!user });

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 mb-6">
            <TrendingUp className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold text-foreground">Trading Buddy AI</span>
          </div>
          <p className="text-muted-foreground">Sign in to access your trading journal</p>
          <Button onClick={() => (window.location.href = getLoginUrl())} className="bg-primary text-primary-foreground">
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  const initials = user.name
    ? user.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "TB";

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar className="border-r border-border bg-sidebar" collapsible="icon">
          <SidebarHeader className="p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
                <TrendingUp className="h-4 w-4 text-primary-foreground" />
              </div>
              <div className="group-data-[collapsible=icon]:hidden">
                <p className="font-bold text-sm text-foreground">Trading Buddy</p>
                <p className="text-xs text-muted-foreground">AI Journal</p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className="px-2 py-4">
            <SidebarMenu className="space-y-1">
              {menuItems.map((item) => {
                const isActive = location === item.path || (item.path === "/dashboard" && location === "/");
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      onClick={() => navigate(item.path)}
                      isActive={isActive}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
                        isActive
                          ? "bg-primary/20 text-primary border border-primary/30"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                    >
                      <item.icon className="h-4 w-4 flex-shrink-0" />
                      <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                      {item.premium && !prefs?.isPremium && (
                        <Crown className="h-3 w-3 text-yellow-500 ml-auto group-data-[collapsible=icon]:hidden" />
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>

            {!prefs?.isPremium && (
              <div className="mt-6 mx-2 group-data-[collapsible=icon]:hidden">
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Crown className="h-4 w-4 text-yellow-500" />
                    <span className="text-xs font-semibold text-yellow-500">Upgrade to Pro</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">Unlock AI Coach, pattern analysis & more</p>
                  <Button
                    size="sm"
                    className="w-full h-7 text-xs bg-yellow-500 text-black hover:bg-yellow-400"
                    onClick={() => navigate("/upgrade")}
                  >
                    Upgrade Now
                  </Button>
                </div>
              </div>
            )}
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-accent transition-colors">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="group-data-[collapsible=icon]:hidden text-left flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{user.name ?? "Trader"}</p>
                    {prefs?.isPremium && (
                      <Badge className="text-[10px] h-4 px-1 bg-yellow-500/20 text-yellow-500 border-yellow-500/30">Pro</Badge>
                    )}
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-popover border-border">
                <DropdownMenuItem onClick={() => navigate("/settings")} className="text-foreground hover:bg-accent">
                  <Settings className="h-4 w-4 mr-2" /> Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    await fetch("/api/trpc/auth.logout", { method: "POST" });
                    window.location.href = "/";
                  }}
                  className="text-destructive hover:bg-destructive/10"
                >
                  <LogOut className="h-4 w-4 mr-2" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="flex-1 flex flex-col min-w-0">
          <header className="flex items-center gap-2 px-4 h-12 border-b border-border bg-card/50 flex-shrink-0">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="flex-1" />
            <button
              onClick={() => navigate("/settings")}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Bell className="h-4 w-4" />
            </button>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
