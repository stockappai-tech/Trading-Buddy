import {
  boolean,
  decimal,
  float,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Trading sessions (voice recordings)
export const sessions = mysqlTable("sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }),
  transcript: text("transcript"),
  audioUrl: text("audioUrl"),
  emotionalNote: text("emotionalNote"),
  summary: text("summary"),
  coachFeedback: text("coachFeedback"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

// Individual trades
export const trades = mysqlTable("trades", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sessionId: int("sessionId"),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: mysqlEnum("side", ["buy", "sell", "short", "cover"]).notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 4 }).notNull(),
  entryPrice: decimal("entryPrice", { precision: 15, scale: 4 }).notNull(),
  exitPrice: decimal("exitPrice", { precision: 15, scale: 4 }),
  pnl: decimal("pnl", { precision: 15, scale: 4 }),
  takeProfit: decimal("takeProfit", { precision: 15, scale: 4 }),
  stopLoss: decimal("stopLoss", { precision: 15, scale: 4 }),
  status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  notes: text("notes"),
  disciplineScore: int("disciplineScore"),
  disciplineFeedback: text("disciplineFeedback"),
  tradeDate: timestamp("tradeDate").defaultNow().notNull(),
  closedAt: timestamp("closedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;

// Open positions (synced from Tradier or manually tracked)
export const positions = mysqlTable("positions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  quantity: decimal("quantity", { precision: 15, scale: 4 }).notNull(),
  avgPrice: decimal("avgPrice", { precision: 15, scale: 4 }).notNull(),
  currentPrice: decimal("currentPrice", { precision: 15, scale: 4 }),
  unrealizedPnl: decimal("unrealizedPnl", { precision: 15, scale: 4 }),
  openDate: timestamp("openDate").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Position = typeof positions.$inferSelect;
export type InsertPosition = typeof positions.$inferInsert;

// User preferences
export const userPreferences = mysqlTable("userPreferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  coachMode: mysqlEnum("coachMode", ["sergeant", "friend", "expert"]).default("friend").notNull(),
  accountSize: decimal("accountSize", { precision: 15, scale: 2 }).default("10000"),
  riskPerTrade: decimal("riskPerTrade", { precision: 5, scale: 2 }).default("1.00"),
  maxDailyLoss: decimal("maxDailyLoss", { precision: 15, scale: 2 }),
  tradingStyle: mysqlEnum("tradingStyle", ["scalper", "day_trader", "swing_trader", "position_trader", "options_trader"]).default("day_trader"),
  experienceLevel: mysqlEnum("experienceLevel", ["beginner", "intermediate", "advanced", "professional"]).default("intermediate"),
  mainWeakness: varchar("mainWeakness", { length: 255 }),
  primaryGoal: varchar("primaryGoal", { length: 255 }),
  favoriteTickers: text("favoriteTickers"),
  coachStrictness: mysqlEnum("coachStrictness", ["gentle", "balanced", "strict"]).default("balanced"),
  tradierToken: text("tradierToken"),
  tradierAccountId: varchar("tradierAccountId", { length: 64 }),
  notificationsEnabled: boolean("notificationsEnabled").default(true),
  isPremium: boolean("isPremium").default(false),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;

// Price alerts
export const alerts = mysqlTable("alerts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  targetPrice: decimal("targetPrice", { precision: 15, scale: 4 }).notNull(),
  alertType: mysqlEnum("alertType", ["above", "below", "stop_loss", "take_profit"]).notNull(),
  triggered: boolean("triggered").default(false),
  message: text("message"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  triggeredAt: timestamp("triggeredAt"),
});

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

// AI coach chat messages
export const coachMessages = mysqlTable("coachMessages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sessionId: int("sessionId"),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  coachMode: mysqlEnum("coachMode", ["sergeant", "friend", "expert"]).default("friend"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CoachMessage = typeof coachMessages.$inferSelect;
export type InsertCoachMessage = typeof coachMessages.$inferInsert;

// Watchlist (user-curated list of tickers to follow)
export const watchlist = mysqlTable("watchlist", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WatchlistItem = typeof watchlist.$inferSelect;
export type InsertWatchlistItem = typeof watchlist.$inferInsert;
