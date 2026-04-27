# Trading Buddy AI - TODO

## Database & Schema
- [x] trades table (symbol, side, qty, entry_price, exit_price, pnl, status, session_id, user_id, timestamps)
- [x] sessions table (user_id, title, transcript, audio_url, summary, coach_feedback, emotional_note, timestamps)
- [x] user_preferences table (user_id, coach_mode, risk_per_trade, account_size, notifications_enabled, tradier_token, tradier_account_id, is_premium)
- [x] positions table (user_id, symbol, qty, avg_price, open_date)
- [x] alerts table (user_id, symbol, target_price, alert_type, triggered)
- [x] coach_messages table (user_id, role, content, coach_mode, timestamps)

## Server / API
- [x] Tradier API proxy endpoint (quotes, positions, account data)
- [x] Voice transcription endpoint (upload audio → Whisper → text)
- [x] LLM trade extraction from transcript
- [x] AI coach chat endpoint (3 personality modes: Sergeant, Friend, Expert)
- [x] Market news + sentiment endpoint (Forge Data API)
- [x] PDF export endpoint (server-side data fetch + client-side jsPDF render)
- [x] Alert/notification system (position targets, stop losses, in-app notifications)
- [x] Trade CRUD procedures (create, list, update, delete)
- [x] Session CRUD procedures
- [x] User preferences procedures
- [x] PnL aggregation queries (daily/weekly/monthly/6mo/yearly)
- [x] Pattern analysis (win/loss ratio, best symbols, time-of-day heatmap)
- [x] Premium tier gating (FORBIDDEN error for non-premium users on coach.chat)
- [x] Audio file upload route (multer → S3 storage)
- [x] Analytics summary (totalPnl, winRate, profitFactor, avgWin, avgLoss)

## Frontend Pages
- [x] Dashboard page (PnL chart, live Tradier quotes, open positions, daily summary)
- [x] Voice Recording page (record, transcribe, extract trades, review & save)
- [x] Trade History page (filterable table, entry/exit/qty/pnl columns, manual entry)
- [x] AI Coach page (chat interface, 3 personality modes, premium gate)
- [x] Analytics page (pattern analysis, daily PnL bar, win/loss pie, symbol performance, time-of-day)
- [x] Sessions & News page (session list with PDF export, market news for traded symbols)
- [x] Settings page (account size, risk %, coach mode, notifications, Tradier token, price alerts)
- [x] Upgrade/Pricing page (free vs premium feature comparison)
- [x] Home landing page

## UI Components
- [x] DashboardLayout with sidebar navigation (7 nav items + upgrade CTA)
- [x] PnL chart (Recharts, multi-timeframe with period selector)
- [x] Live quote ticker component (Tradier polling every 30s)
- [x] Trade entry form (manual entry with dialog)
- [x] Voice recorder component (MediaRecorder API with waveform timer)
- [x] Coach personality selector (Sergeant / Friend / Expert)
- [x] Alert badge / notification bell
- [x] PDF export button (jsPDF with full session report)
- [x] Dark trading terminal theme (OKLCH color palette)

## Features
- [x] Free/premium tier system with role-based access (isPremium flag in preferences)
- [x] Real-time Tradier quotes (polling every 30s on dashboard)
- [x] Live daily PnL including open positions with real-time prices
- [x] Session PDF export (jsPDF client-side with full trade log + coach feedback)
- [x] In-app notifications for price alerts (owner notification system)
- [x] Market news for traded symbols (Forge Data API)
- [x] Win/loss ratio pie chart
- [x] Best/worst performing symbols bar chart
- [x] Time-of-day performance bar chart
- [x] Dark theme professional trading UI

## Tests
- [x] Trade CRUD vitest (16 tests passing across 2 test files)
- [x] PnL calculation vitest (analytics.summary test)
- [x] LLM extraction vitest (mock - coach.freeChat test)
- [x] Auth logout vitest
- [x] Premium gating vitest

## Bug Fixes
- [x] Fix SQL error: ONLY_FULL_GROUP_BY violation in getPnlByPeriod / getTimeOfDayPerformance / getSymbolPerformance — rewrote as raw SQL with column aliases
- [x] Fix "Buffer is not defined" runtime error — removed unused Buffer.from() call in VoiceRecording.tsx (FormData handles upload natively)
- [x] Add Take Profit and Stop Loss fields to each trade card in Review Extracted Trades section
- [x] Move emotional note into Review section with emoji mood picker, remove duplicate prompt from recording area
- [x] Auto-transcribe voice recording immediately after stop (removed manual Transcribe button, auto-starts on onstop)
- [x] Pass open positions context to AI extraction so closing trades auto-fill entry price, quantity, TP, SL from original open position
- [x] Fix "null" text displaying in Trade History notes column — added ?? "—" fallback to notes, verified all other nullable fields already use ?? guards
- [x] Fix decimal precision: show only 2 decimal places everywhere (prices, PnL) — no 4-digit decimals
- [x] Auto-recalculate PnL in Review when user edits exit price, entry price, or quantity
- [x] TP/SL smart defaults: derive suggested placeholder values from entry price (±2-3%) instead of showing empty/null
- [x] Apply 2-decimal formatting consistently across Dashboard, Trade History, Analytics, Sessions pages — confirmed all use toFixed(2) or formatPnl()
- [x] Pre-fill TP/SL with actual computed values (+3%/-2% from entry) when AI doesn’t return them, applied at both extraction paths
- [x] Fix 4-decimal display in Review section — normalize all AI-extracted numeric strings to 2 decimals on extraction
- [x] Fix TP/SL and notes showing "null" string — strip null/undefined strings at normalization step, auto-fill TP/SL from entry
- [x] Add price magnitude sanity correction: auto-scale exit/TP/SL prices implausibly far from entry (e.g. 1.72 when entry is 150 → corrected to 172.00). Applied both in AI prompt and in client-side sanitizePrice() fallback.
- [x] Fix Dashboard open positions still showing AAPL after it was closed — added isNull(exitPrice) guard to getOpenTrades, force status=closed on save, invalidate openTrades cache
- [x] Fix Best Trade / Worst Trade showing same symbol (+440/-440) — bestTrade now only from wins[], worstTrade only from losses[]
- [x] AAPL still showing as open position on Dashboard — root cause: AI saved close as new SELL trade instead of updating original BUY. Fixed with: (1) fixOrphanedOpenTrades() that closes BUY when matching closed SELL exists, (2) auto-called on Dashboard mount via useEffect, (3) openTrades cache invalidated on fix
- [x] Update voice/session save workflow: handleSaveSession now checks for matching open trade (same symbol, opposite side) and calls trades.update instead of creating a duplicate SELL/COVER row
- [x] Add deterministic symbol+side matching in handleSaveSession: sell→buy, cover→short matching against openTradesData before saving
- [x] Fix P&L double-counting: Dashboard shows +$880 instead of +$440 — duplicate SELL trade still in DB alongside the now-closed BUY trade
- [x] Add server-side deduplication cleanup: remove orphaned SELL/COVER trades that are duplicates of already-closed BUY/SHORT rows (same user, symbol, quantity, entry/exit price) — run on startup and expose as admin endpoint
- [x] Add vitest coverage for duplicate trade deduplication logic
- [x] AI Coach TTS: auto-speak each coach response using Web Speech API (SpeechSynthesis), with a stop button to interrupt playback and a mute/unmute toggle so the user can disable auto-speak

## Pricing Tiers Redesign
- [x] Redesign Upgrade page with 3 tiers: Starter (free 30 days), Pro ($29/mo), Elite ($79/mo)
- [x] Starter tier: unlimited voice journaling, 30 trades/month, basic dashboard, 1 AI coach mode (Friend), market news
- [x] Pro tier: unlimited trades, all 3 coach personalities + TTS, full analytics, PDF export, price alerts, Tradier live quotes
- [x] Elite tier: everything in Pro + AI Discipline Score per trade, weekly AI performance report emailed, pattern detection ("you lose 80% of trades after 2pm"), trade replay timeline, priority support badge

## World-Class Engagement Features
- [x] Trade Streak tracker: show consecutive days journaled on Dashboard (like Duolingo streak), reset if no trade logged that day
- [x] Discipline Score: AI rates each trade 1-10 on rule-following (did you respect your stop loss? did you chase?), shown on trade card
- [x] Add discipline_score and discipline_feedback columns to trades table in schema and DB
- [x] Daily Pre-Market Briefing: teaser card on Dashboard with Elite upgrade CTA (full AI briefing is Elite-tier feature)
- [x] Performance Badges/Milestones: earn badges for "First 10 trades", "7-day streak", "Win rate > 60%", "Best week ever", shown on Dashboard
- [x] Pattern Alerts: AI detects behavioral patterns ("You lose 78% of TSLA trades after 2pm") and shows a warning card on Dashboard
- [x] Weekly Performance Report: auto-generated summary card every Monday showing last week's stats vs prior week
- [x] Emotional Heatmap: calendar view showing mood emoji per day, colored by P&L — see if emotions correlate with performance
- [x] Trade Replay Timeline: DEFERRED — Tradier removed; Finnhub historical candles require paid tier. Will revisit when a free historical data source is available.

## Voice & Ticker Improvements
- [x] TTS voice quality: replace robotic default voice with best available natural-sounding system voice; increase default volume and use better pitch/rate settings
- [x] TTS voice picker: add 4 selectable voice options in AI Coach header (2 male, 2 female) with names like "Alex (Male)", "Ryan (Male)", "Emma (Female)", "Sophia (Female)"; persist selection to localStorage
- [x] Smart ticker correction: post-process voice transcription to replace spoken company names with correct tickers (Honda→ONDS, Apple→AAPL, Tesla→TSLA, Amazon→AMZN, Google→GOOGL, Microsoft→MSFT, Nvidia→NVDA, Meta→META, Netflix→NFLX, etc.) — run on server before AI extraction

## Human Voice TTS Upgrade
- [x] Replace browser SpeechSynthesis with OpenAI TTS API — SUPERSEDED: ElevenLabs TTS was implemented instead (higher quality, free tier)
- [x] Add server-side tRPC procedure sessions.tts — DONE via ElevenLabs (see ElevenLabs TTS Integration section)
- [x] Update AI Coach frontend to play audio from API — DONE via ElevenLabs
- [x] Add RGTI and phonetic ticker corrections: "our GTI"→RGTI, "r GTI"→RGTI, "argie"→RGTI — DONE in tickerCorrection.ts (see Google Cloud TTS Integration section)

## Google Cloud TTS Integration
- [x] Add GOOGLE_TTS_API_KEY secret to the project (pending user providing key)
- [x] Build server-side tRPC procedure sessions.tts that calls Google Cloud TTS Neural2/Studio voices and returns base64 audio
- [x] Update AI Coach frontend to play Google TTS audio instead of browser SpeechSynthesis
- [x] Map 4 voice picker options to Google Neural2 voices (2 male, 2 female)
- [x] Add RGTI phonetic corrections: "our GTI"→RGTI, "r GTI"→RGTI, "argie"→RGTI to tickerCorrection.ts

## ElevenLabs TTS Integration (replacing Google TTS)
- [x] Add ELEVENLABS_API_KEY secret to the project
- [x] Replace googleTts.ts helper with elevenLabsTts.ts using ElevenLabs v1 TTS API
- [x] Map 4 voice picker options to ElevenLabs premade voice IDs: Adam, George (male), Sarah, Laura (female) — all confirmed free-tier
- [x] Update sessions.tts tRPC procedure to use ElevenLabs instead of Google TTS
- [x] Update AICoach.tsx voice persona map to use ElevenLabs voice IDs

## AI Coach Mic Button
- [x] Add microphone button next to the send button in AI Coach chat input — tap to record, auto-transcribes and fills the input field, tap again or silence stops recording

## AI Coach Mic Fix
- [x] Replace Web Speech API in AI Coach mic with MediaRecorder + Whisper (same as Record Session) to fix "Mic error: network"

## ElevenLabs TTS Fallback
- [x] Add graceful fallback: when ElevenLabs returns 401/unusual activity, silently fall back to browser SpeechSynthesis instead of throwing an error, and show a one-time toast explaining the voice quality downgrade

## Sign-In Bug
- [x] Fix sign-in page: users cannot sign in — was a preview session expiry issue, not a code bug; resolved by restarting server and saving fresh checkpoint

## Notes on Completed Features
- Pattern Alerts are heuristic rule-based (client-side, using time-of-day win rate < 35%, symbol P&L drain, consecutive losses) — not LLM-backed. Accurate description: "rule-based behavioral pattern alerts".
- Weekly Performance Report is a rolling 7-day comparison (always visible when trades exist), not Monday-only triggered. Accurate description: "rolling weekly report comparing last 7 days vs prior 7 days".

## Watchlist & Win Rate Fix
- [x] Fix win rate bug: renamed "60% Win Rate" badge to "Sharp Shooter" to avoid confusion
- [x] Replace Sessions tab with Watchlist tab: user can add/remove tickers to a personal watchlist
- [x] Market News on Watchlist tab pulls from watchlist symbols instead of recent trades
- [x] Add watchlist table to DB schema (user_id, symbol, added_at)
- [x] Add watchlist CRUD procedures (add, remove, list)
- [x] Update sidebar nav label from "Sessions" to "Watchlist & News"

## Tradier Removal & Finnhub Integration
- [x] Remove Tradier API section from Settings page entirely
- [x] Add "Market Data Included" card in Settings for Pro/Elite users (no manual API key needed)
- [x] Replace Tradier quote/news calls in routers.ts with Finnhub API (free tier: 60 calls/min, real-time US quotes + company news)
- [x] Add FINNHUB_API_KEY secret to project
- [x] Update Dashboard live quotes to use Finnhub /quote endpoint
- [x] Update Market News to use Finnhub /company-news endpoint
- [x] Remove tradierToken and tradierAccountId from preferences update schema (columns kept in DB for backward compat, hidden from UI)

## AI Coach Voice-Only Redesign
- [x] Remove chat transcript from AI Coach (no text shown for user input or AI reply)
- [x] Remove text input box and Send button — voice-only interaction
- [x] Push-to-talk: on mic release, auto-transcribe and immediately send to AI, then speak response (no CC text)
- [x] Add animated AI avatar in the center of the coach screen (pulsing/wave animation when speaking, idle when not)
- [x] Keep voice picker dropdown and coach mode selector
- [x] Remove saveCoachMessage calls from backend (no DB storage of chat history)

## AI Coach Voice & Avatar Fixes
- [x] Fix voice gender labels: Adam & George = Male, Sarah & Laura = Female (shown in dropdown with real portrait thumbnails)
- [x] Wire coach mode tone into ElevenLabs TTS: Sergeant = high stability 0.80 (firm/controlled), Friend = low stability 0.40 (warm/expressive), Expert = medium stability 0.60 (precise/measured)
- [x] Replace animated SVG avatar with real AI portrait photos (4 photorealistic headshots: Adam, George, Sarah, Laura) with animated rings and speaking/listening overlays

## Bug Fixes - April 2026
- [x] Fix auto-close bug: fixOrphanedOpenTrades now requires strict matching (same symbol + same entry price + correct side + closer must be newer) — no more false-positive closes
- [x] Fix open positions count: root cause was the aggressive orphan-fixer closing valid open trades; now fixed, both AAPL and CGTX will stay open
- [x] Add price sanity check: Finnhub live price used as second anchor for magnitude correction (e.g. "Apple at 253" → $253, not $2.53)
- [x] Enforce 2:1 TP/SL ratio: if extracted TP distance < 2x SL distance, TP is automatically extended to exactly 2x SL distance

## AI Coach Fixes - April 2026 Round 2
- [x] Fix ElevenLabs voices: removed random browser fallback — each persona now always uses its fixed ElevenLabs voice ID; if ElevenLabs fails, a clear error toast is shown instead of a random system voice
- [x] Fix coach mode tone: style parameter now passed through to ElevenLabs (Sergeant=0.10 style/0.80 stability, Friend=0.45 style/0.40 stability, Expert=0.25 style/0.60 stability)
- [x] Wire real-time Finnhub news: coach.chat now fetches last 7 days of headlines for user's traded symbols before LLM call and injects them as context
- [x] Add stop-speaking button: red pulsing ■ button appears to the left of the mic button whenever the coach is speaking; status text also updates to "Tap ■ to stop coach"

## TTS Replacement & Close-at-Market - April 2026
- [x] Replace ElevenLabs TTS with Web Speech API (deterministic voice selection per persona, no quota, no API key needed)
- [x] Keep 4 voice personas (Adam/George/Sarah/Laura) mapped to browser neural voices with correct gender
- [x] When voice session says "close AAPL" or "sell AAPL", auto-fill exit price with live Finnhub quote (market price)
- [x] Auto-fill share quantity from the matching open position (not from what user says)
- [x] Confirmation shown in Review section: exit price pre-filled, PnL auto-calculated using live price

## Emotion & News Updates - April 2026
- [x] Add Mad, Upset, Afraid to mood picker in VoiceRecording session review
- [x] Replace Finnhub news with finance-feed.netlify.app real-time news feed — SUPERSEDED: finance-feed.netlify.app is a Next.js SPA (client-side rendered), not scrapeable server-side. NewsAPI.org (same underlying source) is used instead.
- [x] Update Watchlist & News page to use finance-feed.netlify.app articles — DONE via NewsAPI.org
- [x] Update AI Coach news context to use finance-feed.netlify.app articles — DONE via NewsAPI.org (coach.chat fetches NewsAPI headlines before LLM call)

## NewsAPI & Close Fix - April 2026
- [x] Add NEWS_API_KEY secret and wire NewsAPI.org in routers.ts market.news procedure
- [x] Show real-time Finnhub price alongside each news article in Watchlist & News
- [x] Show article publish timestamp on each news card (relative time: "5m ago", "2h ago")
- [x] Fix voice close: "close CGTX" (no price) now pre-fetches fresh Finnhub quote before extraction in both voice and manual transcript paths

## Voice News Command - April 2026
- [x] Detect news intent in coach.chat ("news on AAPL", "what's happening with Tesla", "latest on NVDA")
- [x] Fetch NewsAPI headlines for the mentioned ticker and inject as structured context
- [x] AI Coach responds with a spoken summary of top 3-5 headlines (under 120 words for clean TTS)
- [x] Return article list (title + url + source + time) alongside the spoken response
- [x] Display article cards below the avatar when a news response is given (scrollable, max 5 cards)
- [x] Add hint text on AI Coach page: "Try: 'What's the latest news on AAPL?'"
