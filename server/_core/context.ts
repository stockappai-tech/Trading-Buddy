import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getUserByOpenId, DEV_OPEN_ID } from "../devDb";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  // Dev mode: no DATABASE_URL means we're running locally — auto-authenticate.
  if (!process.env.DATABASE_URL) {
    const user = (await getUserByOpenId(DEV_OPEN_ID)) ?? null;
    return { req: opts.req, res: opts.res, user };
  }

  let user: User | null = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  return { req: opts.req, res: opts.res, user };
}
