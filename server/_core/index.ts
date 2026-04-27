import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerAudioUploadRoute } from "../audioUpload";
import { registerMobileRoutes } from "./mobileRoutes";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { sdk } from "./sdk";
import { DEV_OPEN_ID } from "../devDb";
import { getSessionCookieOptions } from "./cookies";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Dev auto-login — only available when DATABASE_URL is not set (local dev)
  if (!process.env.DATABASE_URL) {
    app.get("/api/dev/login", async (req, res) => {
      const token = await sdk.signSession({ openId: DEV_OPEN_ID, appId: "dev", name: "Dev User" });
      res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    });
    console.log("[Dev] Auto-login available at http://localhost:3000/api/dev/login");
  }

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Audio upload for voice recording
  registerAudioUploadRoute(app);
  // Mobile helper endpoints for push, voice commands, and wearable summaries
  registerMobileRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
