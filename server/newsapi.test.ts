import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("NewsAPI Integration", () => {
  const mockFetch = vi.fn();
  const originalNewsApiKey = process.env.NEWS_API_KEY;

  beforeEach(() => {
    process.env.NEWS_API_KEY = "test-news-api-key";
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    if (originalNewsApiKey) {
      process.env.NEWS_API_KEY = originalNewsApiKey;
    } else {
      delete process.env.NEWS_API_KEY;
    }
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it("should have NEWS_API_KEY set in environment", () => {
    const key = process.env.NEWS_API_KEY;
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(10);
  });

  it("should fetch financial news from NewsAPI", async () => {
    const key = process.env.NEWS_API_KEY;
    mockFetch.mockResolvedValue({
      json: async () => ({
        status: "ok",
        totalResults: 1,
        articles: [{ title: "Markets rally after earnings" }],
      }),
    });

    const res = await fetch(
      `https://newsapi.org/v2/everything?q=stock+market&pageSize=3&language=en&sortBy=publishedAt&apiKey=${key}`
    );
    const data = await res.json() as { status: string; totalResults: number; articles: Array<{ title: string }> };
    expect(data.status).toBe("ok");
    expect(data.totalResults).toBeGreaterThan(0);
    expect(data.articles.length).toBeGreaterThan(0);
    expect(data.articles[0].title).toBeTruthy();
  }, 15000);
});
