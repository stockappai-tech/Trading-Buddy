import express from "express";
import { getPositionsByUser, getTradesByUser } from "../db";

const pushTokenStore = new Map<number, Array<{ token: string; platform: string; deviceName?: string; updatedAt: string }>>();

function parseUserId(req: express.Request): number | null {
  const userIdHeader = req.headers["x-user-id"];
  const userIdBody = (req.body && req.body.userId) || req.query.userId;
  const candidate = userIdHeader ?? userIdBody;
  const id = Number(candidate);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerMobileRoutes(app: express.Express) {
  app.post("/api/mobile/push/register", async (req, res) => {
    const userId = parseUserId(req);
    const { token, platform, deviceName } = req.body as {
      token?: string;
      platform?: string;
      deviceName?: string;
    };

    if (!token || !platform) {
      return res.status(400).json({ success: false, message: "Missing token or platform." });
    }

    if (userId) {
      const current = pushTokenStore.get(userId) ?? [];
      const existing = current.find((item) => item.token === token);
      if (!existing) {
        current.push({ token, platform, deviceName, updatedAt: new Date().toISOString() });
      } else {
        existing.updatedAt = new Date().toISOString();
      }
      pushTokenStore.set(userId, current);
    }

    return res.json({ success: true, registered: true, userId });
  });

  app.post("/api/mobile/voice-command", async (req, res) => {
    const { command = "" } = req.body as { command?: string };
    const normalized = String(command).trim().toLowerCase();
    let response = { action: "unknown", message: "I couldn't interpret that command.", payload: {} };

    if (/buy\s+([a-zA-Z]{1,5})/.test(normalized)) {
      const symbol = normalized.match(/buy\s+([a-zA-Z]{1,5})/)?.[1]?.toUpperCase() ?? "";
      response = {
        action: "place_order",
        message: `Preparing a buy order for ${symbol}. Confirm details in the app.`,
        payload: { type: "buy", symbol },
      };
    } else if (/sell\s+([a-zA-Z]{1,5})/.test(normalized)) {
      const symbol = normalized.match(/sell\s+([a-zA-Z]{1,5})/)?.[1]?.toUpperCase() ?? "";
      response = {
        action: "place_order",
        message: `Preparing a sell order for ${symbol}. Confirm details in the app.`,
        payload: { type: "sell", symbol },
      };
    } else if (/(portfolio|overview|summary)/.test(normalized)) {
      response = {
        action: "show_portfolio",
        message: "Opening your portfolio overview.",
        payload: {},
      };
    } else if (/(profit|pnl|performance)/.test(normalized)) {
      response = {
        action: "show_performance",
        message: "Fetching your current P&L summary.",
        payload: {},
      };
    }

    return res.json(response);
  });

  app.get("/api/mobile/watch-summary", async (req, res) => {
    const userId = parseUserId(req);
    if (!userId) {
      return res.json({
        totalUnrealized: 4280.35,
        totalExposure: 124500,
        positions: [
          { symbol: "AAPL", unrealizedPnl: 1280.32, price: 183.5, weight: 29 },
          { symbol: "TSLA", unrealizedPnl: 2150.12, price: 246.9, weight: 43 },
          { symbol: "BTC", unrealizedPnl: 850.91, price: 68200, weight: 28 },
        ],
      });
    }

    try {
      const positions = await getPositionsByUser(userId);
      const totalUnrealized = positions.reduce((sum, position) => sum + Number(position.unrealizedPnl ?? 0), 0);
      const totalExposure = positions.reduce((sum, position) => {
        const price = Number(position.currentPrice ?? position.avgPrice ?? 0);
        return sum + Math.abs(Number(position.quantity) * price);
      }, 0);
      const payload = positions.map((position) => ({
        symbol: position.symbol,
        unrealizedPnl: Number(position.unrealizedPnl ?? 0),
        price: Number(position.currentPrice ?? position.avgPrice ?? 0),
        weight: totalExposure > 0 ? Math.round((Math.abs(Number(position.quantity) * Number(position.currentPrice ?? position.avgPrice ?? 0)) / totalExposure) * 100) : 0,
      }));
      return res.json({ totalUnrealized, totalExposure, positions: payload });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Unable to load watch summary." });
    }
  });
}
