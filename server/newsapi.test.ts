import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the NewsAPI call to validate the key is set and the API responds
describe("NewsAPI Integration", () => {
  it("should have NEWS_API_KEY set in environment", () => {
    const key = process.env.NEWS_API_KEY;
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(10);
  });

  it("should fetch financial news from NewsAPI", async () => {
    const key = process.env.NEWS_API_KEY;
    if (!key) {
      console.warn("NEWS_API_KEY not set, skipping live test");
      return;
    }
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
