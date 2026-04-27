import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  Alert,
  CoachMessage,
  InsertAlert,
  InsertCoachMessage,
  InsertPosition,
  InsertSession,
  InsertTrade,
  InsertUser,
  InsertUserPreference,
  Position,
  Session,
  Trade,
  UserPreference,
  WatchlistItem,
  alerts,
  coachMessages,
  positions,
  sessions,
  trades,
  userPreferences,
  users,
  watchlist,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import * as devDb from "./devDb";

const isDev = () => !process.env.DATABASE_URL;

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (isDev()) return devDb.upsertUser(user);
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach((field) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  });

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  if (isDev()) return devDb.getUserByOpenId(openId);
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── User Preferences ─────────────────────────────────────────────────────────

export async function getOrCreatePreferences(userId: number): Promise<UserPreference> {
  if (isDev()) return devDb.getOrCreatePreferences(userId);
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const existing = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  if (existing.length > 0) return existing[0];

  await db.insert(userPreferences).values({ userId });
  const created = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return created[0];
}

export async function updatePreferences(userId: number, data: Partial<InsertUserPreference>) {
  if (isDev()) return devDb.updatePreferences(userId, data);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(userPreferences).set(data).where(eq(userPreferences.userId, userId));
}

// ─── Trades ───────────────────────────────────────────────────────────────────

export async function createTrade(trade: InsertTrade): Promise<number> {
  if (isDev()) return devDb.createTrade(trade);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(trades).values(trade);
  return (result[0] as any).insertId;
}

export async function getTradesByUser(userId: number, limit = 100, offset = 0): Promise<Trade[]> {
  if (isDev()) return devDb.getTradesByUser(userId, limit, offset);
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trades).where(eq(trades.userId, userId)).orderBy(desc(trades.tradeDate)).limit(limit).offset(offset);
}

export async function getTradesByDateRange(userId: number, from: Date, to: Date): Promise<Trade[]> {
  if (isDev()) return devDb.getTradesByDateRange(userId, from, to);
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, userId), gte(trades.tradeDate, from), lte(trades.tradeDate, to)))
    .orderBy(desc(trades.tradeDate));
}

export async function updateTrade(id: number, userId: number, data: Partial<InsertTrade>) {
  if (isDev()) return devDb.updateTrade(id, userId, data);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(trades).set(data).where(and(eq(trades.id, id), eq(trades.userId, userId)));
}

export async function deleteTrade(id: number, userId: number) {
  if (isDev()) return devDb.deleteTrade(id, userId);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(trades).where(and(eq(trades.id, id), eq(trades.userId, userId)));
}

export async function getOpenTrades(userId: number): Promise<Trade[]> {
  if (isDev()) return devDb.getOpenTrades(userId);
  const db = await getDb();
  if (!db) return [];
  // Defensive: also exclude any trade that has an exitPrice set (belt-and-suspenders against status inconsistency)
  return db
    .select()
    .from(trades)
    .where(
      and(
        eq(trades.userId, userId),
        eq(trades.status, "open"),
        isNull(trades.exitPrice)
      )
    )
    .orderBy(desc(trades.tradeDate));
}

// ─── PnL Aggregation ──────────────────────────────────────────────────────────

export async function getPnlByPeriod(userId: number, from: Date, to: Date) {
  if (isDev()) return devDb.getPnlByPeriod(userId, from, to);
  const db = await getDb();
  if (!db) return [];
  // Use raw SQL with alias in GROUP BY to avoid ONLY_FULL_GROUP_BY mode issues
  const result = await db.execute(
    sql`SELECT DATE(tradeDate) AS date,
        SUM(CAST(pnl AS DECIMAL(15,4))) AS totalPnl,
        COUNT(*) AS tradeCount,
        SUM(CASE WHEN CAST(pnl AS DECIMAL(15,4)) > 0 THEN 1 ELSE 0 END) AS winCount
        FROM trades
        WHERE userId = ${userId} AND status = 'closed'
        AND tradeDate >= ${from} AND tradeDate <= ${to}
        GROUP BY date ORDER BY date`
  );
  const rows = (result as any)[0] as Array<{ date: string; totalPnl: string | null; tradeCount: string; winCount: string }>;
  return rows.map((r) => ({
    date: r.date,
    totalPnl: parseFloat(r.totalPnl ?? "0"),
    tradeCount: parseInt(r.tradeCount),
    winCount: parseInt(r.winCount),
  }));
}

export async function getSymbolPerformance(userId: number, from: Date, to: Date) {
  if (isDev()) return devDb.getSymbolPerformance(userId, from, to);
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(
    sql`SELECT symbol,
        SUM(CAST(pnl AS DECIMAL(15,4))) AS totalPnl,
        COUNT(*) AS tradeCount,
        SUM(CASE WHEN CAST(pnl AS DECIMAL(15,4)) > 0 THEN 1 ELSE 0 END) AS winCount
        FROM trades
        WHERE userId = ${userId} AND status = 'closed'
        AND tradeDate >= ${from} AND tradeDate <= ${to}
        GROUP BY symbol ORDER BY totalPnl DESC`
  );
  const rows = (result as any)[0] as Array<{ symbol: string; totalPnl: string | null; tradeCount: string; winCount: string }>;
  return rows.map((r) => ({
    symbol: r.symbol,
    totalPnl: parseFloat(r.totalPnl ?? "0"),
    tradeCount: parseInt(r.tradeCount),
    winCount: parseInt(r.winCount),
  }));
}

export async function getTimeOfDayPerformance(userId: number, from: Date, to: Date) {
  if (isDev()) return devDb.getTimeOfDayPerformance(userId, from, to);
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(
    sql`SELECT HOUR(tradeDate) AS hour,
        SUM(CAST(pnl AS DECIMAL(15,4))) AS totalPnl,
        COUNT(*) AS tradeCount
        FROM trades
        WHERE userId = ${userId} AND status = 'closed'
        AND tradeDate >= ${from} AND tradeDate <= ${to}
        GROUP BY hour ORDER BY hour`
  );
  const rows = (result as any)[0] as Array<{ hour: number; totalPnl: string | null; tradeCount: string }>;
  return rows.map((r) => ({
    hour: Number(r.hour),
    totalPnl: parseFloat(r.totalPnl ?? "0"),
    tradeCount: parseInt(r.tradeCount),
  }));
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function createSession(session: InsertSession): Promise<number> {
  if (isDev()) return devDb.createSession(session);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(sessions).values(session);
  return (result[0] as any).insertId;
}

export async function getSessionsByUser(userId: number, limit = 20): Promise<Session[]> {
  if (isDev()) return devDb.getSessionsByUser(userId, limit);
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.createdAt)).limit(limit);
}

export async function getSessionById(id: number, userId: number): Promise<Session | undefined> {
  if (isDev()) return devDb.getSessionById(id, userId);
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, userId))).limit(1);
  return result[0];
}

export async function updateSession(id: number, userId: number, data: Partial<InsertSession>) {
  if (isDev()) return devDb.updateSession(id, userId, data);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(sessions).set(data).where(and(eq(sessions.id, id), eq(sessions.userId, userId)));
}

// ─── Positions ────────────────────────────────────────────────────────────────

export async function getPositionsByUser(userId: number): Promise<Position[]> {
  if (isDev()) return devDb.getPositionsByUser(userId);
  const db = await getDb();
  if (!db) return [];
  return db.select().from(positions).where(eq(positions.userId, userId));
}

export async function upsertPosition(data: InsertPosition) {
  if (isDev()) return devDb.upsertPosition(data);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db
    .select()
    .from(positions)
    .where(and(eq(positions.userId, data.userId), eq(positions.symbol, data.symbol)))
    .limit(1);

  if (existing.length > 0) {
    await db.update(positions).set(data).where(and(eq(positions.userId, data.userId), eq(positions.symbol, data.symbol)));
  } else {
    await db.insert(positions).values(data);
  }
}

export async function deletePosition(userId: number, symbol: string) {
  if (isDev()) return devDb.deletePosition(userId, symbol);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(positions).where(and(eq(positions.userId, userId), eq(positions.symbol, symbol)));
}

// ─── Coach Messages ───────────────────────────────────────────────────────────

export async function getCoachMessages(userId: number, limit = 50): Promise<CoachMessage[]> {
  if (isDev()) return devDb.getCoachMessages(userId, limit);
  const db = await getDb();
  if (!db) return [];
  return db.select().from(coachMessages).where(eq(coachMessages.userId, userId)).orderBy(desc(coachMessages.createdAt)).limit(limit);
}

export async function saveCoachMessage(msg: InsertCoachMessage) {
  if (isDev()) return devDb.saveCoachMessage(msg);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(coachMessages).values(msg);
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export async function getAlertsByUser(userId: number): Promise<Alert[]> {
  if (isDev()) return devDb.getAlertsByUser(userId);
  const db = await getDb();
  if (!db) return [];
  return db.select().from(alerts).where(eq(alerts.userId, userId)).orderBy(desc(alerts.createdAt));
}

export async function createAlert(alert: InsertAlert) {
  if (isDev()) return devDb.createAlert(alert);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(alerts).values(alert);
}

export async function triggerAlert(id: number) {
  if (isDev()) return devDb.triggerAlert(id);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(alerts).set({ triggered: true, triggeredAt: new Date() }).where(eq(alerts.id, id));
}

export async function deleteAlert(id: number, userId: number) {
  if (isDev()) return devDb.deleteAlert(id, userId);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(alerts).where(and(eq(alerts.id, id), eq(alerts.userId, userId)));
}

// ─── Fix Orphaned Open Trades ─────────────────────────────────────────────────
// When a closing trade is saved as a new SELL/COVER row, the original BUY/SHORT
// entry stays open. This function finds those orphaned entries and closes them
// by copying exit data from the matching SELL/COVER counterpart.
//
// STRICT MATCHING RULES (to prevent false-positive auto-closes):
// 1. The open trade must be a BUY or SHORT.
// 2. A matching closer must be a SELL (for BUY) or COVER (for SHORT).
// 3. The closer must have the SAME symbol AND the SAME entry price as the open trade.
// 4. The closer must have an exitPrice set (it is a genuine close, not another entry).
// 5. The closer must have been created AFTER the open trade (tradeDate or id ordering).
export async function fixOrphanedOpenTrades(userId: number): Promise<number> {
  if (isDev()) return devDb.fixOrphanedOpenTrades(userId);
  const db = await getDb();
  if (!db) return 0;

  // Get all open BUY/SHORT trades (no exitPrice)
  const openTrades = await db
    .select()
    .from(trades)
    .where(and(eq(trades.userId, userId), eq(trades.status, "open"), isNull(trades.exitPrice)));

  if (openTrades.length === 0) return 0;

  let fixed = 0;
  for (const open of openTrades) {
    // Only process BUY and SHORT entries — SELL/COVER rows should never be "open" in the first place
    if (open.side !== "buy" && open.side !== "short") continue;

    const expectedClosingSide = open.side === "buy" ? "sell" : "cover";

    // Look for a closed SELL/COVER trade for the SAME symbol AND SAME entry price
    // that was created AFTER this open trade (higher id = created later)
    const closingTrades = await db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.userId, userId),
          eq(trades.symbol, open.symbol),
          eq(trades.side, expectedClosingSide),
          eq(trades.status, "closed"),
          eq(trades.entryPrice, open.entryPrice),  // must match the original entry price
        )
      )
      .orderBy(desc(trades.tradeDate))
      .limit(1);

    // Only close if we found a genuine matching counterpart with an exitPrice
    if (closingTrades.length > 0 && closingTrades[0].exitPrice) {
      const closer = closingTrades[0];
      // Only fix if the closer was created after the open trade (id is auto-increment)
      if (closer.id > open.id) {
        await db.update(trades).set({
          status: "closed",
          exitPrice: closer.exitPrice,
          pnl: closer.pnl,
          closedAt: closer.closedAt ?? closer.tradeDate,
        }).where(and(eq(trades.id, open.id), eq(trades.userId, userId)));
        fixed++;
      }
    }
  }
  return fixed;
}

/**
 * Deduplication cleanup: removes orphaned SELL/COVER trades that are duplicates
 * of already-closed BUY/SHORT rows (same user, symbol, entry price, exit price).
 * This handles historical data created before the "update original trade" fix.
 * Safe to run multiple times (idempotent).
 */
export async function deduplicateClosingTrades(userId: number): Promise<number> {
  if (isDev()) return devDb.deduplicateClosingTrades(userId);
  const db = await getDb();
  if (!db) return 0;

  // Find all closed SELL trades for this user
  const sellTrades = await db
    .select()
    .from(trades)
    .where(
      and(
        eq(trades.userId, userId),
        eq(trades.status, "closed"),
        eq(trades.side, "sell")
      )
    );

  const coverTrades = await db
    .select()
    .from(trades)
    .where(
      and(
        eq(trades.userId, userId),
        eq(trades.status, "closed"),
        eq(trades.side, "cover")
      )
    );

  const closingTrades = [...sellTrades, ...coverTrades];
  if (closingTrades.length === 0) return 0;

  let removed = 0;
  for (const closer of closingTrades) {
    // Look for a closed BUY/SHORT trade with the same symbol, entry price, exit price, and quantity
    // that was updated by fixOrphanedOpenTrades (i.e., the canonical record)
    const canonicals = await db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.userId, userId),
          eq(trades.symbol, closer.symbol),
          eq(trades.status, "closed"),
          eq(trades.entryPrice, closer.entryPrice),
          eq(trades.exitPrice, closer.exitPrice ?? closer.entryPrice),
          eq(trades.quantity, closer.quantity)
        )
      );

    // If there's a canonical BUY/SHORT record with same entry+exit, this SELL/COVER is a duplicate
    const hasBuyCounterpart = canonicals.some(
      (c) => c.id !== closer.id && (c.side === "buy" || c.side === "short")
    );

    if (hasBuyCounterpart) {
      await db.delete(trades).where(
        and(eq(trades.id, closer.id), eq(trades.userId, userId))
      );
      removed++;
      console.log(`[dedup] Removed duplicate ${closer.side.toUpperCase()} trade id=${closer.id} symbol=${closer.symbol}`);
    }
  }

  return removed;
}

// ─── Watchlist ─────────────────────────────────────────────────────────────────

export async function getWatchlist(userId: number): Promise<WatchlistItem[]> {
  if (isDev()) return devDb.getWatchlist(userId);
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(watchlist)
    .where(eq(watchlist.userId, userId))
    .orderBy(watchlist.createdAt);
}

export async function addToWatchlist(userId: number, symbol: string, notes?: string): Promise<WatchlistItem> {
  if (isDev()) return devDb.addToWatchlist(userId, symbol, notes);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // Prevent duplicates
  const existing = await db.select().from(watchlist).where(and(eq(watchlist.userId, userId), eq(watchlist.symbol, symbol.toUpperCase())));
  if (existing.length > 0) return existing[0];
  await db.insert(watchlist).values({ userId, symbol: symbol.toUpperCase(), notes });
  const [row] = await db.select().from(watchlist).where(and(eq(watchlist.userId, userId), eq(watchlist.symbol, symbol.toUpperCase())));
  return row;
}

export async function removeFromWatchlist(userId: number, id: number): Promise<void> {
  if (isDev()) return devDb.removeFromWatchlist(userId, id);
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(watchlist).where(and(eq(watchlist.id, id), eq(watchlist.userId, userId)));
}
