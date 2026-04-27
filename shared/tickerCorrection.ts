/**
 * tickerCorrection.ts
 *
 * Corrects spoken company/ETF names in a transcribed string to their proper
 * stock ticker symbols. This runs server-side on the raw Whisper transcript
 * BEFORE the LLM trade-extraction step, so the AI always sees clean tickers.
 *
 * Rules:
 * - Only replaces whole words (word-boundary match) to avoid false positives.
 * - Case-insensitive matching; replacements are always uppercase.
 * - Longer / more-specific phrases are matched first (sorted by length desc).
 */

export const SPOKEN_TO_TICKER: Record<string, string> = {
  // ─── User-specific corrections ──────────────────────────────────────────────
  "honda":              "ONDS",   // user's accent maps Honda → ONDS (Ondas Holdings)
  "ondas":              "ONDS",
  "onds":               "ONDS",

  // RGTI (Rigetti Computing) — common phonetic misreadings
  "our gti":            "RGTI",
  "r gti":              "RGTI",
  "argie":              "RGTI",
  "arjie":              "RGTI",
  "r g t i":            "RGTI",
  "rigetti":            "RGTI",
  "rigety":             "RGTI",
  "rigeti":             "RGTI",
  "rgti":               "RGTI",

  // ─── Mega-cap / household names ─────────────────────────────────────────────
  "apple":              "AAPL",
  "tesla":              "TSLA",
  "amazon":             "AMZN",
  "google":             "GOOGL",
  "alphabet":           "GOOGL",
  "microsoft":          "MSFT",
  "nvidia":             "NVDA",
  "meta":               "META",
  "facebook":           "META",
  "netflix":            "NFLX",
  "salesforce":         "CRM",
  "adobe":              "ADBE",
  "intel":              "INTC",
  "amd":                "AMD",
  "advanced micro":     "AMD",
  "advanced micro devices": "AMD",
  "qualcomm":           "QCOM",
  "broadcom":           "AVGO",
  "texas instruments":  "TXN",
  "micron":             "MU",
  "western digital":    "WDC",
  "seagate":            "STX",
  "applied materials":  "AMAT",
  "lam research":       "LRCX",
  "kla":                "KLAC",
  "asml":               "ASML",

  // ─── Finance ────────────────────────────────────────────────────────────────
  "jpmorgan":           "JPM",
  "jp morgan":          "JPM",
  "goldman":            "GS",
  "goldman sachs":      "GS",
  "morgan stanley":     "MS",
  "bank of america":    "BAC",
  "wells fargo":        "WFC",
  "citigroup":          "C",
  "citi":               "C",
  "blackrock":          "BLK",
  "visa":               "V",
  "mastercard":         "MA",
  "american express":   "AXP",
  "amex":               "AXP",
  "paypal":             "PYPL",
  "square":             "SQ",
  "block":              "SQ",
  "coinbase":           "COIN",
  "robinhood":          "HOOD",

  // ─── Healthcare / Pharma ────────────────────────────────────────────────────
  "johnson and johnson": "JNJ",
  "johnson & johnson":  "JNJ",
  "pfizer":             "PFE",
  "moderna":            "MRNA",
  "abbvie":             "ABBV",
  "merck":              "MRK",
  "eli lilly":          "LLY",
  "lilly":              "LLY",
  "unitedhealth":       "UNH",
  "united health":      "UNH",
  "cvs":                "CVS",
  "walgreens":          "WBA",

  // ─── Energy ─────────────────────────────────────────────────────────────────
  "exxon":              "XOM",
  "exxon mobil":        "XOM",
  "chevron":            "CVX",
  "conocophillips":     "COP",
  "conoco":             "COP",
  "schlumberger":       "SLB",
  "halliburton":        "HAL",

  // ─── Consumer / Retail ──────────────────────────────────────────────────────
  "walmart":            "WMT",
  "target":             "TGT",
  "costco":             "COST",
  "home depot":         "HD",
  "lowes":              "LOW",
  "lowe's":             "LOW",
  "nike":               "NKE",
  "starbucks":          "SBUX",
  "mcdonalds":          "MCD",
  "mcdonald's":         "MCD",
  "disney":             "DIS",
  "comcast":            "CMCSA",
  "ford":               "F",
  "ford motor":         "F",
  "general motors":     "GM",
  "gm":                 "GM",
  "rivian":             "RIVN",
  "lucid":              "LCID",
  "uber":               "UBER",
  "lyft":               "LYFT",
  "airbnb":             "ABNB",
  "doordash":           "DASH",
  "instacart":          "CART",
  "shopify":            "SHOP",
  "etsy":               "ETSY",
  "ebay":               "EBAY",

  // ─── Cloud / SaaS / Tech ────────────────────────────────────────────────────
  "palantir":           "PLTR",
  "snowflake":          "SNOW",
  "datadog":            "DDOG",
  "cloudflare":         "NET",
  "crowdstrike":        "CRWD",
  "crowd strike":       "CRWD",
  "palo alto":          "PANW",
  "palo alto networks": "PANW",
  "fortinet":           "FTNT",
  "zscaler":            "ZS",
  "okta":               "OKTA",
  "twilio":             "TWLO",
  "zoom":               "ZM",
  "slack":              "CRM",   // acquired by Salesforce
  "servicenow":         "NOW",
  "workday":            "WDAY",
  "hubspot":            "HUBS",
  "mongodb":            "MDB",
  "mongo":              "MDB",
  "elastic":            "ESTC",
  "confluent":          "CFLT",
  "gitlab":             "GTLB",
  "github":             "MSFT",  // owned by Microsoft
  "unity":              "U",
  "roblox":             "RBLX",
  "spotify":            "SPOT",
  "twitter":            "X",
  "x corp":             "X",
  "snap":               "SNAP",
  "snapchat":           "SNAP",
  "pinterest":          "PINS",
  "reddit":             "RDDT",

  // ─── Aerospace / Defense ────────────────────────────────────────────────────
  "boeing":             "BA",
  "lockheed":           "LMT",
  "lockheed martin":    "LMT",
  "raytheon":           "RTX",
  "northrop":           "NOC",
  "northrop grumman":   "NOC",
  "general dynamics":   "GD",
  "spacex":             "SPCE",  // Virgin Galactic, SpaceX is private
  "virgin galactic":    "SPCE",

  // ─── Popular ETFs ───────────────────────────────────────────────────────────
  "spy":                "SPY",
  "s&p":                "SPY",
  "s and p":            "SPY",
  "qqq":                "QQQ",
  "nasdaq":             "QQQ",
  "iwm":                "IWM",
  "russell":            "IWM",
  "dia":                "DIA",
  "dow":                "DIA",
  "vxx":                "VXX",
  "uvxy":               "UVXY",
  "sqqq":               "SQQQ",
  "tqqq":               "TQQQ",
  "spxu":               "SPXU",
  "upro":               "UPRO",
  "xlf":                "XLF",
  "xle":                "XLE",
  "xlk":                "XLK",
  "xlv":                "XLV",
  "gld":                "GLD",
  "gold etf":           "GLD",
  "slv":                "SLV",
  "silver etf":         "SLV",
  "tlt":                "TLT",
  "bonds":              "TLT",
  "arkk":               "ARKK",
  "ark":                "ARKK",
};

/**
 * Replaces spoken company/ETF names in a transcript with their ticker symbols.
 * Matches are whole-word, case-insensitive, longest-match-first.
 */
export function correctTickers(transcript: string): string {
  // Sort by phrase length descending so "advanced micro devices" matches before "advanced micro"
  const sorted = Object.entries(SPOKEN_TO_TICKER).sort((a, b) => b[0].length - a[0].length);

  let result = transcript;
  for (const [spoken, ticker] of sorted) {
    // Escape special regex characters in the spoken phrase
    const escaped = spoken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    result = result.replace(re, ticker);
  }
  return result;
}
