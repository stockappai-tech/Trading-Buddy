import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.FINNHUB_API_KEY = process.env.FINNHUB_API_KEY ?? "test-finnhub-key";
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock database helpers
vi.mock("./db", () => ({
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  getDb: vi.fn(),
  getTradesByUser: vi.fn().mockResolvedValue([]),
  getTradesByDateRange: vi.fn().mockResolvedValue([]),
  getOpenTrades: vi.fn().mockResolvedValue([]),
  createTrade: vi.fn().mockResolvedValue(1),
  updateTrade: vi.fn().mockResolvedValue(undefined),
  deleteTrade: vi.fn().mockResolvedValue(undefined),
  getSessionsByUser: vi.fn().mockResolvedValue([]),
  createSession: vi.fn().mockResolvedValue(1),
  updateSession: vi.fn().mockResolvedValue(undefined),
  getSessionById: vi.fn().mockResolvedValue(null),
  getOrCreatePreferences: vi.fn().mockResolvedValue({ userId: 1, isPremium: false, coachMode: "friend", notificationsEnabled: true, tradierToken: null, tradierAccountId: null, accountSize: null, riskPerTrade: null }),
  updatePreferences: vi.fn().mockResolvedValue(undefined),
  getAlertsByUser: vi.fn().mockResolvedValue([]),
  createAlert: vi.fn().mockResolvedValue({ id: 1, symbol: "AAPL", targetPrice: "200.00", alertType: "above", triggered: false, userId: 1, createdAt: new Date() }),
  deleteAlert: vi.fn().mockResolvedValue(undefined),
  triggerAlert: vi.fn().mockResolvedValue(undefined),
  getCoachMessages: vi.fn().mockResolvedValue([]),
  saveCoachMessage: vi.fn().mockResolvedValue(undefined),
  getPnlByPeriod: vi.fn().mockResolvedValue([]),
  getSymbolPerformance: vi.fn().mockResolvedValue([{ symbol: "AAPL", totalPnl: 300, tradeCount: 2 }]),
  getTimeOfDayPerformance: vi.fn().mockResolvedValue([]),
  getPositionsByUser: vi.fn().mockResolvedValue([]),
  upsertPosition: vi.fn().mockResolvedValue(undefined),
  deletePosition: vi.fn().mockResolvedValue(undefined),
  fixOrphanedOpenTrades: vi.fn().mockResolvedValue(0),
  deduplicateClosingTrades: vi.fn().mockResolvedValue(0),
  getWatchlist: vi.fn().mockResolvedValue([]),
  addToWatchlist: vi.fn().mockResolvedValue({ id: 1, userId: 1, symbol: "AAPL", notes: null, createdAt: new Date() }),
  removeFromWatchlist: vi.fn().mockResolvedValue(undefined),
}));

// Mock Forge TTS
vi.mock("./_core/forgeTts", () => ({
  synthesizeSpeechForge: vi.fn().mockResolvedValue({ audioBase64: "dGVzdA==" }), // base64 "test"
}));

// Mock LLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content: "Great trading session! Keep it up." } }] }),
}));

// Mock voice transcription
vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: vi.fn().mockResolvedValue({ text: "I bought 100 shares of AAPL at 150 dollars." }),
}));

function createMockContext(overrides: Partial<TrpcContext> = {}): TrpcContext {
  const user = {
    id: 1,
    openId: "test-user-123",
    email: "trader@example.com",
    name: "Test Trader",
    loginMethod: "manus",
    role: "user" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as TrpcContext["res"],
    ...overrides,
  };
}

describe("auth.logout", () => {
  it("clears session cookie and returns success", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
  });

  it("returns user info when authenticated", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const user = await caller.auth.me();
    expect(user?.name).toBe("Test Trader");
    expect(user?.email).toBe("trader@example.com");
  });
});

describe("trades router", () => {
  it("lists trades for authenticated user", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const trades = await caller.trades.list({});
    expect(Array.isArray(trades)).toBe(true);
  });

  it("creates a new trade", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.trades.create({
      symbol: "AAPL",
      side: "buy",
      quantity: "100",
      entryPrice: "150.00",
      status: "open",
    });
    // createTrade mock returns id=1, router returns { id }
    expect(result).toBeDefined();
  });

  it("rejects unauthenticated trade creation", async () => {
    const ctx = createMockContext({ user: null });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.trades.create({
      symbol: "AAPL",
      side: "buy",
      quantity: "100",
      entryPrice: "150.00",
      status: "open",
    })).rejects.toThrow();
  });

  it("fixOrphaned returns fixed count", async () => {
    const { fixOrphanedOpenTrades } = await import("./db");
    (fixOrphanedOpenTrades as ReturnType<typeof vi.fn>).mockResolvedValueOnce(2);
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.trades.fixOrphaned();
    expect(result.fixed).toBe(2);
  });

  it("deduplicateClosing returns removed count", async () => {
    const { deduplicateClosingTrades } = await import("./db");
    (deduplicateClosingTrades as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.trades.deduplicateClosing();
    expect(result.removed).toBe(1);
  });

  it("deduplicateClosing returns 0 when no duplicates", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.trades.deduplicateClosing();
    expect(result.removed).toBe(0);
  });
});

describe("sessions.extractTrades", () => {
  it("closes the remaining open position at the live market price when no exit price is spoken", async () => {
    const { invokeLLM } = await import("./_core/llm");
    (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ trades: [] }) } }],
    });

    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.sessions.extractTrades({
      transcript: "close the rest of my position",
      openPositions: [{
        symbol: "AAPL",
        side: "buy",
        quantity: "10",
        entryPrice: "250.00",
        takeProfit: "279.00",
        takeProfit2: null,
        stopLoss: "240.00",
        notes: null,
      }],
      liveQuotes: { AAPL: 281.25 },
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      symbol: "AAPL",
      side: "sell",
      quantity: "10",
      entryPrice: "250.00",
      exitPrice: "281.25",
      status: "closed",
    });
    expect(result.trades[0].pnl).toBe("312.50");
  });
});

describe("preferences router", () => {
  it("gets user preferences", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const prefs = await caller.preferences.get();
    expect(prefs).toBeDefined();
    expect(prefs?.isPremium).toBe(false);
  });

  it("updates user preferences", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.preferences.update({ coachMode: "expert" })).resolves.not.toThrow();
  });
});

describe("analytics router", () => {
  it("returns summary analytics", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = new Date();
    const summary = await caller.analytics.summary({ from, to });
    expect(summary).toBeDefined();
    expect(typeof summary?.totalPnl).toBe("number");
    expect(typeof summary?.winRate).toBe("number");
  });

  it("returns symbol performance data", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = new Date();
    const data = await caller.analytics.symbolPerformance({ from, to });
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("sessions router", () => {
  it("lists sessions for authenticated user", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const sessions = await caller.sessions.list();
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("creates a new session", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const session = await caller.sessions.create({ title: "Morning Session" });
    // createSession mock returns id=1, router returns { id }
    expect(session).toBeDefined();
  });
});

describe("alerts router", () => {
  it("lists alerts for authenticated user", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const alerts = await caller.alerts.list();
    expect(Array.isArray(alerts)).toBe(true);
  });

  it("creates a price alert", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const alert = await caller.alerts.create({
      symbol: "AAPL",
      targetPrice: "200.00",
      alertType: "above",
    });
    expect(alert).toBeDefined();
  });
});

// ─── TTS stripMarkdown utility ──────────────────────────────────────────────

/** Inline copy of stripMarkdown for unit testing (mirrors AICoach.tsx) */
function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

describe("TTS stripMarkdown utility", () => {
  it("removes bold markdown", () => {
    expect(stripMarkdown("**Great job!** Keep it up.")).toBe("Great job! Keep it up.");
  });

  it("removes heading hashes", () => {
    expect(stripMarkdown("## Risk Management")).toBe("Risk Management");
  });

  it("removes inline code", () => {
    expect(stripMarkdown("Use `stop-loss` orders.")).toBe("Use  orders.");
  });

  it("removes markdown links", () => {
    expect(stripMarkdown("See [Investopedia](https://investopedia.com).")).toBe("See Investopedia.");
  });

  it("removes bullet list markers", () => {
    expect(stripMarkdown("- Item one\n- Item two")).toBe("Item one Item two");
  });

  it("collapses double newlines to period-space", () => {
    expect(stripMarkdown("Para one\n\nPara two")).toBe("Para one. Para two");
  });

  it("returns plain text unchanged", () => {
    expect(stripMarkdown("Your win rate is 60%.")).toBe("Your win rate is 60%.");
  });
});

describe("coach router", () => {
  it("blocks premium coach for free users", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    // getOrCreatePreferences returns isPremium: false, so coach.chat should throw FORBIDDEN
    await expect(caller.coach.chat({ message: "How am I doing?", coachMode: "expert" })).rejects.toThrow();
  });

  it("allows free chat for all users", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.coach.freeChat({ message: "What is a stop loss?" });
    expect(result.reply).toBeDefined();
    expect(typeof result.reply).toBe("string");
  });
});

// ─── Ticker correction utility ───────────────────────────────────────────────
import { correctTickers } from "@shared/tickerCorrection";

describe("correctTickers utility", () => {
  it("replaces 'honda' with ONDS (user accent case)", () => {
    expect(correctTickers("I bought honda at 5 dollars")).toBe("I bought ONDS at 5 dollars");
  });

  it("replaces 'Apple' with AAPL (case-insensitive)", () => {
    expect(correctTickers("I went long on Apple today")).toBe("I went long on AAPL today");
  });

  it("replaces 'Tesla' with TSLA", () => {
    expect(correctTickers("Tesla is breaking out")).toBe("TSLA is breaking out");
  });

  it("replaces 'Amazon' with AMZN", () => {
    expect(correctTickers("sold Amazon for a profit")).toBe("sold AMZN for a profit");
  });

  it("replaces 'Nvidia' with NVDA", () => {
    expect(correctTickers("Nvidia earnings tomorrow")).toBe("NVDA earnings tomorrow");
  });

  it("replaces 'Google' with GOOGL", () => {
    expect(correctTickers("Google is up 2 percent")).toBe("GOOGL is up 2 percent");
  });

  it("replaces multi-word phrase 'advanced micro devices' with AMD", () => {
    expect(correctTickers("I shorted advanced micro devices")).toBe("I shorted AMD");
  });

  it("does not replace partial word matches (e.g. 'Appleton' should not become AAPLton)", () => {
    const result = correctTickers("Appleton is a city");
    expect(result).not.toContain("AAPLton");
  });

  it("handles already-correct tickers unchanged", () => {
    expect(correctTickers("I bought AAPL at 180")).toBe("I bought AAPL at 180");
  });

  it("replaces multiple companies in one sentence", () => {
    const result = correctTickers("Long Apple short Tesla");
    expect(result).toContain("AAPL");
    expect(result).toContain("TSLA");
  });
});

// ─── sessions.tts procedure (Forge TTS) ───────────────────────────────────────────────────────
describe("sessions.tts procedure", () => {
  it("returns audioBase64 for valid voice (onyx)", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.sessions.tts({ text: "Hello trader.", voice: "onyx" });
    expect(result.audioBase64).toBeDefined();
    expect(typeof result.audioBase64).toBe("string");
    expect(result.audioBase64.length).toBeGreaterThan(0);
  });

  it("accepts all 4 persona voices", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    for (const voice of ["onyx", "fable", "nova", "shimmer"] as const) {
      const result = await caller.sessions.tts({ text: "Test", voice });
      expect(result.audioBase64).toBeDefined();
    }
  });

  it("rejects text longer than 5000 chars", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.sessions.tts({ text: "x".repeat(5001) })
    ).rejects.toThrow();
  });

  it("uses default voice (nova) when voice not specified", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.sessions.tts({ text: "Default voice test." });
    expect(result.audioBase64).toBeDefined();
  });
});

// ─── Watchlist router ───────────────────────────────────────────────────────
describe("watchlist router", () => {
  it("lists watchlist items for authenticated user", async () => {
    const { getWatchlist } = await import("./db");
    vi.mocked(getWatchlist).mockResolvedValueOnce([
      { id: 1, userId: 1, symbol: "AAPL", notes: null, createdAt: new Date() },
      { id: 2, userId: 1, symbol: "TSLA", notes: null, createdAt: new Date() },
    ] as any);
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.watchlist.list();
    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe("AAPL");
  });

  it("adds a symbol to the watchlist", async () => {
    const { addToWatchlist } = await import("./db");
    vi.mocked(addToWatchlist).mockResolvedValueOnce({ id: 3, userId: 1, symbol: "NVDA", notes: null, createdAt: new Date() } as any);
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.watchlist.add({ symbol: "nvda" });
    expect(result.symbol).toBe("NVDA");
    expect(addToWatchlist).toHaveBeenCalledWith(1, "NVDA", undefined);
  });

  it("removes a symbol from the watchlist", async () => {
    const { removeFromWatchlist } = await import("./db");
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.watchlist.remove({ id: 1 });
    expect(result.success).toBe(true);
    expect(removeFromWatchlist).toHaveBeenCalledWith(1, 1);
  });

  it("rejects empty symbol", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.watchlist.add({ symbol: "" })).rejects.toThrow();
  });
});

// ─── RGTI ticker corrections ─────────────────────────────────────────────────
describe("RGTI phonetic ticker corrections", () => {
  it("corrects 'our GTI' to RGTI", () => {
    expect(correctTickers("I bought our GTI today")).toBe("I bought RGTI today");
  });

  it("corrects 'rigetti' to RGTI", () => {
    expect(correctTickers("rigetti is breaking out")).toBe("RGTI is breaking out");
  });

  it("corrects 'argie' to RGTI", () => {
    expect(correctTickers("I went long on argie")).toBe("I went long on RGTI");
  });

  it("corrects 'r GTI' to RGTI", () => {
    expect(correctTickers("shorted r GTI at 10")).toBe("shorted RGTI at 10");
  });
});

// ─── Finnhub market router ────────────────────────────────────────────────────
describe("market.quotes (Finnhub)", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    // Ensure finnhubApiKey is set so the guard passes
    process.env.FINNHUB_API_KEY = "test-finnhub-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FINNHUB_API_KEY;
  });

  it("returns parsed quotes for valid symbols", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ c: 254.37, d: 0.58, dp: 0.23, h: 256.18, l: 253.33, o: 254.41, pc: 253.79, t: 1775068275 }),
    });
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.market.quotes({ symbols: "AAPL" });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({ symbol: "AAPL", last: 254.37 });
  });

  it("filters out symbols with last price of 0 (unknown tickers)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 }),
    });
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.market.quotes({ symbols: "FAKESYMBOL" });
    expect(result).toHaveLength(0);
  });

  it("handles partial failures gracefully (one symbol fails, others succeed)", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("Network error");
      return { ok: true, json: async () => ({ c: 100, d: 0, dp: 0, h: 101, l: 99, o: 100, pc: 99, t: 1 }) };
    });
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.market.quotes({ symbols: "FAIL,MSFT" });
    expect(result.some((q: any) => q.symbol === "MSFT")).toBe(true);
  });
});

describe("market.news (Finnhub)", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    process.env.FINNHUB_API_KEY = "test-finnhub-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FINNHUB_API_KEY;
  });

  it("returns empty array when no symbols provided", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.market.news({ symbols: [] });
    expect(result).toEqual([]);
  });

  it("returns merged and deduplicated news articles", async () => {
    const article = { category: "company", datetime: 1775065320, headline: "AAPL hits record high", id: 1, image: "", related: "AAPL", source: "Yahoo", summary: "Apple stock surged.", url: "https://example.com/1" };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [article],
    });
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.market.news({ symbols: ["AAPL"] });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect((result[0] as any).headline).toBe("AAPL hits record high");
  });
});
