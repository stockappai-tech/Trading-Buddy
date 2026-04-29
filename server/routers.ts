import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { transcribeAudio } from "./_core/voiceTranscription";
import { synthesizeSpeechForge, type ForgeTtsVoice } from "./_core/forgeTts";
import { ELEVENLABS_VOICES, synthesizeSpeech as synthesizeSpeechElevenLabs } from "./_core/elevenLabsTts";
import { synthesizeSpeech as synthesizeSpeechGoogle, type GoogleTtsVoice } from "./_core/googleTts";
import { correctTickers } from "@shared/tickerCorrection";
import { notifyOwner } from "./_core/notification";
import type { UserPreference } from "../drizzle/schema";
import {
  createAlert,
  createSession,
  createTrade,
  deleteAlert,
  deleteTrade,
  getAlertsByUser,
  getCoachMessages,
  getOpenTrades,
  getOrCreatePreferences,
  getPnlByPeriod,
  getPositionsByUser,
  getSessionById,
  getSessionsByUser,
  getSymbolPerformance,
  getTimeOfDayPerformance,
  getTradesByDateRange,
  getTradesByUser,
  saveCoachMessage,
  triggerAlert,
  updatePreferences,
  updateSession,
  updateTrade,
  upsertPosition,
  deletePosition,
  fixOrphanedOpenTrades,
  deduplicateClosingTrades,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} from "./db";
import { ENV } from "./_core/env";

type TtsPersona = "adam" | "george" | "sarah" | "laura";

const PERSONA_TO_ELEVENLABS = {
  adam: ELEVENLABS_VOICES.adam,
  george: ELEVENLABS_VOICES.george,
  sarah: ELEVENLABS_VOICES.sarah,
  laura: ELEVENLABS_VOICES.laura,
} as const;

const PERSONA_TO_GOOGLE: Record<TtsPersona, GoogleTtsVoice> = {
  adam: "en-US-Neural2-D",
  george: "en-US-Neural2-J",
  sarah: "en-US-Neural2-F",
  laura: "en-US-Neural2-H",
};

const FORGE_TO_PERSONA: Record<ForgeTtsVoice, TtsPersona> = {
  onyx: "adam",
  echo: "adam",
  fable: "george",
  nova: "sarah",
  shimmer: "laura",
  alloy: "sarah",
};

const PERSONA_TO_FORGE: Record<TtsPersona, ForgeTtsVoice> = {
  adam: "onyx",
  george: "fable",
  sarah: "nova",
  laura: "shimmer",
};

const dailyPlanInput = z.object({
  date: z.string(),
  marketBias: z.string().optional(),
  focusTickers: z.string().optional(),
  keyLevels: z.string().optional(),
  aPlusSetup: z.string().optional(),
  noTradeRules: z.string().optional(),
  maxLoss: z.string().optional(),
  maxTrades: z.string().optional(),
  preMarketChecks: z.array(z.string()).optional(),
  executionChecks: z.array(z.string()).optional(),
  postMarketRecap: z.string().optional(),
}).optional();

// ─── Finnhub Market Data Helpers ─────────────────────────────────────────────

async function finnhubRequest(path: string, params?: Record<string, string>) {
  const base = "https://finnhub.io/api/v1";
  const url = new URL(`${base}${path}`);
  url.searchParams.set("token", ENV.finnhubApiKey);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Finnhub API error: ${res.status}`);
  return res.json() as Promise<unknown>;
}

const formatCalendarDate = (date: Date) => date.toISOString().slice(0, 10);

const parseCalendarDate = (value: unknown) => {
  if (typeof value !== "string" || !value) return "";
  return value.slice(0, 10);
};

const calendarSortValue = (value: string) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
};

const MARKET_FOCUS_EARNINGS_BY_DATE: Record<string, Array<{ symbol: string; company: string; timing: string; watch: string }>> = {
  "2026-04-29": [
    { symbol: "GOOGL", company: "Alphabet / Google", timing: "Post-market", watch: "Search ads, YouTube, Google Cloud growth, AI capex, Gemini monetization." },
    { symbol: "MSFT", company: "Microsoft", timing: "Post-market", watch: "Azure growth, Copilot adoption, AI infrastructure spend, OpenAI relationship commentary." },
    { symbol: "META", company: "Meta Platforms", timing: "Post-market", watch: "Ad growth, Reels engagement, AI spending, Reality Labs losses and guidance." },
    { symbol: "AMZN", company: "Amazon", timing: "Post-market", watch: "AWS growth, retail margins, AI demand, capex and operating-income guidance." },
    { symbol: "SOFI", company: "SoFi Technologies", timing: "Earnings day", watch: "Fintech risk appetite, loan growth, deposits, guidance and credit quality." },
  ],
};

async function yahooQuote(symbol: string) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", "1d");
  url.searchParams.set("interval", "1m");
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo quote API error: ${res.status}`);
  const payload = await res.json() as any;
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];
  const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((value: unknown) => typeof value === "number");
  const last = Number(meta?.regularMarketPrice ?? closes.at(-1) ?? 0);
  const prevClose = Number(meta?.previousClose ?? meta?.chartPreviousClose ?? 0);
  const open = Number(meta?.regularMarketOpen ?? quote?.open?.find((value: unknown) => typeof value === "number") ?? last);
  const high = Number(meta?.regularMarketDayHigh ?? Math.max(...closes, last));
  const low = Number(meta?.regularMarketDayLow ?? Math.min(...closes, last));
  const change = prevClose > 0 ? last - prevClose : 0;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    symbol: symbol.toUpperCase(),
    last,
    open,
    high,
    low,
    prevClose,
    change,
    changePercent,
  };
}

async function yahooHistoricalPrices(symbol: string, resolution: string, count: number) {
  const range = resolution === "1D" ? `${Math.max(count, 5)}d` : resolution === "1W" ? `${Math.max(count, 5)}wk` : `${Math.max(count, 3)}mo`;
  const interval = resolution === "1D" ? "1d" : resolution === "1W" ? "1wk" : "1mo";
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", interval);
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo historical API error: ${res.status}`);

  const payload = await res.json() as any;
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const rows = timestamps.map((timestamp: number, index: number) => ({
    date: new Date(timestamp * 1000).toISOString(),
    open: Number(quote.open?.[index] ?? quote.close?.[index] ?? 0),
    high: Number(quote.high?.[index] ?? quote.close?.[index] ?? 0),
    low: Number(quote.low?.[index] ?? quote.close?.[index] ?? 0),
    close: Number(quote.close?.[index] ?? 0),
    volume: Number(quote.volume?.[index] ?? 0),
    source: "Yahoo",
  }));

  return rows.filter((row: { close: number }) => row.close > 0).slice(-count);
}

async function coingeckoRequest(path: string, params?: Record<string, string>) {
  const base = "https://api.coingecko.com/api/v3";
  const url = new URL(`${base}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
  return res.json() as Promise<unknown>;
}

const COINGECKO_SYMBOL_MAP: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  ADA: "cardano",
  XRP: "ripple",
  DOGE: "dogecoin",
  DOT: "polkadot",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  MATIC: "matic-network",
  AVAX: "avalanche-2",
  BNB: "binancecoin",
  LINK: "chainlink",
  UNI: "uniswap",
  ETC: "ethereum-classic",
};

function getCoinGeckoId(symbol: string) {
  return COINGECKO_SYMBOL_MAP[symbol.toUpperCase()] ?? symbol.toLowerCase();
}

function resolutionToFinnhub(resolution: string) {
  if (resolution === "1D") return "D";
  if (resolution === "1W") return "W";
  if (resolution === "1M") return "M";
  if (resolution === "1H") return "60";
  if (resolution === "15m") return "15";
  return "D";
}

function resolutionSeconds(resolution: string) {
  if (resolution === "1D") return 86400;
  if (resolution === "1W") return 86400 * 7;
  if (resolution === "1M") return 86400 * 30;
  if (resolution === "1H") return 3600;
  if (resolution === "15m") return 900;
  return 86400;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseDecimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildMarketSignalReasoning(symbol: string, currentPrice: number, changePercent: number, sentimentScore: number) {
  const sentiment =
    sentimentScore > 0.1 ? "positive" :
    sentimentScore < -0.1 ? "negative" :
    "neutral";
  return `${symbol} signal is based on current price ${currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : "data"}, today's ${changePercent >= 0 ? "positive" : "negative"} move of ${Math.abs(changePercent).toFixed(2)}%, and ${sentiment} recent-news sentiment. Treat this as market setup guidance, then confirm it against your own entry, stop, and plan before taking the trade.`;
}

function sanitizeMarketSignalReasoning(symbol: string, reasoning: unknown, currentPrice: number, changePercent: number, sentimentScore: number) {
  const text = typeof reasoning === "string" ? reasoning.trim() : "";
  if (!text || /\b(no historical|historical\b.*\b(trade|personal|data)|personal\b.*\b(history|trade|data)|closed trades?)\b/i.test(text)) {
    return buildMarketSignalReasoning(symbol, currentPrice, changePercent, sentimentScore);
  }
  return text;
}

const personalHistoryLeakPattern = /\b(no historical|without trade history|historical\b.*\b(trade|personal|data)|personal\b.*\b(history|trade|data)|closed trades?|edge established|evidence of edge|expertise)\b/i;

function sanitizePredictionReasoning(reasoning: unknown, symbol: string, side: string, currentPrice: number, riskReward: number | null) {
  const text = typeof reasoning === "string" ? reasoning.trim() : "";
  if (text && !personalHistoryLeakPattern.test(text)) return text;

  const direction = side === "sell" || side === "short" ? "bearish" : "bullish";
  const priceContext = currentPrice > 0 ? `${symbol} is trading near $${currentPrice.toFixed(2)}` : `${symbol} has limited live quote context right now`;
  const rrContext = riskReward && Number.isFinite(riskReward)
    ? `The planned risk/reward is about ${riskReward.toFixed(2)}:1, so the setup quality depends on clean execution around the entry, stop, and target.`
    : "No complete stop/target structure was provided, so risk control is the main thing to tighten before taking the trade.";

  return `${priceContext}. The setup leans ${direction} based on the proposed side and price structure. ${rrContext} Treat this as a market-setup read, not a guarantee: confirm the catalyst, volume, trend, and your daily plan before entering.`;
}

function sanitizePredictionFactors(factors: unknown[], symbol: string, riskReward: number | null) {
  const cleaned = factors
    .filter((factor): factor is string => typeof factor === "string" && factor.trim().length > 0)
    .map((factor) => factor.trim())
    .filter((factor) => !personalHistoryLeakPattern.test(factor));

  if (cleaned.length > 0) return cleaned.slice(0, 6);

  return [
    `${symbol} setup should be judged from current price action, catalyst quality, and liquidity.`,
    riskReward && Number.isFinite(riskReward) ? `Planned risk/reward is about ${riskReward.toFixed(2)}:1.` : "Add both a stop and target to make the risk/reward clear.",
    "Stop placement must leave room for normal volatility while still protecting downside.",
    "Confirm direction with volume, trend, and broader market conditions before entering.",
  ];
}

const TRADIER_API_BASE = "https://api.tradier.com/v1";

async function tradierRequest(token: string, path: string, method: string = "GET", body?: URLSearchParams | Record<string, string>) {
  const url = `${TRADIER_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const requestInit: RequestInit = { method, headers };
  if (body) {
    if (body instanceof URLSearchParams) {
      requestInit.body = body.toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else {
      requestInit.body = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
  }

  const res = await fetch(url, requestInit);
  const payload = await res.text();
  let json: unknown = {};
  try {
    json = payload ? JSON.parse(payload) : {};
  } catch {
    json = { message: payload };
  }
  if (!res.ok) {
    const message = typeof json === "object" && json !== null && "message" in json ? (json as any).message : payload;
    throw new Error(`Tradier API error ${res.status}: ${message}`);
  }
  return json;
}

async function generateTradeSignal(symbol: string) {
  let currentPrice = 0;
  let prevClose = 0;
  let change = 0;
  let changePercent = 0;
  if (ENV.finnhubApiKey) {
    try {
      const quote = (await finnhubRequest("/quote", { symbol })) as any;
      currentPrice = quote.c || 0;
      prevClose = quote.pc || 0;
      change = quote.d || 0;
      changePercent = quote.dp || 0;
    } catch {
      // ignore market data failures
    }
  }

  let sentimentScore = 0;
  if (ENV.newsApiKey) {
    try {
      const url = new URL("https://newsapi.org/v2/everything");
      url.searchParams.set("q", `${symbol} stock`);
      url.searchParams.set("language", "en");
      url.searchParams.set("sortBy", "publishedAt");
      url.searchParams.set("pageSize", "5");
      url.searchParams.set("apiKey", ENV.newsApiKey);
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        if (data.status === "ok" && data.articles) {
          const headlines = data.articles.map((a: any) => `${a.title} ${a.description}`).join(" ");
          const positiveWords = ["surge", "jump", "gain", "rise", "bullish", "beat", "strong", "growth", "upgrade"];
          const negativeWords = ["drop", "fall", "decline", "bearish", "miss", "weak", "loss", "downgrade", "crash"];
          let posCount = 0;
          let negCount = 0;
          positiveWords.forEach((word) => {
            posCount += (headlines.toLowerCase().match(new RegExp(word, "g")) || []).length;
          });
          negativeWords.forEach((word) => {
            negCount += (headlines.toLowerCase().match(new RegExp(word, "g")) || []).length;
          });
          sentimentScore = posCount > negCount ? 0.3 : negCount > posCount ? -0.3 : 0;
        }
      }
    } catch {
      // ignore sentiment failures
    }
  }

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an expert technical analyst. Based on current market data and sentiment, generate a trading signal.
Analyze ONLY the ticker provided by the user. Do not reference any other ticker.
Do not mention personal trade history, closed trades, or historical trades; this endpoint only provides market quote and sentiment data.

Return JSON with:
- signal: "BUY", "SELL", or "HOLD"
- confidence: number 0-100
- reasoning: detailed technical analysis
- entryPrice: suggested entry price (can be "current" for market order)
- stopLoss: suggested stop loss price or percentage
- takeProfit: suggested take profit price or percentage
- timeframe: recommended holding period`,
      },
      {
        role: "user",
        content: `Generate a trading signal for ${symbol}:

CURRENT DATA:
- Current Price: $${currentPrice.toFixed(2)}
- Previous Close: $${prevClose.toFixed(2)}
- Change: ${change >= 0 ? "+" : ""}$${change.toFixed(2)} (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%)
- Sentiment Score: ${sentimentScore.toFixed(2)} (-1 to 1 scale)

RECENT MARKET CONTEXT:
Price is ${changePercent >= 0 ? "up" : "down"} ${Math.abs(changePercent).toFixed(2)}% from yesterday.
${sentimentScore > 0.1 ? "Positive news sentiment detected." : sentimentScore < -0.1 ? "Negative news sentiment detected." : "Neutral sentiment."}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "trading_signal",
        strict: true,
        schema: {
          type: "object",
          properties: {
            signal: { type: "string", enum: ["BUY", "SELL", "HOLD"] },
            confidence: { type: "number", minimum: 0, maximum: 100 },
            reasoning: { type: "string" },
            entryPrice: { type: "string" },
            stopLoss: { type: "string" },
            takeProfit: { type: "string" },
            timeframe: { type: "string" },
          },
          required: ["signal", "confidence", "reasoning", "entryPrice", "stopLoss", "takeProfit", "timeframe"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const result = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
  return {
    symbol,
    signal: result.signal || "HOLD",
    confidence: Math.min(100, Math.max(0, result.confidence || 50)),
    reasoning: sanitizeMarketSignalReasoning(symbol, result.reasoning, currentPrice, changePercent, sentimentScore),
    entryPrice: result.entryPrice || "current",
    stopLoss: result.stopLoss || "5%",
    takeProfit: result.takeProfit || "10%",
    timeframe: result.timeframe || "1-3 days",
    currentPrice,
    changePercent,
    sentimentScore,
  };
}

async function fetchEconomicCalendar() {
  const now = new Date();
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + 7);
  const today = formatCalendarDate(now);
  const tomorrow = formatCalendarDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const endDate = formatCalendarDate(nextWeek);
  const events: Array<{
    event: string;
    country: string;
    date: string;
    impact: string;
    description: string;
    source?: string;
    category?: string;
    symbol?: string;
  }> = [
    {
      event: "FOMC Rate Decision",
      country: "US",
      date: `${today} 14:00 ET`,
      impact: "High",
      category: "Macro",
      source: "Federal Reserve calendar",
      description: "Federal Reserve policy statement is scheduled for 2:00 PM ET, followed by the Chair press conference around 2:30 PM ET. Expect elevated SPY, QQQ, TLT and USD volatility.",
    },
    {
      event: "Q1 GDP Advance Estimate",
      country: "US",
      date: `${tomorrow} 08:30 ET`,
      impact: "High",
      category: "Macro",
      source: "BEA release schedule",
      description: "Advance estimate for US GDP can reset growth expectations and affect indexes, yields, and cyclical sectors.",
    },
    {
      event: "PCE Inflation Watch",
      country: "US",
      date: `${tomorrow} 08:30 ET`,
      impact: "High",
      category: "Macro",
      source: "Economic calendar",
      description: "Inflation data around the Fed decision can change rate-cut expectations and move growth stocks sharply.",
    },
  ];
  const marketFocusEarnings = MARKET_FOCUS_EARNINGS_BY_DATE[today] ?? [];
  events.push(...marketFocusEarnings.map((item) => ({
    event: `${item.symbol} Earnings (${item.timing})`,
    country: "US",
    date: today,
    impact: "High",
    category: "Market Focus",
    source: "Curated market focus",
    symbol: item.symbol,
    description: `${item.company} reports today. Why traders care: ${item.watch}`,
  })));

  if (ENV.finnhubApiKey) {
    try {
      const response = await finnhubRequest("/calendar/economic", {
        from: today,
        to: endDate,
      }) as any;
      if (Array.isArray(response.economic)) {
        events.push(...response.economic.map((event: any) => ({
          event: event.name || event.title || "Economic event",
          country: event.country || event.region || "Global",
          date: event.date || event.time || today,
          impact: event.impact || "Medium",
          category: "Macro",
          source: "Finnhub economic calendar",
          description: event.description || "Upcoming macroeconomic event.",
        })));
      }
    } catch {
      // Keep curated macro events if provider fails.
    }

    try {
      const earnings = await finnhubRequest("/calendar/earnings", {
        from: today,
        to: endDate,
      }) as any;
      const earningsRows = Array.isArray(earnings.earningsCalendar) ? earnings.earningsCalendar : [];
      const importantSymbols = new Set(["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "AMD", "NFLX", "AVGO"]);
      events.push(...earningsRows
        .filter((row: any) => importantSymbols.has(String(row.symbol ?? "").toUpperCase()) || parseCalendarDate(row.date) === today)
        .slice(0, 25)
        .map((row: any) => {
          const symbol = String(row.symbol ?? "").toUpperCase();
          const hour = row.hour ? ` (${row.hour})` : "";
          const epsEstimate = row.epsEstimate != null ? ` EPS est. ${row.epsEstimate}.` : "";
          const revenueEstimate = row.revenueEstimate != null ? ` Revenue est. ${Number(row.revenueEstimate).toLocaleString()}.` : "";
          return {
            event: `${symbol} Earnings${hour}`,
            country: "US",
            date: parseCalendarDate(row.date) || today,
            impact: importantSymbols.has(symbol) ? "High" : "Medium",
            category: "Earnings",
            source: "Finnhub earnings calendar",
            symbol,
            description: `${symbol} reports earnings.${epsEstimate}${revenueEstimate} Watch guidance, margins, AI/capex commentary, and peer read-through.`,
          };
        }));
    } catch {
      // Earnings are additive; keep macro events if this fails.
    }
  }

  const seen = new Set<string>();
  return events
    .filter((event) => {
      const symbolKey = "symbol" in event && event.symbol ? String(event.symbol).toUpperCase() : "";
      const key = symbolKey && /earnings/i.test(event.event)
        ? `earnings-${symbolKey}-${parseCalendarDate(event.date)}`
        : `${event.event.toLowerCase()}-${parseCalendarDate(event.date)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aToday = parseCalendarDate(a.date) === today ? 0 : 1;
      const bToday = parseCalendarDate(b.date) === today ? 0 : 1;
      if (aToday !== bToday) return aToday - bToday;
      const impactRank: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
      const impactDiff = (impactRank[a.impact] ?? 3) - (impactRank[b.impact] ?? 3);
      if (impactDiff !== 0) return impactDiff;
      const focusRank = (event: typeof a) => {
        if (event.event.includes("FOMC")) return 0;
        if (event.category === "Market Focus") return 1;
        if (event.category === "Earnings") return 2;
        return 3;
      };
      const focusDiff = focusRank(a) - focusRank(b);
      if (focusDiff !== 0) return focusDiff;
      return calendarSortValue(a.date) - calendarSortValue(b.date);
    });
}

async function fetchPriceHistory(symbol: string, timeframe: string) {
  const resolution = resolutionToFinnhub(timeframe);
  const now = Math.floor(Date.now() / 1000);
  const lookbackSeconds = resolution === "M" ? 60 * 60 * 24 * 365 : resolution === "W" ? 60 * 60 * 24 * 200 : 60 * 60 * 24 * 90;
  const from = now - lookbackSeconds;
  const candles = await finnhubRequest("/stock/candle", {
    symbol,
    resolution,
    from: from.toString(),
    to: now.toString(),
  }) as any;
  if (candles.s !== "ok" || !Array.isArray(candles.c)) {
    throw new Error("Failed to fetch price history");
  }
  return candles;
}

function detectRegimeFromSeries(close: number[]) {
  if (close.length < 10) {
    return { regime: "unknown", confidence: 0, slope: 0, rangeRatio: 0, volatility: 0 };
  }
  const first = close[0];
  const last = close[close.length - 1];
  const mean = close.reduce((sum, v) => sum + v, 0) / close.length;
  const slope = (last - first) / first;
  const maxClose = Math.max(...close);
  const minClose = Math.min(...close);
  const rangeRatio = (maxClose - minClose) / mean;
  const returns = close.slice(1).map((value, idx) => (value - close[idx]) / close[idx]);
  const volatility = Math.sqrt(returns.reduce((sum, v) => sum + v * v, 0) / returns.length);

  if (Math.abs(slope) > 0.05 && rangeRatio > 0.08 && volatility > 0.01) {
    return { regime: "trending", confidence: Math.min(0.98, 0.45 + Math.abs(slope) * 3), slope, rangeRatio, volatility };
  }
  if (Math.abs(slope) < 0.02 && rangeRatio < 0.08 && volatility < 0.02) {
    return { regime: "ranging", confidence: Math.min(0.92, 0.45 + (0.08 - rangeRatio) * 3), slope, rangeRatio, volatility };
  }
  return { regime: "mixed", confidence: Math.min(0.9, 0.45 + Math.abs(slope) * 1.8), slope, rangeRatio, volatility };
}

async function detectMarketRegime(symbol: string, timeframe: string) {
  const candles = await fetchPriceHistory(symbol, timeframe);
  const close = (candles.c as number[]).slice(-45);
  const result = detectRegimeFromSeries(close);
  return {
    symbol,
    timeframe,
    regime: result.regime,
    confidence: Math.round(result.confidence * 100),
    metrics: {
      slopePercent: Number((result.slope * 100).toFixed(2)),
      rangeRatio: Number(result.rangeRatio.toFixed(3)),
      volatility: Number(result.volatility.toFixed(4)),
    },
    narrative: result.regime === "trending"
      ? `The market is moving in a strong ${result.slope > 0 ? "uptrend" : "downtrend"} with ${Number((result.rangeRatio * 100).toFixed(1))}% range relative to average price.`
      : result.regime === "ranging"
        ? `Price action is tight and oscillating, indicating a range-bound market.`
        : `The market shows mixed behavior with both trending and consolidating characteristics.`,
  };
}

async function identifyChartPatterns(symbol: string, timeframe: string) {
  const candles = await fetchPriceHistory(symbol, timeframe);
  const close = candles.c as number[];
  const high = candles.h as number[];
  const low = candles.l as number[];
  const open = candles.o as number[];
  const sampleCount = Math.min(30, close.length);
  const seriesSnippet = close.slice(-sampleCount).map((v) => v.toFixed(2)).join(", ");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an expert technical analyst who identifies classic price patterns, regime signals, and momentum context.
Return strict JSON only, with:
- symbol
- timeframe
- patterns: array of { name, confidence, description }
- summary
- regimeSignal`,
      },
      {
        role: "user",
        content: `Analyze ${symbol} price action over the last ${sampleCount} bars on ${timeframe}.
Close: ${seriesSnippet}
High: ${high.slice(-sampleCount).map((v: number) => v.toFixed(2)).join(", ")}
Low: ${low.slice(-sampleCount).map((v: number) => v.toFixed(2)).join(", ")}
Open: ${open.slice(-sampleCount).map((v: number) => v.toFixed(2)).join(", ")}

Please identify any patterns such as head and shoulders, double tops/bottoms, flags, triangles, channels, or consolidation, and include a clear summary and regime signal.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "chart_pattern_analysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            symbol: { type: "string" },
            timeframe: { type: "string" },
            patterns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  confidence: { type: "number", minimum: 0, maximum: 100 },
                  description: { type: "string" },
                },
                required: ["name", "confidence", "description"],
              },
            },
            summary: { type: "string" },
            regimeSignal: { type: "string" },
          },
          required: ["symbol", "timeframe", "patterns", "summary", "regimeSignal"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const result = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
  return {
    symbol: result.symbol || symbol,
    timeframe: result.timeframe || timeframe,
    patterns: result.patterns || [],
    summary: result.summary || "No significant chart pattern detected.",
    regimeSignal: result.regimeSignal || "unknown",
  };
}

async function analyzeEmotionalState(transcript: string) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a trading psychologist. Evaluate the trader's emotional state and decision-making style from their transcript.
Return strict JSON only with:
- mood
- bias
- confidence
- stressLevel
- recommendation`,
      },
      {
        role: "user",
        content: `Assess the trader from this transcript:
${transcript}

Focus on emotional state, bias, confidence, and whether they are under stress or overtrading.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "emotional_state_analysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            mood: { type: "string" },
            bias: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 100 },
            stressLevel: { type: "string" },
            recommendation: { type: "string" },
          },
          required: ["mood", "bias", "confidence", "stressLevel", "recommendation"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const result = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
  return {
    mood: result.mood || "neutral",
    bias: result.bias || "balanced",
    confidence: Math.min(100, Math.max(0, result.confidence || 50)),
    stressLevel: result.stressLevel || "moderate",
    recommendation: result.recommendation || "Keep a trading journal and review your emotional triggers after each session.",
  };
}

async function getLearningRecommendations(userId: number, style: string, focus: string) {
  const userTrades = await getTradesByUser(userId, 200);
  const tradeSummary = userTrades.length > 0
    ? `Recent trades: ${userTrades.slice(-5).map((t) => `${t.symbol} ${t.side} ${t.status}`).join(", ")}.`
    : "No recent trades recorded.";

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a trading educator. Suggest concise, actionable learning resources tailored for the trader's style and current needs.
Return strict JSON only with:
- focus
- recommendations: array of { title, type, link, why }`,
      },
      {
        role: "user",
        content: `The trader's style is ${style}. They want help with ${focus}.
${tradeSummary}

Provide 3 to 5 learning resources including books, articles, videos, or frameworks.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "learning_recommendations",
        strict: true,
        schema: {
          type: "object",
          properties: {
            focus: { type: "string" },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  type: { type: "string" },
                  link: { type: "string" },
                  why: { type: "string" },
                },
                required: ["title", "type", "link", "why"],
              },
            },
          },
          required: ["focus", "recommendations"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const result = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
  return {
    focus: result.focus || focus,
    recommendations: result.recommendations || [],
  };
}

function calculateKelly(winRate: number, avgWin: number, avgLoss: number) {
  if (avgLoss <= 0 || winRate <= 0) {
    return { kelly: 0, optimalF: 0, recommendedRisk: 0 };
  }
  const r = avgWin / Math.abs(avgLoss);
  if (r <= 0) {
    return { kelly: 0, optimalF: 0, recommendedRisk: 0 };
  }
  const kelly = clamp(winRate - (1 - winRate) / r, 0, 1);
  const optimalF = clamp(kelly * 0.5, 0, 1);
  return { kelly, optimalF, recommendedRisk: optimalF };
}

function pearsonCorrelation(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const meanA = a.reduce((sum, v) => sum + v, 0) / n;
  const meanB = b.reduce((sum, v) => sum + v, 0) / n;
  let num = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom === 0 ? 0 : clamp(num / denom, -1, 1);
}

function percentile(sortedValues: number[], pct: number) {
  if (!sortedValues.length) return 0;
  const idx = (sortedValues.length - 1) * pct;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function normalizeDateKey(date?: Date | string) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

function buildTraderProfileContext(prefs: UserPreference) {
  const fields = [
    ["Trading style", prefs.tradingStyle],
    ["Experience level", prefs.experienceLevel],
    ["Account size", prefs.accountSize ? `$${Number(prefs.accountSize).toLocaleString()}` : ""],
    ["Risk per trade", prefs.riskPerTrade ? `${prefs.riskPerTrade}%` : ""],
    ["Max daily loss", prefs.maxDailyLoss ? `$${Number(prefs.maxDailyLoss).toLocaleString()}` : ""],
    ["Main weakness", prefs.mainWeakness],
    ["Primary goal", prefs.primaryGoal],
    ["Favorite tickers", prefs.favoriteTickers],
    ["Coach strictness", prefs.coachStrictness],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");

  if (fields.length === 0) return "";

  return `\n\nTrader profile:\n${fields.map(([label, value]) => `- ${label}: ${value}`).join("\n")}

Use this profile to personalize coaching. Tie advice to their risk limits, goal, trading style, and recurring weakness. If they are near or beyond a risk rule, call that out clearly. Do not repeat the full profile back unless asked.`;
}

function buildDailyPlanContext(plan?: z.infer<typeof dailyPlanInput>) {
  if (!plan) return "";
  const fields = [
    ["Date", plan.date],
    ["Market bias", plan.marketBias],
    ["Focus tickers", plan.focusTickers],
    ["Key levels", plan.keyLevels],
    ["A+ setup", plan.aPlusSetup],
    ["No-trade rules", plan.noTradeRules],
    ["Max daily loss", plan.maxLoss ? `$${plan.maxLoss}` : ""],
    ["Max trades", plan.maxTrades],
    ["Pre-market checklist", plan.preMarketChecks?.length ? `${plan.preMarketChecks.length} completed` : ""],
    ["Entry checklist", plan.executionChecks?.length ? `${plan.executionChecks.length} completed` : ""],
    ["Post-market recap", plan.postMarketRecap],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");

  if (fields.length === 0) return "";

  return `\n\nToday's trading plan:\n${fields.map(([label, value]) => `- ${label}: ${value}`).join("\n")}

Use today's plan as the trader's source of truth. If their proposed trade violates the A+ setup, no-trade rules, max loss, max trades, or checklist discipline, warn them directly before giving any tactical advice. If the plan is incomplete, ask them to finish the missing plan item first.`;
}

// ─── Coach Personalities ──────────────────────────────────────────────────────

const COACH_PROMPTS = {
  sergeant: `You are a tough but fair trading sergeant. You speak directly, hold traders accountable, 
  call out mistakes bluntly, and push them to be disciplined. You use military-style language occasionally. 
  You don't sugarcoat losses but you celebrate real wins. Keep responses concise and punchy.`,
  friend: `You are a supportive trading friend who genuinely cares about the trader's success and wellbeing. 
  You celebrate wins enthusiastically, empathize with losses, and offer encouragement. 
  You give practical advice in a warm, conversational tone. You ask follow-up questions to understand their situation better.`,
  expert: `You are an expert trading coach with deep knowledge of technical analysis, risk management, 
  market psychology, and trading strategies. You provide data-driven insights, reference specific concepts 
  (R-multiples, expectancy, Sharpe ratio, etc.), and give sophisticated analysis. 
  You treat the trader as a professional and expect them to understand advanced concepts.`,
};

// ─── App Router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Preferences ────────────────────────────────────────────────────────────

  preferences: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return getOrCreatePreferences(ctx.user.id);
    }),
    update: protectedProcedure
      .input(
        z.object({
          coachMode: z.enum(["sergeant", "friend", "expert"]).optional(),
          accountSize: z.string().optional(),
          riskPerTrade: z.string().optional(),
          maxDailyLoss: z.string().optional(),
          tradingStyle: z.enum(["scalper", "day_trader", "swing_trader", "position_trader", "options_trader"]).optional(),
          experienceLevel: z.enum(["beginner", "intermediate", "advanced", "professional"]).optional(),
          mainWeakness: z.string().max(255).optional(),
          primaryGoal: z.string().max(255).optional(),
          favoriteTickers: z.string().optional(),
          coachStrictness: z.enum(["gentle", "balanced", "strict"]).optional(),
          notificationsEnabled: z.boolean().optional(),
          isPremium: z.boolean().optional(),
          tradierToken: z.string().optional(),
          tradierAccountId: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const data: Record<string, unknown> = { ...input };
        for (const key of ["accountSize", "riskPerTrade", "maxDailyLoss", "mainWeakness", "primaryGoal", "favoriteTickers", "tradierToken", "tradierAccountId"]) {
          if (data[key] === "") data[key] = null;
        }
        if (typeof data.favoriteTickers === "string") {
          data.favoriteTickers = data.favoriteTickers
            .split(",")
            .map((symbol) => symbol.trim().toUpperCase())
            .filter(Boolean)
            .join(", ");
        }
        await updatePreferences(ctx.user.id, data as any);
        return { success: true };
      }),
  }),
  // ─── Advanced AI Trading Assistant ──────────────────────────────────────────

  aiAssistant: router({
    // Predictive Analytics: ML models to predict trade outcomes based on historical patterns
    predictTradeOutcomes: protectedProcedure
      .input(z.object({
        symbol: z.string(),
        side: z.enum(["buy", "sell", "short", "cover"]),
        entryPrice: z.string(),
        quantity: z.string(),
        stopLoss: z.string().optional(),
        takeProfit: z.string().optional(),
        timeframe: z.enum(["1D", "1W", "1M"]).default("1D"),
      }))
      .query(async ({ ctx, input }) => {
        const prefs = await getOrCreatePreferences(ctx.user.id);
        if (!prefs.isPremium && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "AI Trading Assistant requires a premium subscription." });
        }

        // Get historical trades for this symbol to build prediction model
        const userTrades = await getTradesByUser(ctx.user.id, 1000);
        const symbolTrades = userTrades.filter(t => t.symbol === input.symbol && t.status === "closed");
        const hasEnoughPersonalHistory = symbolTrades.length >= 5;

        // Calculate historical performance metrics
        const wins = symbolTrades.filter(t => parseFloat(t.pnl ?? "0") > 0);
        const losses = symbolTrades.filter(t => parseFloat(t.pnl ?? "0") < 0);
        const winRate = symbolTrades.length > 0 ? wins.length / symbolTrades.length : 0;
        const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0) / losses.length : 0;
        const entry = parseDecimal(input.entryPrice);
        const stop = input.stopLoss ? parseDecimal(input.stopLoss) : 0;
        const target = input.takeProfit ? parseDecimal(input.takeProfit) : 0;
        const riskPerShare = stop > 0 ? Math.abs(entry - stop) : 0;
        const rewardPerShare = target > 0 ? Math.abs(target - entry) : 0;
        const riskReward = riskPerShare > 0 && rewardPerShare > 0 ? rewardPerShare / riskPerShare : null;

        // Get current market data
        let currentPrice = 0;
        try {
          if (ENV.finnhubApiKey) {
            const quote = await finnhubRequest("/quote", { symbol: input.symbol }) as any;
            currentPrice = quote.c || 0;
          }
        } catch (error) {
          console.warn("Could not fetch current price for prediction:", error);
        }

        // Use LLM to analyze patterns and make prediction
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are an expert trading analyst. Analyze a proposed trade using current market context, catalyst awareness, risk/reward, price location, volatility risk, and execution quality.
If personal history is provided, you may use it quietly as one signal. Never mention missing personal trade history, closed-trade counts, lack of edge, or lack of expertise. Do not apologize for missing history. Give the trader useful market analysis immediately.
              
Return a JSON analysis with:
- prediction: "bullish", "bearish", or "neutral"
- confidence: number 0-100 (percentage). Cap confidence at 60 when the setup lacks a clear catalyst or live market confirmation.
- reasoning: detailed explanation based on setup quality, current price context, catalyst/sector context, and risk/reward
- expectedReturn: expected percentage return
- riskScore: risk level 1-10 (10 being highest risk)
- keyFactors: array of strings describing what influenced the prediction`,
            },
            {
              role: "user",
              content: `Analyze this proposed trade and predict its outcome:

TRADE PROPOSAL:
- Symbol: ${input.symbol}
- Side: ${input.side}
- Entry Price: $${input.entryPrice}
- Quantity: ${input.quantity}
- Stop Loss: ${input.stopLoss ? "$" + input.stopLoss : "none"}
- Take Profit: ${input.takeProfit ? "$" + input.takeProfit : "none"}
- Timeframe: ${input.timeframe}

CURRENT MARKET:
- Current Price: $${currentPrice.toFixed(2)}
- Risk/Reward: ${riskReward ? `${riskReward.toFixed(2)}:1` : "not fully defined"}

${hasEnoughPersonalHistory ? `PERSONAL PERFORMANCE CONTEXT:
- Win Rate: ${(winRate * 100).toFixed(1)}%
- Average Win: $${avgWin.toFixed(2)}
- Average Loss: $${avgLoss.toFixed(2)}
- Total P&L: $${symbolTrades.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0).toFixed(2)}

RECENT TRADES:
${symbolTrades.slice(-10).map(t => 
  `${t.side} @$${t.entryPrice} → $${t.exitPrice || "open"} P&L:$${t.pnl || "N/A"}`
).join("\n")}` : "No personal performance context is included. Analyze the trade from market setup, price, risk/reward, and execution quality only. Do not mention missing history."}`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "trade_prediction",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  prediction: { type: "string", enum: ["bullish", "bearish", "neutral"] },
                  confidence: { type: "number", minimum: 0, maximum: 100 },
                  reasoning: { type: "string" },
                  expectedReturn: { type: "number" },
                  riskScore: { type: "number", minimum: 1, maximum: 10 },
                  keyFactors: { type: "array", items: { type: "string" } },
                },
                required: ["prediction", "confidence", "reasoning", "expectedReturn", "riskScore", "keyFactors"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices[0]?.message?.content ?? "{}";
        const result = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));

        return {
          prediction: result.prediction || "neutral",
          confidence: Math.min(hasEnoughPersonalHistory ? 100 : 55, Math.max(0, result.confidence || (hasEnoughPersonalHistory ? 50 : 35))),
          reasoning: sanitizePredictionReasoning(result.reasoning, input.symbol, input.side, currentPrice, riskReward),
          expectedReturn: result.expectedReturn || 0,
          riskScore: Math.min(10, Math.max(1, result.riskScore || 5)),
          keyFactors: sanitizePredictionFactors(Array.isArray(result.keyFactors) ? result.keyFactors : [], input.symbol, riskReward),
        };
      }),

    // Market Sentiment Analysis: Integrate social media and news sentiment scoring
    getSentimentAnalysis: protectedProcedure
      .input(z.object({ symbols: z.array(z.string()) }))
      .query(async ({ ctx, input }) => {
        const prefs = await getOrCreatePreferences(ctx.user.id);
        if (!prefs.isPremium && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Sentiment analysis requires a premium subscription." });
        }

        const results = [];

        for (const symbol of input.symbols.slice(0, 5)) {
          try {
            // Get recent news for sentiment analysis
            let newsArticles = [];
            if (ENV.newsApiKey) {
              const url = new URL("https://newsapi.org/v2/everything");
              url.searchParams.set("q", `${symbol} stock`);
              url.searchParams.set("language", "en");
              url.searchParams.set("sortBy", "publishedAt");
              url.searchParams.set("pageSize", "10");
              url.searchParams.set("apiKey", ENV.newsApiKey);

              const res = await fetch(url.toString());
              if (res.ok) {
                const data = await res.json();
                if (data.status === "ok") {
                  newsArticles = data.articles || [];
                }
              }
            }

            // Analyze sentiment using LLM
            const newsText = newsArticles.slice(0, 5).map((a: any) => 
              `${a.title || ""} ${a.description || ""}`
            ).join(" ");

            if (newsText.length > 100) {
              const response = await invokeLLM({
                messages: [
                  {
                    role: "system",
                    content: `Analyze the sentiment of recent news articles about a stock. Return a JSON object with:
- overallSentiment: "positive", "negative", or "neutral"
- sentimentScore: number -1 to 1 (-1 very negative, 0 neutral, 1 very positive)
- confidence: number 0-100
- keyThemes: array of main themes/topics mentioned
- summary: brief summary of sentiment`,
                  },
                  {
                    role: "user",
                    content: `Analyze the sentiment of recent news about ${symbol}:\n\n${newsText}`,
                  },
                ],
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "sentiment_analysis",
                    strict: true,
                    schema: {
                      type: "object",
                      properties: {
                        overallSentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
                        sentimentScore: { type: "number", minimum: -1, maximum: 1 },
                        confidence: { type: "number", minimum: 0, maximum: 100 },
                        keyThemes: { type: "array", items: { type: "string" } },
                        summary: { type: "string" },
                      },
                      required: ["overallSentiment", "sentimentScore", "confidence", "keyThemes", "summary"],
                      additionalProperties: false,
                    },
                  },
                },
              });

              const content = response.choices[0]?.message?.content ?? "{}";
              const result = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));

              results.push({
                symbol,
                sentiment: result.overallSentiment || "neutral",
                score: result.sentimentScore || 0,
                confidence: result.confidence || 50,
                keyThemes: result.keyThemes || [],
                summary: result.summary || "Analysis unavailable",
                articleCount: newsArticles.length,
              });
            } else {
              results.push({
                symbol,
                sentiment: "neutral",
                score: 0,
                confidence: 0,
                keyThemes: [],
                summary: "Insufficient news data for analysis",
                articleCount: newsArticles.length,
              });
            }
          } catch (error) {
            console.warn(`Sentiment analysis failed for ${symbol}:`, error);
            results.push({
              symbol,
              sentiment: "neutral",
              score: 0,
              confidence: 0,
              keyThemes: [],
              summary: "Analysis failed",
              articleCount: 0,
            });
          }
        }

        return results;
      }),

    // Automated Trade Suggestions: AI-powered entry/exit signals with confidence scores
    getTradeSignals: protectedProcedure
      .input(z.object({ symbols: z.array(z.string()) }))
      .query(async ({ ctx, input }) => {
        const prefs = await getOrCreatePreferences(ctx.user.id);
        if (!prefs.isPremium && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Trade signals require a premium subscription." });
        }

        const signals = [];

        for (const symbol of input.symbols.slice(0, 10)) {
          try {
            // Get current market data
            let currentPrice = 0, prevClose = 0, change = 0, changePercent = 0;
            if (ENV.finnhubApiKey) {
              const quote = await finnhubRequest("/quote", { symbol }) as any;
              currentPrice = quote.c || 0;
              prevClose = quote.pc || 0;
              change = quote.d || 0;
              changePercent = quote.dp || 0;
            }

            // Get recent news sentiment
            let sentimentScore = 0;
            if (ENV.newsApiKey) {
              try {
                const url = new URL("https://newsapi.org/v2/everything");
                url.searchParams.set("q", `${symbol} stock`);
                url.searchParams.set("language", "en");
                url.searchParams.set("sortBy", "publishedAt");
                url.searchParams.set("pageSize", "5");
                url.searchParams.set("apiKey", ENV.newsApiKey);

                const res = await fetch(url.toString());
                if (res.ok) {
                  const data = await res.json();
                  if (data.status === "ok" && data.articles) {
                    const headlines = data.articles.map((a: any) => `${a.title} ${a.description}`).join(" ");
                    // Simple sentiment scoring (could be enhanced with proper NLP)
                    const positiveWords = ["surge", "jump", "gain", "rise", "bullish", "beat", "strong", "growth", "upgrade"];
                    const negativeWords = ["drop", "fall", "decline", "bearish", "miss", "weak", "loss", "downgrade", "crash"];

                    let posCount = 0, negCount = 0;
                    positiveWords.forEach(word => {
                      posCount += (headlines.toLowerCase().match(new RegExp(word, 'g')) || []).length;
                    });
                    negativeWords.forEach(word => {
                      negCount += (headlines.toLowerCase().match(new RegExp(word, 'g')) || []).length;
                    });

                    sentimentScore = posCount > negCount ? 0.3 : negCount > posCount ? -0.3 : 0;
                  }
                }
              } catch (error) {
                console.warn("News sentiment fetch failed:", error);
              }
            }

            // Generate trading signal using LLM analysis
            const response = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content: `You are an expert technical analyst. Based on current market data and sentiment, generate a trading signal.
Analyze ONLY the ticker provided by the user. Do not reference any other ticker.
Do not mention personal trade history, closed trades, or historical trades; this endpoint only provides market quote and sentiment data.
                  
Return JSON with:
- signal: "BUY", "SELL", or "HOLD"
- confidence: number 0-100
- reasoning: detailed technical analysis
- entryPrice: suggested entry price (can be "current" for market order)
- stopLoss: suggested stop loss price or percentage
- takeProfit: suggested take profit price or percentage
- timeframe: recommended holding period`,
                },
                {
                  role: "user",
                  content: `Generate a trading signal for ${symbol}:

CURRENT DATA:
- Current Price: $${currentPrice.toFixed(2)}
- Previous Close: $${prevClose.toFixed(2)}
- Change: ${change >= 0 ? "+" : ""}$${change.toFixed(2)} (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%)
- Sentiment Score: ${sentimentScore.toFixed(2)} (-1 to 1 scale)

RECENT MARKET CONTEXT:
Price is ${changePercent >= 0 ? "up" : "down"} ${Math.abs(changePercent).toFixed(2)}% from yesterday.
${sentimentScore > 0.1 ? "Positive news sentiment detected." : sentimentScore < -0.1 ? "Negative news sentiment detected." : "Neutral sentiment."}`,
                },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "trading_signal",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      signal: { type: "string", enum: ["BUY", "SELL", "HOLD"] },
                      confidence: { type: "number", minimum: 0, maximum: 100 },
                      reasoning: { type: "string" },
                      entryPrice: { type: "string" },
                      stopLoss: { type: "string" },
                      takeProfit: { type: "string" },
                      timeframe: { type: "string" },
                    },
                    required: ["signal", "confidence", "reasoning", "entryPrice", "stopLoss", "takeProfit", "timeframe"],
                    additionalProperties: false,
                  },
                },
              },
            });

            const content = response.choices[0]?.message?.content ?? "{}";
            const result = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));

            signals.push({
              symbol,
              signal: result.signal || "HOLD",
              confidence: Math.min(100, Math.max(0, result.confidence || 50)),
              reasoning: sanitizeMarketSignalReasoning(symbol, result.reasoning, currentPrice, changePercent, sentimentScore),
              entryPrice: result.entryPrice || "current",
              stopLoss: result.stopLoss || "5%",
              takeProfit: result.takeProfit || "10%",
              timeframe: result.timeframe || "1-3 days",
              currentPrice,
              changePercent,
              sentimentScore,
            });
          } catch (error) {
            console.warn(`Signal generation failed for ${symbol}:`, error);
            signals.push({
              symbol,
              signal: "HOLD",
              confidence: 0,
              reasoning: "Signal generation failed",
              entryPrice: "current",
              stopLoss: "5%",
              takeProfit: "10%",
              timeframe: "N/A",
              currentPrice: 0,
              changePercent: 0,
              sentimentScore: 0,
            });
          }
        }

        return signals;
      }),

    // Portfolio Optimization: Suggest position sizing and diversification strategies
    optimizePortfolio: protectedProcedure
      .input(z.object({
        accountSize: z.string(),
        riskTolerance: z.enum(["conservative", "moderate", "aggressive"]).default("moderate"),
        currentPositions: z.array(z.object({
          symbol: z.string(),
          quantity: z.string(),
          avgPrice: z.string(),
          currentPrice: z.string(),
        })).optional(),
        targetSymbols: z.array(z.string()).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const prefs = await getOrCreatePreferences(ctx.user.id);
        if (!prefs.isPremium && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Portfolio optimization requires a premium subscription." });
        }

        const accountSize = parseFloat(input.accountSize);
        if (isNaN(accountSize) || accountSize <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid account size" });
        }

        // Get user's trading history for risk assessment
        const userTrades = await getTradesByUser(ctx.user.id, 500);
        const closedTrades = userTrades.filter(t => t.status === "closed");

        // Calculate user's risk metrics
        const totalPnl = closedTrades.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0);
        const winRate = closedTrades.length > 0 ? 
          closedTrades.filter(t => parseFloat(t.pnl ?? "0") > 0).length / closedTrades.length : 0.5;
        const avgWin = closedTrades.filter(t => parseFloat(t.pnl ?? "0") > 0)
          .reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0) / Math.max(1, closedTrades.filter(t => parseFloat(t.pnl ?? "0") > 0).length);
        const avgLoss = Math.abs(closedTrades.filter(t => parseFloat(t.pnl ?? "0") < 0)
          .reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0) / Math.max(1, closedTrades.filter(t => parseFloat(t.pnl ?? "0") < 0).length));

        // Risk per trade based on account size and risk tolerance
        const riskPerTradePercent = input.riskTolerance === "conservative" ? 0.5 :
                                   input.riskTolerance === "moderate" ? 1.0 : 2.0;
        const riskPerTrade = (accountSize * riskPerTradePercent) / 100;

        // Kelly Criterion calculation
        const kellyPercent = winRate - ((1 - winRate) / (avgWin / Math.max(avgLoss, 0.01)));
        const kellyPositionSize = Math.max(0, Math.min(0.25, kellyPercent)); // Cap at 25%

        // Get current positions
        const currentPositions = input.currentPositions || [];
        const currentAllocation = currentPositions.reduce((sum, pos) => {
          const qty = parseFloat(pos.quantity);
          const price = parseFloat(pos.currentPrice);
          return sum + (qty * price);
        }, 0);

        // Generate optimization recommendations
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a portfolio optimization expert. Provide position sizing and diversification recommendations.
              
Return JSON with:
- recommendedAllocations: array of position recommendations
- totalRisk: overall portfolio risk assessment
- diversificationScore: 1-10 score for diversification
- rebalancingActions: array of suggested actions
- riskMetrics: key risk measurements`,
            },
            {
              role: "user",
              content: `Optimize this portfolio:

ACCOUNT INFO:
- Total Capital: $${accountSize.toFixed(2)}
- Risk Tolerance: ${input.riskTolerance}
- Risk per Trade: $${riskPerTrade.toFixed(2)} (${riskPerTradePercent}% of account)

TRADING HISTORY:
- Total Trades: ${closedTrades.length}
- Win Rate: ${(winRate * 100).toFixed(1)}%
- Average Win: $${avgWin.toFixed(2)}
- Average Loss: $${avgLoss.toFixed(2)}
- Total P&L: $${totalPnl.toFixed(2)}

CURRENT POSITIONS:
${currentPositions.map(p => `${p.symbol}: ${p.quantity} shares @ $${p.avgPrice} (current: $${p.currentPrice})`).join("\n")}

TARGET SYMBOLS: ${input.targetSymbols?.join(", ") || "None specified"}

Please provide portfolio optimization recommendations including position sizing, diversification, and risk management.`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "portfolio_optimization",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  recommendedAllocations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        symbol: { type: "string" },
                        allocationPercent: { type: "number" },
                        positionSize: { type: "number" },
                        reasoning: { type: "string" },
                      },
                      required: ["symbol", "allocationPercent", "positionSize", "reasoning"],
                    },
                  },
                  totalRisk: { type: "string" },
                  diversificationScore: { type: "number", minimum: 1, maximum: 10 },
                  rebalancingActions: { type: "array", items: { type: "string" } },
                  riskMetrics: {
                    type: "object",
                    properties: {
                      maxDrawdown: { type: "string" },
                      sharpeRatio: { type: "string" },
                      volatility: { type: "string" },
                    },
                  },
                },
                required: ["recommendedAllocations", "totalRisk", "diversificationScore", "rebalancingActions", "riskMetrics"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices[0]?.message?.content ?? "{}";
        const result = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));

        return {
          recommendedAllocations: result.recommendedAllocations || [],
          totalRisk: result.totalRisk || "Medium",
          diversificationScore: Math.min(10, Math.max(1, result.diversificationScore || 5)),
          rebalancingActions: result.rebalancingActions || [],
          riskMetrics: result.riskMetrics || {
            maxDrawdown: "Unknown",
            sharpeRatio: "Unknown", 
            volatility: "Unknown",
          },
          kellyPositionSize,
          riskPerTrade,
          accountSize,
        };
      }),
  }),
  // ─── Broker & Automation ─────────────────────────────────────────────────────

  broker: router({
    getConnection: protectedProcedure.query(async ({ ctx }) => {
      const prefs = await getOrCreatePreferences(ctx.user.id);
      return {
        tradierAccountId: prefs.tradierAccountId ?? null,
        connected: Boolean(prefs.tradierToken && prefs.tradierAccountId),
      };
    }),

    validateConnection: protectedProcedure.query(async ({ ctx }) => {
      const prefs = await getOrCreatePreferences(ctx.user.id);
      if (!prefs.tradierToken || !prefs.tradierAccountId) {
        return { connected: false, message: "Broker credentials not configured." };
      }
      try {
        const result = await tradierRequest(prefs.tradierToken, `/accounts/${encodeURIComponent(prefs.tradierAccountId)}`);
        return {
          connected: true,
          account: (result as any).accounts?.account?.account_id || prefs.tradierAccountId,
          message: "Connection validated successfully.",
        };
      } catch (error) {
        return {
          connected: false,
          account: prefs.tradierAccountId,
          message: error instanceof Error ? error.message : "Unable to verify Tradier connection.",
        };
      }
    }),

    placeOrder: protectedProcedure
      .input(
        z.object({
          symbol: z.string().min(1).max(20).toUpperCase(),
          side: z.enum(["buy", "sell"]),
          quantity: z.string(),
          orderType: z.enum(["market", "limit"]).default("market"),
          duration: z.enum(["day", "gtc"]).default("day"),
          price: z.string().optional(),
          stopPrice: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const prefs = await getOrCreatePreferences(ctx.user.id);
        if (!prefs.tradierToken || !prefs.tradierAccountId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Tradier credentials are not configured." });
        }

        const params = new URLSearchParams();
        params.set("class", "equity");
        params.set("symbol", input.symbol);
        params.set("side", input.side);
        params.set("quantity", input.quantity);
        params.set("type", input.orderType);
        params.set("duration", input.duration);
        if (input.price) params.set("price", input.price);
        if (input.stopPrice) params.set("stop", input.stopPrice);

        const result = await tradierRequest(prefs.tradierToken, `/accounts/${encodeURIComponent(prefs.tradierAccountId)}/orders`, "POST", params);
        return { success: true, order: result };
      }),

    executeSignalOrder: protectedProcedure
      .input(z.object({ symbol: z.string().min(1).max(20).toUpperCase() }))
      .mutation(async ({ ctx, input }) => {
        const prefs = await getOrCreatePreferences(ctx.user.id);
        if (!prefs.isPremium && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Signal execution requires a premium subscription." });
        }
        if (!prefs.tradierToken || !prefs.tradierAccountId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Tradier credentials are not configured." });
        }

        const signal = await generateTradeSignal(input.symbol);
        if (signal.signal === "HOLD") {
          return { success: false, signal, message: "Signal is HOLD. No order was placed." };
        }

        const currentPrice = signal.currentPrice || 0;
        if (currentPrice <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Unable to retrieve current market price for order execution." });
        }

        const accountSize = Number(prefs.accountSize || "10000");
        const riskPercent = Number(prefs.riskPerTrade || "1");
        const riskAmount = Math.max(1, (accountSize * Math.max(0.1, Math.min(riskPercent, 10))) / 100);
        const quantity = Math.max(1, Math.floor(riskAmount / currentPrice)).toString();

        const params = new URLSearchParams();
        params.set("class", "equity");
        params.set("symbol", input.symbol);
        params.set("side", signal.signal === "BUY" ? "buy" : "sell");
        params.set("quantity", quantity);
        params.set("type", "market");
        params.set("duration", "day");

        const order = await tradierRequest(prefs.tradierToken, `/accounts/${encodeURIComponent(prefs.tradierAccountId)}/orders`, "POST", params);

        return {
          success: true,
          signal,
          order,
          placedQuantity: quantity,
          placedSide: signal.signal === "BUY" ? "buy" : "sell",
        };
      }),

    fetchEconomicCalendar: protectedProcedure.query(async () => {
      return fetchEconomicCalendar();
    }),
  }),
  // ─── Trades ─────────────────────────────────────────────────────────────────

  trades: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().default(100), offset: z.number().default(0) }))
      .query(async ({ ctx, input }) => {
        return getTradesByUser(ctx.user.id, input.limit, input.offset);
      }),

    byDateRange: protectedProcedure
      .input(z.object({ from: z.date(), to: z.date() }))
      .query(async ({ ctx, input }) => {
        return getTradesByDateRange(ctx.user.id, input.from, input.to);
      }),

    openTrades: protectedProcedure.query(async ({ ctx }) => {
      return getOpenTrades(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          symbol: z.string().min(1).max(20).toUpperCase(),
          side: z.enum(["buy", "sell", "short", "cover"]),
          quantity: z.string(),
          entryPrice: z.string(),
          exitPrice: z.string().optional(),
          pnl: z.string().optional(),
          takeProfit: z.string().optional(),
          takeProfit2: z.string().optional(),
          stopLoss: z.string().optional(),
          status: z.enum(["open", "closed"]).default("open"),
          notes: z.string().optional(),
          sessionId: z.number().optional(),
          tradeDate: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Auto-set status to closed if exitPrice is provided
        const status = input.exitPrice ? "closed" : input.status;
        const closedAt = input.exitPrice ? new Date() : undefined;
        const id = await createTrade({
          ...input,
          status,
          closedAt,
          userId: ctx.user.id,
          tradeDate: input.tradeDate ?? new Date(),
        });
        return { id };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          symbol: z.string().optional(),
          side: z.enum(["buy", "sell", "short", "cover"]).optional(),
          quantity: z.string().optional(),
          entryPrice: z.string().optional(),
          exitPrice: z.string().optional(),
          pnl: z.string().optional(),
          takeProfit: z.string().optional(),
          takeProfit2: z.string().optional(),
          stopLoss: z.string().optional(),
          status: z.enum(["open", "closed"]).optional(),
          notes: z.string().optional(),
          closedAt: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        // Auto-close trade when exitPrice is provided
        if (data.exitPrice && data.exitPrice.trim() !== "") {
          (data as any).status = "closed";
          if (!data.closedAt) (data as any).closedAt = new Date();
        }
        await updateTrade(id, ctx.user.id, data as any);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteTrade(input.id, ctx.user.id);
        return { success: true };
      }),

    fixOrphaned: protectedProcedure.mutation(async ({ ctx }) => {
      const fixed = await fixOrphanedOpenTrades(ctx.user.id);
      return { fixed };
    }),

    deduplicateClosing: protectedProcedure.mutation(async ({ ctx }) => {
      const removed = await deduplicateClosingTrades(ctx.user.id);
      return { removed };
    }),

    scoreDiscipline: protectedProcedure
      .input(z.object({ tradeId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // Get the trade
        const userTrades = await getTradesByUser(ctx.user.id, 200);
        const trade = userTrades.find((t) => t.id === input.tradeId);
        if (!trade) throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
        if (trade.status !== "closed") throw new TRPCError({ code: "BAD_REQUEST", message: "Can only score closed trades" });

        const prefs = await getOrCreatePreferences(ctx.user.id);
        const entryPrice = parseFloat(trade.entryPrice);
        const exitPrice = parseFloat(trade.exitPrice ?? "0");
        const pnl = parseFloat(trade.pnl ?? "0");
        const stopLoss = trade.stopLoss ? parseFloat(trade.stopLoss) : null;
        const takeProfit = trade.takeProfit ? parseFloat(trade.takeProfit) : null;
        const takeProfit2 = trade.takeProfit2 ? parseFloat(trade.takeProfit2) : null;
        const accountSize = parseFloat(prefs.accountSize ?? "10000");
        const riskPct = parseFloat(prefs.riskPerTrade ?? "1");

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a trading discipline evaluator. Score this trade 1-10 on rule-following and discipline.

Scoring criteria:
- Did the trader respect their stop loss? (major factor)
- Did the trader take profit at a reasonable level vs target?
- Was the position sized appropriately for the account size and risk %?
- Was the trade held too long or cut too early?
- Any signs of revenge trading, chasing, or emotional decisions?

Return JSON with: { score: number (1-10), feedback: string (2-3 sentences, direct and specific) }`,
            },
            {
              role: "user",
              content: `Trade details:
- Symbol: ${trade.symbol}
- Side: ${trade.side}
- Entry: $${entryPrice.toFixed(2)}
- Exit: $${exitPrice.toFixed(2)}
- P&L: $${pnl.toFixed(2)}
- Stop Loss: ${stopLoss ? "$" + stopLoss.toFixed(2) : "not set"}
- TP1: ${takeProfit ? "$" + takeProfit.toFixed(2) : "not set"}
- TP2: ${takeProfit2 ? "$" + takeProfit2.toFixed(2) : "not set"}
- Notes: ${trade.notes ?? "none"}
- Account size: $${accountSize.toFixed(0)}
- Risk per trade: ${riskPct}%`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "discipline_score",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  score: { type: "integer", description: "Discipline score 1-10" },
                  feedback: { type: "string", description: "2-3 sentence feedback" },
                },
                required: ["score", "feedback"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices[0]?.message?.content ?? "{}";
        const result = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
        const score = Math.min(10, Math.max(1, result.score ?? 5));
        const feedback = result.feedback ?? "No feedback available.";

        await updateTrade(input.tradeId, ctx.user.id, { disciplineScore: score, disciplineFeedback: feedback } as any);
        return { score, feedback };
      }),
  }),

  // ─── PnL & Analytics ────────────────────────────────────────────────────────

  analytics: router({
    pnlByPeriod: protectedProcedure
      .input(z.object({ from: z.date(), to: z.date() }))
      .query(async ({ ctx, input }) => {
        return getPnlByPeriod(ctx.user.id, input.from, input.to);
      }),

    symbolPerformance: protectedProcedure
      .input(z.object({ from: z.date(), to: z.date() }))
      .query(async ({ ctx, input }) => {
        return getSymbolPerformance(ctx.user.id, input.from, input.to);
      }),

    timeOfDay: protectedProcedure
      .input(z.object({ from: z.date(), to: z.date() }))
      .query(async ({ ctx, input }) => {
        return getTimeOfDayPerformance(ctx.user.id, input.from, input.to);
      }),

    summary: protectedProcedure
      .input(z.object({ from: z.date(), to: z.date() }))
      .query(async ({ ctx, input }) => {
        const tradesData = await getTradesByDateRange(ctx.user.id, input.from, input.to);
        const closed = tradesData.filter((t) => t.status === "closed");
        const totalPnl = closed.reduce((sum, t) => sum + parseFloat(t.pnl ?? "0"), 0);
        const wins = closed.filter((t) => parseFloat(t.pnl ?? "0") > 0);
        const losses = closed.filter((t) => parseFloat(t.pnl ?? "0") < 0);
        const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
        const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + parseFloat(t.pnl ?? "0"), 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + parseFloat(t.pnl ?? "0"), 0) / losses.length : 0;
        const profitFactor = Math.abs(avgLoss) > 0 ? Math.abs(avgWin * wins.length) / Math.abs(avgLoss * losses.length) : 0;
        return {
          totalPnl,
          tradeCount: closed.length,
          winCount: wins.length,
          lossCount: losses.length,
          winRate,
          avgWin,
          avgLoss,
          profitFactor,
          bestTrade: wins.length > 0 ? wins.reduce((best, t) => (parseFloat(t.pnl ?? "0") > parseFloat(best?.pnl ?? "-999999") ? t : best), wins[0]) : null,
          worstTrade: losses.length > 0 ? losses.reduce((worst, t) => (parseFloat(t.pnl ?? "0") < parseFloat(worst?.pnl ?? "999999") ? t : worst), losses[0]) : null,
        };
      }),

    patternAnalysis: protectedProcedure
      .input(z.object({ from: z.date(), to: z.date() }))
      .query(async ({ ctx, input }) => {
        // Premium feature
        const prefs = await getOrCreatePreferences(ctx.user.id);
        if (!prefs.isPremium && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Pattern analysis requires a premium subscription." });
        }
        const [pnlData, symbolData, timeData] = await Promise.all([
          getPnlByPeriod(ctx.user.id, input.from, input.to),
          getSymbolPerformance(ctx.user.id, input.from, input.to),
          getTimeOfDayPerformance(ctx.user.id, input.from, input.to),
        ]);
        return { pnlData, symbolData, timeData };
      }),

    positionSizing: protectedProcedure
      .input(
        z.object({
          accountSize: z.string().default("10000"),
          riskTolerance: z.enum(["conservative", "moderate", "aggressive"]).default("moderate"),
        })
      )
      .query(async ({ ctx, input }) => {
        const tradesData = await getTradesByUser(ctx.user.id, 1000);
        const closed = tradesData.filter((t) => t.status === "closed" && t.pnl !== null);
        const wins = closed.filter((t) => parseDecimal(t.pnl) > 0);
        const losses = closed.filter((t) => parseDecimal(t.pnl) < 0);
        const winRate = closed.length > 0 ? wins.length / closed.length : 0;
        const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + parseDecimal(t.pnl), 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + Math.abs(parseDecimal(t.pnl)), 0) / losses.length : 0;
        const { kelly, optimalF } = calculateKelly(winRate, avgWin, avgLoss);
        const account = parseDecimal(input.accountSize);
        const toleranceFactor = input.riskTolerance === "conservative" ? 0.5 : input.riskTolerance === "moderate" ? 0.75 : 1;
        const suggestedRisk = clamp(optimalF * toleranceFactor, 0, 1);
        return {
          winRate: Math.round(winRate * 10000) / 100,
          avgWin: Math.round(avgWin * 100) / 100,
          avgLoss: Math.round(avgLoss * 100) / 100,
          kelly: Math.round(kelly * 10000) / 100,
          optimalF: Math.round(optimalF * 10000) / 100,
          suggestedRiskPercent: Math.round(suggestedRisk * 10000) / 100,
          suggestedRiskAmount: Math.round(account * suggestedRisk * 100) / 100,
        };
      }),

    portfolioHeatMap: protectedProcedure.query(async ({ ctx }) => {
      const positions = await getPositionsByUser(ctx.user.id);
      const totalExposure = positions.reduce((sum, position) => {
        const price = parseDecimal(position.currentPrice) || parseDecimal(position.avgPrice);
        return sum + Math.abs(parseDecimal(position.quantity) * price);
      }, 0);
      return positions.map((position) => {
        const price = parseDecimal(position.currentPrice) || parseDecimal(position.avgPrice);
        const exposure = Math.abs(parseDecimal(position.quantity) * price);
        return {
          symbol: position.symbol,
          quantity: parseDecimal(position.quantity),
          price,
          exposure,
          weight: totalExposure > 0 ? Math.round((exposure / totalExposure) * 10000) / 100 : 0,
          unrealizedPnl: parseDecimal(position.unrealizedPnl),
        };
      });
    }),

    stressTest: protectedProcedure
      .input(
        z.object({
          accountSize: z.string().default("10000"),
          simulations: z.number().min(50).max(2000).default(500),
          tradesToSimulate: z.number().min(10).max(200).default(50),
          from: z.date(),
          to: z.date(),
        })
      )
      .query(async ({ ctx, input }) => {
        const tradesData = await getTradesByDateRange(ctx.user.id, input.from, input.to);
        const closed = tradesData.filter((t) => t.status === "closed" && t.pnl !== null && t.entryPrice !== null && t.quantity !== null);
        const returns = closed
          .map((t) => {
            const qty = parseDecimal(t.quantity);
            const entry = parseDecimal(t.entryPrice);
            const pnl = parseDecimal(t.pnl);
            const notional = qty * entry;
            return notional > 0 ? pnl / notional : 0;
          })
          .filter((r) => Number.isFinite(r));
        if (!returns.length) {
          return {
            simulations: input.simulations,
            tradesToSimulate: input.tradesToSimulate,
            medianFinalValue: parseDecimal(input.accountSize),
            p10: parseDecimal(input.accountSize),
            p90: parseDecimal(input.accountSize),
            averageFinalValue: parseDecimal(input.accountSize),
            maxDrawdown: 0,
            returns: [],
          };
        }
        const accountSize = parseDecimal(input.accountSize);
        const outcomes: number[] = [];
        let totalBalance = 0;
        for (let i = 0; i < input.simulations; i += 1) {
          let balance = accountSize;
          let peak = balance;
          let worstDrawdown = 0;
          for (let j = 0; j < input.tradesToSimulate; j += 1) {
            const sample = returns[Math.floor(Math.random() * returns.length)];
            balance *= 1 + sample;
            peak = Math.max(peak, balance);
            worstDrawdown = Math.max(worstDrawdown, peak > 0 ? (peak - balance) / peak : 0);
          }
          outcomes.push(Math.round(balance * 100) / 100);
          totalBalance += balance;
          if (worstDrawdown > 0) {
            // preserve max observed drawdown if needed later
          }
        }
        const sorted = outcomes.slice().sort((a, b) => a - b);
        return {
          simulations: input.simulations,
          tradesToSimulate: input.tradesToSimulate,
          medianFinalValue: Math.round(percentile(sorted, 0.5) * 100) / 100,
          p10: Math.round(percentile(sorted, 0.1) * 100) / 100,
          p90: Math.round(percentile(sorted, 0.9) * 100) / 100,
          averageFinalValue: Math.round((totalBalance / outcomes.length) * 100) / 100,
          histogram: sorted.slice(0, Math.min(sorted.length, 100)),
        };
      }),

    correlationMatrix: protectedProcedure
      .input(z.object({ from: z.date(), to: z.date() }))
      .query(async ({ ctx, input }) => {
        const tradesData = await getTradesByDateRange(ctx.user.id, input.from, input.to);
        const closed = tradesData.filter((t) => t.status === "closed" && t.pnl !== null && t.entryPrice !== null && t.quantity !== null);
        const bySymbolDate: Map<string, Map<string, { pnl: number; exposure: number }>> = new Map();
        for (const trade of closed) {
          const symbol = trade.symbol;
          const dateKey = normalizeDateKey(trade.tradeDate);
          const qty = parseDecimal(trade.quantity);
          const entry = parseDecimal(trade.entryPrice);
          const pnl = parseDecimal(trade.pnl);
          const exposure = qty * entry;
          if (!bySymbolDate.has(symbol)) bySymbolDate.set(symbol, new Map<string, { pnl: number; exposure: number }>());
          const dayMap = bySymbolDate.get(symbol)!;
          const existing = dayMap.get(dateKey) ?? { pnl: 0, exposure: 0 };
          existing.pnl += pnl;
          existing.exposure += exposure;
          dayMap.set(dateKey, existing);
        }
        const symbolReturns = new Map<string, number[]>();
        for (const entry of Array.from(bySymbolDate.entries())) {
          const symbol = entry[0];
          const dayMap = entry[1];
          const returns = Array.from(dayMap.values()).map((row) => (row.exposure ? row.pnl / row.exposure : 0));
          if (returns.length >= 3) symbolReturns.set(symbol, returns);
        }
        const symbols = Array.from(symbolReturns.keys()).slice(0, 10);
        const matrix = symbols.map((rowSymbol) => ({
          symbol: rowSymbol,
          correlations: symbols.map((colSymbol) => {
            if (rowSymbol === colSymbol) return 1;
            const a = symbolReturns.get(rowSymbol) ?? [];
            const b = symbolReturns.get(colSymbol) ?? [];
            const n = Math.min(a.length, b.length);
            if (n < 3) return 0;
            return pearsonCorrelation(a.slice(0, n), b.slice(0, n));
          }),
        }));
        return { symbols, matrix };
      }),
  }),

  // ─── Sessions ───────────────────────────────────────────────────────────────

  sessions: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getSessionsByUser(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const session = await getSessionById(input.id, ctx.user.id);
        if (!session) throw new TRPCError({ code: "NOT_FOUND" });
        return session;
      }),

    create: protectedProcedure
      .input(z.object({ title: z.string().optional(), transcript: z.string().optional(), audioUrl: z.string().optional(), emotionalNote: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const id = await createSession({ ...input, userId: ctx.user.id });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number(), title: z.string().optional(), transcript: z.string().optional(), summary: z.string().optional(), coachFeedback: z.string().optional(), emotionalNote: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateSession(id, ctx.user.id, data);
        return { success: true };
      }),

    tts: protectedProcedure
      .input(z.object({
        text: z.string().max(5000),
        // Forge TTS voice names are kept for backwards compatibility with older clients.
        voice: z.enum(["onyx", "fable", "nova", "shimmer", "alloy", "echo"]).default("nova"),
        persona: z.enum(["adam", "george", "sarah", "laura"]).optional(),
        speed: z.number().min(0.25).max(4.0).default(1.0),
      }))
      .mutation(async ({ input }) => {
        const forgeVoice = input.voice as ForgeTtsVoice;
        const persona = input.persona ?? FORGE_TO_PERSONA[forgeVoice] ?? "sarah";
        const errors: string[] = [];

        if (ENV.elevenLabsApiKey) {
          const result = await synthesizeSpeechElevenLabs({
            text: input.text,
            voiceId: PERSONA_TO_ELEVENLABS[persona],
            stability: 0.38,
            similarityBoost: 0.86,
            style: 0.32,
            speakerBoost: true,
          });
          if ("audioBase64" in result) {
            return { audioBase64: result.audioBase64, provider: "elevenlabs" as const };
          }
          errors.push(result.error);
        }

        if (ENV.googleTtsApiKey) {
          const result = await synthesizeSpeechGoogle({
            text: input.text,
            voice: PERSONA_TO_GOOGLE[persona],
            speakingRate: input.speed,
            pitch: persona === "adam" ? -2 : persona === "george" ? -1 : 0,
          });
          if ("audioBase64" in result) {
            return { audioBase64: result.audioBase64, provider: "google" as const };
          }
          errors.push(result.error);
        }

        const result = await synthesizeSpeechForge({
          text: input.text,
          voice: PERSONA_TO_FORGE[persona],
          speed: input.speed,
        });
        if ("audioBase64" in result) {
          return { audioBase64: result.audioBase64, provider: "forge" as const };
        }

        errors.push(result.error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: errors.join(" | ") });
      }),

    transcribe: protectedProcedure
      .input(z.object({ audioUrl: z.string() }))
      .mutation(async ({ input }) => {
        const result = await transcribeAudio({ audioUrl: input.audioUrl, language: "en" });
        if ('error' in result) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error });
        // Apply ticker correction: replace spoken company names with proper ticker symbols
        // e.g. "Honda" → "ONDS", "Apple" → "AAPL", "Tesla" → "TSLA"
        const corrected = correctTickers(result.text);
        return { transcript: corrected };
      }),

    extractTrades: protectedProcedure
      .input(z.object({
        transcript: z.string(),
        openPositions: z.array(z.object({
          symbol: z.string(),
          side: z.enum(["buy", "sell", "short", "cover"]),
          quantity: z.string(),
          entryPrice: z.string(),
          takeProfit: z.string().nullable().optional(),
          takeProfit2: z.string().nullable().optional(),
          stopLoss: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        })).optional(),
        // Live market prices for auto-filling exit price when closing at market
        liveQuotes: z.record(z.string(), z.number()).optional(),
      }))
      .mutation(async ({ input }) => {
        // Second-pass ticker correction: ensures manual transcripts also get corrected
        // (audio transcripts are already corrected in the transcribe procedure)
        const correctedTranscript = correctTickers(input.transcript);
        const openCtx = input.openPositions && input.openPositions.length > 0
          ? `\n\nCURRENT OPEN POSITIONS (use these to fill in missing data when the trader mentions closing/covering a position):\n${input.openPositions.map(p =>
              `- ${p.symbol}: side=${p.side}, qty=${p.quantity}, entryPrice=${p.entryPrice}${p.takeProfit ? `, takeProfit=${p.takeProfit}` : ""}${p.takeProfit2 ? `, takeProfit2=${p.takeProfit2}` : ""}${p.stopLoss ? `, stopLoss=${p.stopLoss}` : ""}`
            ).join("\n")}`
          : "";
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a trading data extraction assistant. Extract all trade information from the transcript.
Return a JSON array of trades. Each trade should have:
- symbol (string, uppercase ticker like AAPL, SPY, TSLA)
- side (one of: "buy", "sell", "short", "cover") — if closing a long use "sell", if covering a short use "cover"
- quantity (number as string) — if not mentioned, look it up from the open positions context
- entryPrice (number as string) — if closing a trade, use the original entry price from open positions context
- exitPrice (number as string, optional) — the price at which the position was closed
- pnl (number as string, optional) — calculate as (exitPrice - entryPrice) * quantity for longs, or (entryPrice - exitPrice) * quantity for shorts
- takeProfit (number as string, optional) — first take-profit target, TP1, from open positions context or if mentioned
- takeProfit2 (number as string, optional) — second take-profit target, TP2, from open positions context or if mentioned
- stopLoss (number as string, optional) — from open positions context or if mentioned
- status ("open" if still holding, "closed" if exited)
- notes (any relevant context)
IMPORTANT: When the trader says they are "closing", "selling", "exiting", or "covering" a position, match it to the open positions context to fill in entryPrice, quantity, takeProfit, takeProfit2, and stopLoss automatically.
IMPORTANT: If the trader says "TP1", "first target", or "first take profit", put that in takeProfit. If they say "TP2", "second target", or "runner target", put that in takeProfit2.
IMPORTANT: Speech-to-text often misplaces decimal points. If the entry price is around $150 and the exit price sounds like $1.72 or $1720, the correct value is almost certainly $172. Always sanity-check prices — exit, TP, and SL should be in the same order of magnitude as the entry price (within 50%). If a price seems off by a factor of 10, 100, or 0.1, correct it before returning.
If no clear trades are mentioned, return an empty array [].
Only return valid JSON, no markdown or explanation.${openCtx}`,
            },
            { role: "user", content: correctedTranscript },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "trades_extraction",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  trades: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        symbol: { type: "string" },
                        side: { type: "string" },
                        quantity: { type: "string" },
                        entryPrice: { type: "string" },
                        exitPrice: { type: ["string", "null"] },
                        pnl: { type: ["string", "null"] },
                        takeProfit: { type: ["string", "null"] },
                        takeProfit2: { type: ["string", "null"] },
                        stopLoss: { type: ["string", "null"] },
                        status: { type: "string" },
                        notes: { type: ["string", "null"] },
                      },
                      required: [
                        "symbol",
                        "side",
                        "quantity",
                        "entryPrice",
                        "exitPrice",
                        "pnl",
                        "takeProfit",
                        "takeProfit2",
                        "stopLoss",
                        "status",
                        "notes",
                      ],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["trades"],
                additionalProperties: false,
              },
            },
          },
        });
        const content = response.choices[0]?.message?.content ?? "{}";
        const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
        const trades = parsed.trades ?? [];

        const closeIntent = /\b(close|closing|closed|sell|selling|sold|exit|exiting|cover|covering)\b/i.test(correctedTranscript);
        const restIntent = /\b(rest|remaining|remainder|all|everything|full|entire)\b/i.test(correctedTranscript);
        const openPositions = input.openPositions ?? [];
        const findMatchingOpen = (trade: any) => {
          const symbol = typeof trade.symbol === "string" ? trade.symbol.toUpperCase() : "";
          const expectedSide = trade.side === "sell" ? "buy" : trade.side === "cover" ? "short" : null;
          return openPositions.find((p) =>
            (!symbol || p.symbol.toUpperCase() === symbol) &&
            (!expectedSide || p.side === expectedSide)
          );
        };
        const applyMarketClose = (trade: any, matchingOpen: NonNullable<typeof input.openPositions>[number], livePrice: number) => {
          const qty = parseFloat(restIntent || !trade.quantity || trade.quantity === "null" ? matchingOpen.quantity : trade.quantity);
          const entry = parseFloat(matchingOpen.entryPrice);
          const exit = livePrice;

          trade.symbol = matchingOpen.symbol;
          trade.side = matchingOpen.side === "short" ? "cover" : "sell";
          trade.quantity = (!isNaN(qty) && qty > 0 ? qty : parseFloat(matchingOpen.quantity)).toString();
          trade.entryPrice = matchingOpen.entryPrice;
          trade.exitPrice = livePrice.toFixed(2);
          trade.status = "closed";
          trade.takeProfit = trade.takeProfit ?? matchingOpen.takeProfit ?? null;
          trade.takeProfit2 = trade.takeProfit2 ?? matchingOpen.takeProfit2 ?? null;
          trade.stopLoss = trade.stopLoss ?? matchingOpen.stopLoss ?? null;
          trade.notes = trade.notes ?? (restIntent ? "Closed remaining position at market" : "Closed at market");

          if (!isNaN(entry) && !isNaN(qty)) {
            const isShort = matchingOpen.side === "short";
            trade.pnl = (isShort ? (entry - exit) * qty : (exit - entry) * qty).toFixed(2);
          }
        };

        if (input.liveQuotes && Object.keys(input.liveQuotes).length > 0) {
          for (const trade of trades) {
            const isClose = trade.side === "sell" || trade.side === "cover";
            const hasNoExit = !trade.exitPrice || trade.exitPrice === "" || trade.exitPrice === "null";
            const matchingOpen = isClose ? findMatchingOpen(trade) : undefined;
            const livePrice = matchingOpen ? input.liveQuotes[matchingOpen.symbol.toUpperCase()] : undefined;
            if (isClose && hasNoExit && matchingOpen && livePrice && livePrice > 0) {
              applyMarketClose(trade, matchingOpen, livePrice);
            }
          }

          if (closeIntent && restIntent && trades.length === 0 && openPositions.length === 1) {
            const matchingOpen = openPositions[0];
            const livePrice = input.liveQuotes[matchingOpen.symbol.toUpperCase()];
            if (livePrice && livePrice > 0) {
              const trade: any = {
                symbol: matchingOpen.symbol,
                side: matchingOpen.side === "short" ? "cover" : "sell",
                quantity: matchingOpen.quantity,
                entryPrice: matchingOpen.entryPrice,
                exitPrice: null,
                pnl: null,
                takeProfit: matchingOpen.takeProfit ?? null,
                takeProfit2: matchingOpen.takeProfit2 ?? null,
                stopLoss: matchingOpen.stopLoss ?? null,
                status: "closed",
                notes: "Closed remaining position at market",
              };
              applyMarketClose(trade, matchingOpen, livePrice);
              trades.push(trade);
            }
          }
        }

        return { trades };
      }),

    generateSummary: protectedProcedure
      .input(z.object({ sessionId: z.number(), transcript: z.string(), trades: z.array(z.any()) }))
      .mutation(async ({ ctx, input }) => {
        const prefs = await getOrCreatePreferences(ctx.user.id);
        const coachMode = prefs.coachMode ?? "friend";
        const systemPrompt = COACH_PROMPTS[coachMode] + buildTraderProfileContext(prefs);

        const tradesText = input.trades
          .map((t: any) => `${t.symbol} ${t.side} ${t.quantity}@${t.entryPrice} → ${t.exitPrice ?? "open"} PnL: ${t.pnl ?? "N/A"}`)
          .join("\n");

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Please analyze this trading session and provide feedback.\n\nTranscript:\n${input.transcript}\n\nTrades:\n${tradesText}\n\nProvide a concise session summary and coaching feedback.`,
            },
          ],
        });
        const feedback = response.choices[0]?.message?.content ?? "";
        await updateSession(input.sessionId, ctx.user.id, { coachFeedback: typeof feedback === "string" ? feedback : JSON.stringify(feedback) });
        return { feedback };
      }),
  }),

  // ─── AI Coach ───────────────────────────────────────────────────────────────

  coach: router({
    getHistory: protectedProcedure.query(async ({ ctx }) => {
      const msgs = await getCoachMessages(ctx.user.id, 50);
      return msgs.reverse();
    }),

    chat: protectedProcedure
      .input(
        z.object({
          message: z.string().min(1),
          coachMode: z.enum(["sergeant", "friend", "expert"]).optional(),
          dailyPlan: dailyPlanInput,
        })
      )
      .mutation(async ({ ctx, input }) => {
        const prefs = await getOrCreatePreferences(ctx.user.id);
        if (!prefs.isPremium && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "AI Coach requires a premium subscription. Upgrade to unlock unlimited coaching." });
        }

        const coachMode = input.coachMode ?? prefs.coachMode ?? "friend";
        const systemPrompt = COACH_PROMPTS[coachMode] + buildTraderProfileContext(prefs) + buildDailyPlanContext(input.dailyPlan);

        // ── News intent detection ──────────────────────────────────────────────
        // Detect patterns like: "news on AAPL", "what's new with Google",
        // "latest catalyst for NVDA", "tell me about Apple news"
        const newsIntentRegex = /(?:news|latest|newest|what(?:'s| is) new|what(?:'s| is) happening|what(?:'s| is) going on|update|updates|headlines?|catalysts?)\s+(?:on|for|about|with|regarding|in)?\s*([A-Z]{1,5}|[A-Za-z][A-Za-z\s.&-]{1,30})/i;
        const tickerOnlyRegex = /^(?:news|headlines?|updates?|catalysts?)\s+([A-Z]{2,5})$/i;
        const match = input.message.match(newsIntentRegex) || input.message.match(tickerOnlyRegex);

        // Also detect common company names → ticker mapping
        const companyToTicker: Record<string, string> = {
          apple: "AAPL", microsoft: "MSFT", google: "GOOGL", alphabet: "GOOGL",
          amazon: "AMZN", tesla: "TSLA", nvidia: "NVDA", meta: "META",
          netflix: "NFLX", "s&p": "SPY", "s and p": "SPY", spy: "SPY",
          nasdaq: "QQQ", qqq: "QQQ", "dow jones": "DIA",
          googl: "GOOGL", goog: "GOOGL",
        };

        let newsArticles: Array<{ headline: string; summary: string; url: string; source: string; datetime: number }> = [];
        let newsContext = "";
        let quoteContext = "";
        let detectedTicker = "";

        if (match) {
          const rawTerm = match[1].trim().replace(/[?.!,]+$/g, "");
          detectedTicker = companyToTicker[rawTerm.toLowerCase()] ?? rawTerm.toUpperCase();

          // Fetch NewsAPI headlines for the detected ticker
          if (ENV.newsApiKey) {
            try {
              const url = new URL("https://newsapi.org/v2/everything");
              url.searchParams.set("q", `${detectedTicker} stock`);
              url.searchParams.set("language", "en");
              url.searchParams.set("sortBy", "publishedAt");
              url.searchParams.set("pageSize", "8");
              url.searchParams.set("apiKey", ENV.newsApiKey);
              const res = await fetch(url.toString());
              if (res.ok) {
                const data = await res.json() as { status: string; articles: any[] };
                if (data.status === "ok" && Array.isArray(data.articles)) {
                  newsArticles = data.articles.slice(0, 5).map((a: any) => ({
                    headline: a.title ?? "",
                    summary: a.description ?? "",
                    url: a.url ?? "",
                    source: a.source?.name ?? "News",
                    datetime: a.publishedAt ? Math.floor(new Date(a.publishedAt).getTime() / 1000) : 0,
                  }));
                  newsContext = `\n\nLatest real-time news for ${detectedTicker}:\n` +
                    newsArticles.map((a, i) => `${i + 1}. ${a.headline} (${a.source}, ${new Date(a.datetime * 1000).toLocaleDateString()})`).join("\n");
                }
              }
            } catch { /* fall through */ }
          }

          if (newsArticles.length === 0 && ENV.finnhubApiKey) {
            try {
              const today = new Date();
              const from = new Date(today);
              from.setDate(today.getDate() - 14);
              const fmt = (d: Date) => d.toISOString().split("T")[0];
              const articles = await finnhubRequest("/company-news", { symbol: detectedTicker, from: fmt(from), to: fmt(today) }) as any[];
              if (Array.isArray(articles)) {
                newsArticles = articles
                  .filter((a) => a?.headline && a?.url)
                  .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
                  .slice(0, 5)
                  .map((a) => ({
                    headline: a.headline ?? "",
                    summary: a.summary ?? "",
                    url: a.url ?? "",
                    source: a.source ?? "Finnhub",
                    datetime: a.datetime ?? 0,
                  }));
              }
            } catch { /* fall through */ }
          }

          if (newsArticles.length > 0) {
            newsContext = `\n\nLatest real-time news for ${detectedTicker}:\n` +
              newsArticles.map((a, i) => `${i + 1}. ${a.headline} (${a.source}, ${new Date(a.datetime * 1000).toLocaleString()})${a.summary ? ` — ${a.summary}` : ""}`).join("\n");
          }

          if (ENV.finnhubApiKey) {
            try {
              const quote = await finnhubRequest("/quote", { symbol: detectedTicker }) as any;
              if (quote?.c) {
                quoteContext = `\n\nCurrent ${detectedTicker} quote: $${Number(quote.c).toFixed(2)}, ${Number(quote.d ?? 0) >= 0 ? "+" : ""}${Number(quote.d ?? 0).toFixed(2)} (${Number(quote.dp ?? 0) >= 0 ? "+" : ""}${Number(quote.dp ?? 0).toFixed(2)}%).`;
              }
            } catch { /* quote is optional */ }
          }
        }

        // ── Background news for traded symbols ────────────────────────────────
        if (!newsContext && ENV.finnhubApiKey) {
          try {
            const recentTrades = await getTradesByUser(ctx.user.id, 10);
            const symbols = Array.from(new Set(recentTrades.map((t) => t.symbol))).slice(0, 4);
            const today = new Date();
            const from = new Date(today); from.setDate(today.getDate() - 7);
            const fmt = (d: Date) => d.toISOString().split("T")[0];
            const allNews: string[] = [];
            await Promise.allSettled(
              symbols.map(async (sym) => {
                try {
                  const articles = await finnhubRequest("/company-news", { symbol: sym, from: fmt(from), to: fmt(today) }) as any[];
                  if (!Array.isArray(articles)) return;
                  articles.slice(0, 3).forEach((a) => {
                    if (a.headline) allNews.push(`[${sym}] ${a.headline} (${new Date((a.datetime ?? 0) * 1000).toLocaleDateString()})`);
                  });
                } catch { /* skip */ }
              })
            );
            if (allNews.length > 0) newsContext = `\n\nLatest market news:\n${allNews.slice(0, 10).join("\n")}`;
          } catch { /* skip */ }
        }

        // Get recent trade context
        const recentTrades = await getTradesByUser(ctx.user.id, 10);
        const tradeContext = recentTrades.length > 0
          ? `\n\nYour recent trades: ${recentTrades.map((t) => `${t.symbol} ${t.side} PnL:${t.pnl ?? "open"}`).join(", ")}`
          : "";

        // Build system prompt with news-specific instruction when news intent detected
        const newsInstruction = newsArticles.length > 0
          ? `\n\nThe user is asking for the latest news, update, or catalyst. Answer immediately with the newest relevant catalyst first. Do not ask clarifying questions or offer a menu of options. Mention source and recency, then give a practical trader takeaway. Keep the spoken response under 140 words. After summarizing, say "I've pulled up the articles below for you to read."`
          : "";

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt + newsInstruction + tradeContext + newsContext + quoteContext },
            { role: "user", content: input.message },
          ],
        });

        const reply = response.choices[0]?.message?.content ?? "I couldn't generate a response.";
        const replyText = typeof reply === "string" ? reply : JSON.stringify(reply);
        // Voice-only mode: no message history saved to DB
        return { reply: replyText, coachMode, newsArticles, detectedTicker };
      }),

    freeChat: protectedProcedure
      .input(z.object({ message: z.string().min(1), dailyPlan: dailyPlanInput }))
      .mutation(async ({ ctx, input }) => {
        const prefs = await getOrCreatePreferences(ctx.user.id);
        // Limited free tier — basic responses without news context
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "You are a basic trading assistant. Provide brief, helpful trading tips and general market knowledge. Keep responses under 100 words. If asked about specific real-time news or prices, explain that live data is available in the Pro plan. Occasionally mention that premium coaching offers deeper analysis." + buildTraderProfileContext(prefs) + buildDailyPlanContext(input.dailyPlan),
            },
            { role: "user", content: input.message },
          ],
        });
        const reply = response.choices[0]?.message?.content ?? "";
        return { reply: typeof reply === "string" ? reply : JSON.stringify(reply) };
      }),
  }),

  // ─── Finnhub Market Data ─────────────────────────────────────────────────────

  market: router({
    // Real-time quotes for one or more comma-separated symbols via Finnhub
    quotes: protectedProcedure
      .input(z.object({ symbols: z.string() }))
      .query(async ({ ctx: _ctx, input }) => {
        const symbolList = input.symbols.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
        if (symbolList.length === 0) return [];

        const results = await Promise.allSettled(
          symbolList.map(async (sym) => {
            if (ENV.finnhubApiKey) {
              try {
                const data = await finnhubRequest("/quote", { symbol: sym }) as any;
                if (data?.c > 0) {
                  return { symbol: sym, last: data.c, open: data.o, high: data.h, low: data.l, prevClose: data.pc, change: data.d, changePercent: data.dp, source: "Finnhub" };
                }
              } catch {
                // Fall through to the no-key backup provider.
              }
            }
            return { ...await yahooQuote(sym), source: "Yahoo" };
          })
        );
        return results
          .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled" && r.value.last > 0)
          .map((r) => r.value);
      }),

    // Real-time news via NewsAPI or Finnhub
    news: protectedProcedure
      .input(z.object({ symbols: z.array(z.string()) }))
      .query(async ({ ctx: _ctx, input }) => {
        if (input.symbols.length === 0) return [];

        const symbolQuery = input.symbols.slice(0, 6).join(" OR ");
        const query = `(${symbolQuery}) stock market`;

        if (ENV.newsApiKey) {
          try {
            const url = new URL("https://newsapi.org/v2/everything");
            url.searchParams.set("q", query);
            url.searchParams.set("language", "en");
            url.searchParams.set("sortBy", "publishedAt");
            url.searchParams.set("pageSize", "20");
            url.searchParams.set("apiKey", ENV.newsApiKey);
            const res = await fetch(url.toString());
            if (res.ok) {
              const data = await res.json() as { status: string; articles: any[] };
              if (data.status === "ok" && Array.isArray(data.articles)) {
                return data.articles.slice(0, 15).map((a: any) => ({
                  headline: a.title,
                  summary: a.description ?? "",
                  url: a.url,
                  source: a.source?.name ?? "News",
                  image: a.urlToImage ?? "",
                  datetime: a.publishedAt ? Math.floor(new Date(a.publishedAt).getTime() / 1000) : 0,
                  symbol: input.symbols[0] ?? "",
                }));
              }
            }
          } catch {
            // fallback to Finnhub news
          }
        }

        if (ENV.finnhubApiKey) {
          const today = new Date();
          const from = new Date(today);
          from.setDate(today.getDate() - 7);
          const fmt = (d: Date) => d.toISOString().split("T")[0];
          const allNews: any[] = [];
          const seen = new Set<string>();
          await Promise.allSettled(
            input.symbols.slice(0, 5).map(async (sym) => {
              try {
                const articles = await finnhubRequest("/company-news", { symbol: sym, from: fmt(from), to: fmt(today) }) as any[];
                if (!Array.isArray(articles)) return;
                for (const a of articles.slice(0, 6)) {
                  const key = a.url ?? a.headline;
                  if (!seen.has(key)) {
                    seen.add(key);
                    allNews.push({ ...a, symbol: sym });
                  }
                }
              } catch {
                // skip
              }
            })
          );
          return allNews.sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0)).slice(0, 15);
        }

        return [];
      }),

    // Historical chart data for stock or crypto symbols
    historicalPrices: protectedProcedure
      .input(z.object({
        symbol: z.string(),
        assetType: z.enum(["stock", "crypto"]).default("stock"),
        resolution: z.enum(["1D", "1W", "1M", "1H", "15m"]).default("1D"),
        count: z.number().default(60),
      }))
      .query(async ({ ctx: _ctx, input }) => {
        if (input.assetType === "stock") {
          if (ENV.finnhubApiKey) {
            try {
              const now = Math.floor(Date.now() / 1000);
              const resolution = resolutionToFinnhub(input.resolution);
              const from = now - (resolutionSeconds(input.resolution) * input.count);
              const data = await finnhubRequest("/stock/candle", {
                symbol: input.symbol,
                resolution,
                from: String(from),
                to: String(now),
              }) as any;
              if (data.s === "ok" && Array.isArray(data.t)) {
                return data.t.map((timestamp: number, index: number) => ({
                  date: new Date(timestamp * 1000).toISOString(),
                  open: data.o[index],
                  high: data.h[index],
                  low: data.l[index],
                  close: data.c[index],
                  volume: data.v[index],
                  source: "Finnhub",
                }));
              }
            } catch {
              // Fall back to Yahoo below when Finnhub candles are unavailable.
            }
          }

          try {
            return await yahooHistoricalPrices(input.symbol, input.resolution, input.count);
          } catch {
            return [];
          }
        }

        const id = getCoinGeckoId(input.symbol);
        try {
          const candleDays = input.resolution === "1D" ? 1 : input.resolution === "1W" ? 7 : input.resolution === "1M" ? 30 : 1;
          const ohlc = await coingeckoRequest(`/coins/${id}/ohlc`, {
            vs_currency: "usd",
            days: String(candleDays),
          }) as any;
          if (Array.isArray(ohlc) && ohlc.length > 0) {
            return ohlc.map((row: any[]) => ({
              date: new Date(row[0]).toISOString(),
              open: row[1],
              high: row[2],
              low: row[3],
              close: row[4],
              volume: 0,
            }));
          }
        } catch {
          // fallback to simple price history
        }

        const chart = await coingeckoRequest(`/coins/${id}/market_chart`, {
          vs_currency: "usd",
          days: String(input.resolution === "1D" ? 1 : input.resolution === "1W" ? 7 : 30),
        }) as any;
        if (!chart || !Array.isArray(chart.prices)) return [];
        return chart.prices.map((row: any[]) => ({
          date: new Date(row[0]).toISOString(),
          open: row[1],
          high: row[1],
          low: row[1],
          close: row[1],
          volume: 0,
        }));
      }),

    optionsChain: protectedProcedure
      .input(z.object({ symbol: z.string().toUpperCase(), expiration: z.string().optional() }))
      .query(async ({ ctx: _ctx, input }) => {
        const symbol = input.symbol;
        if (ENV.finnhubApiKey) {
          try {
            const apiResponse = await finnhubRequest("/stock/option-chain", { symbol }) as any;
            const expirations = Array.isArray(apiResponse.expirationDates) ? apiResponse.expirationDates : [];
            const latestPrice = apiResponse.underlyingPrice ?? 0;
            const calls = Array.isArray(apiResponse.calls) ? apiResponse.calls : [];
            const puts = Array.isArray(apiResponse.puts) ? apiResponse.puts : [];
            const filteredCalls = input.expiration ? calls.filter((row: any) => row.expirationDate === input.expiration) : calls.slice(0, 20);
            const filteredPuts = input.expiration ? puts.filter((row: any) => row.expirationDate === input.expiration) : puts.slice(0, 20);
            return { symbol, latestPrice, expirationDates: expirations, calls: filteredCalls, puts: filteredPuts };
          } catch {
            // fallback to sample below
          }
        }

        const samplePrice = 150;
        const sampleExpirations = [
          "2026-05-16",
          "2026-06-20",
          "2026-09-19",
        ];
        const sampleOption = (type: "call" | "put", strike: number) => ({
          strike,
          bid: Number((Math.random() * 5 + 1).toFixed(2)),
          ask: Number((Math.random() * 5 + 1.5).toFixed(2)),
          lastPrice: Number((Math.random() * 5 + 1.2).toFixed(2)),
          impliedVolatility: Number((Math.random() * 0.6 + 0.2).toFixed(2)),
          openInterest: Math.floor(Math.random() * 2000 + 100),
          expirationDate: sampleExpirations[0],
          type,
        });
        return {
          symbol,
          latestPrice: samplePrice,
          expirationDates: sampleExpirations,
          calls: [sampleOption("call", 145), sampleOption("call", 150), sampleOption("call", 155)],
          puts: [sampleOption("put", 145), sampleOption("put", 150), sampleOption("put", 155)],
        };
      }),

    cryptoQuotes: protectedProcedure
      .input(z.object({ symbols: z.array(z.string()).optional() }))
      .query(async ({ ctx: _ctx, input }) => {
        const requested = input.symbols && input.symbols.length > 0 ? input.symbols : ["BTC", "ETH", "SOL", "ADA", "XRP"];
        const ids = Array.from(new Set(requested.map((symbol) => getCoinGeckoId(symbol))));
        const params: Record<string, string> = {
          ids: ids.join(","),
          vs_currencies: "usd",
          include_24hr_change: "true",
          include_market_cap: "true",
          include_24hr_vol: "true",
          include_last_updated_at: "true",
        };
        const data = await coingeckoRequest("/simple/price", params) as any;
        return Object.entries(data).map(([id, payload]: [string, any]) => {
          const symbol = requested.find((sym) => getCoinGeckoId(sym) === id) ?? id;
          return {
            symbol: symbol.toUpperCase(),
            id,
            price: payload.usd,
            change24h: payload.usd_24h_change,
            marketCap: payload.usd_market_cap,
            volume24h: payload.usd_24h_vol,
            updatedAt: payload.last_updated_at ? new Date(payload.last_updated_at * 1000).toISOString() : undefined,
          };
        });
      }),
  }),

  // ─── Positions ──────────────────────────────────────────────────────────────

  positions: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getPositionsByUser(ctx.user.id);
    }),

    upsert: protectedProcedure
      .input(
        z.object({
          symbol: z.string().toUpperCase(),
          quantity: z.string(),
          avgPrice: z.string(),
          currentPrice: z.string().optional(),
          unrealizedPnl: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await upsertPosition({ ...input, userId: ctx.user.id });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ symbol: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await deletePosition(ctx.user.id, input.symbol);
        return { success: true };
      }),
  }),

  // ─── Alerts ─────────────────────────────────────────────────────────────────

  alerts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getAlertsByUser(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          symbol: z.string().toUpperCase(),
          targetPrice: z.string(),
          alertType: z.enum(["above", "below", "stop_loss", "take_profit"]),
          message: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await createAlert({ ...input, userId: ctx.user.id });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteAlert(input.id, ctx.user.id);
        return { success: true };
      }),

    checkAndNotify: protectedProcedure
      .input(z.object({ quotes: z.array(z.object({ symbol: z.string(), last: z.number() })) }))
      .mutation(async ({ ctx, input }) => {
        const userAlerts = await getAlertsByUser(ctx.user.id);
        const triggered: typeof userAlerts = [];

        for (const alert of userAlerts) {
          if (alert.triggered) continue;
          const quote = input.quotes.find((q) => q.symbol === alert.symbol);
          if (!quote) continue;

          const target = parseFloat(alert.targetPrice);
          const shouldTrigger =
            (alert.alertType === "above" && quote.last >= target) ||
            (alert.alertType === "below" && quote.last <= target) ||
            (alert.alertType === "take_profit" && quote.last >= target) ||
            (alert.alertType === "stop_loss" && quote.last <= target);

          if (shouldTrigger) {
            await triggerAlert(alert.id);
            triggered.push(alert);
            await notifyOwner({
              title: `🔔 Alert: ${alert.symbol} ${alert.alertType}`,
              content: `${alert.symbol} hit ${alert.alertType} target of $${target}. Current price: $${quote.last}`,
            });
          }
        }
        return { triggered };
      }),
  }),

  // ─── Watchlist ────────────────────────────────────────────────────────────────

  watchlist: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getWatchlist(ctx.user.id);
    }),

    add: protectedProcedure
      .input(z.object({ symbol: z.string().min(1).max(20).toUpperCase(), notes: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        return addToWatchlist(ctx.user.id, input.symbol, input.notes);
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await removeFromWatchlist(ctx.user.id, input.id);
        return { success: true };
      }),
  }),

  // ─── PDF Export ─────────────────────────────────────────────────────────────

  export: router({
    sessionPdf: protectedProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const session = await getSessionById(input.sessionId, ctx.user.id);
        if (!session) throw new TRPCError({ code: "NOT_FOUND" });
        // Return session data for client-side PDF generation
        const sessionTrades = await getTradesByUser(ctx.user.id, 100);
        const relatedTrades = sessionTrades.filter((t) => t.sessionId === input.sessionId);
        return { session, trades: relatedTrades };
      }),
  }),
});

export type AppRouter = typeof appRouter;
