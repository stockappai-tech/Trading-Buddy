/**
 * In-memory database for local development — used when DATABASE_URL is not set.
 * Data is lost on server restart. All functions mirror the real db.ts API.
 */
import type {
  Alert, CoachMessage, InsertAlert, InsertCoachMessage,
  InsertPosition, InsertSession, InsertTrade, InsertUser, InsertUserPreference,
  Position, Session, Trade, User, UserPreference, WatchlistItem,
} from "../drizzle/schema";

export const DEV_OPEN_ID = "dev-user-001";
let _nextId = 10;
const nextId = () => _nextId++;
const now = () => new Date();

// ─── Users ────────────────────────────────────────────────────────────────────

const _users = new Map<string, User>([[DEV_OPEN_ID, {
  id: 1, openId: DEV_OPEN_ID, name: "Dev User", email: "dev@localhost",
  loginMethod: "dev", role: "user", createdAt: now(), updatedAt: now(), lastSignedIn: now(),
}]]);

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("openId required");
  const existing = _users.get(user.openId) ?? { id: nextId(), openId: user.openId, role: "user" as const, createdAt: now(), updatedAt: now(), lastSignedIn: now() };
  _users.set(user.openId, { ...existing, ...user, updatedAt: now() } as User);
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  return _users.get(openId);
}

// ─── Preferences ──────────────────────────────────────────────────────────────

const _prefs = new Map<number, UserPreference>([[1, {
  id: 1, userId: 1, coachMode: "friend", accountSize: "10000.00", riskPerTrade: "1.00",
  maxDailyLoss: null, tradingStyle: "day_trader", experienceLevel: "intermediate", mainWeakness: null,
  primaryGoal: null, favoriteTickers: null, coachStrictness: "balanced",
  tradierToken: null, tradierAccountId: null, notificationsEnabled: true, isPremium: true, updatedAt: now(),
}]]);

export async function getOrCreatePreferences(userId: number): Promise<UserPreference> {
  if (!_prefs.has(userId)) {
    _prefs.set(userId, {
      id: nextId(),
      userId,
      coachMode: "friend",
      accountSize: "10000.00",
      riskPerTrade: "1.00",
      maxDailyLoss: null,
      tradingStyle: "day_trader",
      experienceLevel: "intermediate",
      mainWeakness: null,
      primaryGoal: null,
      favoriteTickers: null,
      coachStrictness: "balanced",
      tradierToken: null,
      tradierAccountId: null,
      notificationsEnabled: true,
      isPremium: false,
      updatedAt: now(),
    });
  }
  return _prefs.get(userId)!;
}

export async function updatePreferences(userId: number, data: Partial<InsertUserPreference>): Promise<void> {
  const existing = await getOrCreatePreferences(userId);
  _prefs.set(userId, { ...existing, ...data, updatedAt: now() });
}

// ─── Trades ───────────────────────────────────────────────────────────────────

const _trades: Trade[] = [];

export async function createTrade(trade: InsertTrade): Promise<number> {
  const id = nextId();
  _trades.push({ id, sessionId: null, exitPrice: null, pnl: null, takeProfit: null, takeProfit2: null, stopLoss: null, notes: null, disciplineScore: null, disciplineFeedback: null, closedAt: null, status: "open", tradeDate: now(), createdAt: now(), updatedAt: now(), ...trade } as Trade);
  return id;
}

export async function getTradesByUser(userId: number, limit = 100, offset = 0): Promise<Trade[]> {
  return _trades.filter(t => t.userId === userId).slice().reverse().slice(offset, offset + limit);
}

export async function getTradesByDateRange(userId: number, from: Date, to: Date): Promise<Trade[]> {
  return _trades.filter(t => t.userId === userId && t.tradeDate >= from && t.tradeDate <= to);
}

export async function updateTrade(id: number, userId: number, data: Partial<InsertTrade>): Promise<void> {
  const idx = _trades.findIndex(t => t.id === id && t.userId === userId);
  if (idx >= 0) _trades[idx] = { ..._trades[idx], ...data, updatedAt: now() } as Trade;
}

export async function deleteTrade(id: number, userId: number): Promise<void> {
  const idx = _trades.findIndex(t => t.id === id && t.userId === userId);
  if (idx >= 0) _trades.splice(idx, 1);
}

export async function getOpenTrades(userId: number): Promise<Trade[]> {
  return _trades.filter(t => t.userId === userId && t.status === "open" && !t.exitPrice).slice().reverse();
}

export async function getPnlByPeriod(userId: number, from: Date, to: Date) {
  const closed = _trades.filter(t => t.userId === userId && t.status === "closed" && t.tradeDate >= from && t.tradeDate <= to);
  const byDate = new Map<string, { totalPnl: number; tradeCount: number; winCount: number }>();
  for (const t of closed) {
    const date = t.tradeDate.toISOString().split("T")[0];
    const prev = byDate.get(date) ?? { totalPnl: 0, tradeCount: 0, winCount: 0 };
    const pnl = parseFloat(t.pnl ?? "0");
    byDate.set(date, { totalPnl: prev.totalPnl + pnl, tradeCount: prev.tradeCount + 1, winCount: prev.winCount + (pnl > 0 ? 1 : 0) });
  }
  return Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }));
}

export async function getSymbolPerformance(userId: number, from: Date, to: Date) {
  const closed = _trades.filter(t => t.userId === userId && t.status === "closed" && t.tradeDate >= from && t.tradeDate <= to);
  const bySymbol = new Map<string, { totalPnl: number; tradeCount: number; winCount: number }>();
  for (const t of closed) {
    const prev = bySymbol.get(t.symbol) ?? { totalPnl: 0, tradeCount: 0, winCount: 0 };
    const pnl = parseFloat(t.pnl ?? "0");
    bySymbol.set(t.symbol, { totalPnl: prev.totalPnl + pnl, tradeCount: prev.tradeCount + 1, winCount: prev.winCount + (pnl > 0 ? 1 : 0) });
  }
  return Array.from(bySymbol.entries()).sort((a, b) => b[1].totalPnl - a[1].totalPnl).map(([symbol, v]) => ({ symbol, ...v }));
}

export async function getTimeOfDayPerformance(userId: number, from: Date, to: Date) {
  const closed = _trades.filter(t => t.userId === userId && t.status === "closed" && t.tradeDate >= from && t.tradeDate <= to);
  const byHour = new Map<number, { totalPnl: number; tradeCount: number }>();
  for (const t of closed) {
    const hour = t.tradeDate.getHours();
    const prev = byHour.get(hour) ?? { totalPnl: 0, tradeCount: 0 };
    byHour.set(hour, { totalPnl: prev.totalPnl + parseFloat(t.pnl ?? "0"), tradeCount: prev.tradeCount + 1 });
  }
  return Array.from(byHour.entries()).sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour, ...v }));
}

export async function fixOrphanedOpenTrades(_userId: number): Promise<number> { return 0; }
export async function deduplicateClosingTrades(_userId: number): Promise<number> { return 0; }

// ─── Sessions ─────────────────────────────────────────────────────────────────

const _sessions: Session[] = [];

export async function createSession(session: InsertSession): Promise<number> {
  const id = nextId();
  _sessions.push({ id, audioUrl: null, transcript: null, title: null, summary: null, coachFeedback: null, emotionalNote: null, createdAt: now(), updatedAt: now(), ...session } as Session);
  return id;
}

export async function getSessionsByUser(userId: number, limit = 20): Promise<Session[]> {
  return _sessions.filter(s => s.userId === userId).slice().reverse().slice(0, limit);
}

export async function getSessionById(id: number, userId: number): Promise<Session | undefined> {
  return _sessions.find(s => s.id === id && s.userId === userId);
}

export async function updateSession(id: number, userId: number, data: Partial<InsertSession>): Promise<void> {
  const idx = _sessions.findIndex(s => s.id === id && s.userId === userId);
  if (idx >= 0) _sessions[idx] = { ..._sessions[idx], ...data, updatedAt: now() } as Session;
}

// ─── Positions ────────────────────────────────────────────────────────────────

const _positions: Position[] = [];

export async function getPositionsByUser(userId: number): Promise<Position[]> {
  return _positions.filter(p => p.userId === userId);
}

export async function upsertPosition(data: InsertPosition): Promise<void> {
  const idx = _positions.findIndex(p => p.userId === data.userId && p.symbol === data.symbol);
  if (idx >= 0) {
    _positions[idx] = { ..._positions[idx], ...data, updatedAt: now() } as Position;
  } else {
    _positions.push({ id: nextId(), currentPrice: null, unrealizedPnl: null, openDate: now(), updatedAt: now(), ...data } as Position);
  }
}

export async function deletePosition(userId: number, symbol: string): Promise<void> {
  const idx = _positions.findIndex(p => p.userId === userId && p.symbol === symbol);
  if (idx >= 0) _positions.splice(idx, 1);
}

// ─── Coach Messages ───────────────────────────────────────────────────────────

const _coachMessages: CoachMessage[] = [];

export async function getCoachMessages(userId: number, limit = 50): Promise<CoachMessage[]> {
  return _coachMessages.filter(m => m.userId === userId).slice().reverse().slice(0, limit);
}

export async function saveCoachMessage(msg: InsertCoachMessage): Promise<void> {
  _coachMessages.push({ id: nextId(), sessionId: null, coachMode: "friend", createdAt: now(), ...msg } as CoachMessage);
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

const _alerts: Alert[] = [];

export async function getAlertsByUser(userId: number): Promise<Alert[]> {
  return _alerts.filter(a => a.userId === userId).slice().reverse();
}

export async function createAlert(alert: InsertAlert): Promise<void> {
  _alerts.push({ id: nextId(), triggered: false, message: null, triggeredAt: null, createdAt: now(), ...alert } as Alert);
}

export async function triggerAlert(id: number): Promise<void> {
  const idx = _alerts.findIndex(a => a.id === id);
  if (idx >= 0) _alerts[idx] = { ..._alerts[idx], triggered: true, triggeredAt: now() };
}

export async function deleteAlert(id: number, userId: number): Promise<void> {
  const idx = _alerts.findIndex(a => a.id === id && a.userId === userId);
  if (idx >= 0) _alerts.splice(idx, 1);
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

const _watchlist: WatchlistItem[] = [];

export async function getWatchlist(userId: number): Promise<WatchlistItem[]> {
  return _watchlist.filter(w => w.userId === userId);
}

export async function addToWatchlist(userId: number, symbol: string, notes?: string): Promise<WatchlistItem> {
  const item: WatchlistItem = { id: nextId(), userId, symbol, notes: notes ?? null, createdAt: now() };
  _watchlist.push(item);
  return item;
}

export async function removeFromWatchlist(userId: number, id: number): Promise<void> {
  const idx = _watchlist.findIndex(w => w.id === id && w.userId === userId);
  if (idx >= 0) _watchlist.splice(idx, 1);
}
