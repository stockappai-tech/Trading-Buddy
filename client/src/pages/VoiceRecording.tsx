import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { REALTIME_INTERVALS } from "@/lib/realtime";
import { trpc } from "@/lib/trpc";
import { Check, Loader2, Mic, MicOff, Save, Sparkles, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type ExtractedTrade = {
  symbol: string;
  side: "buy" | "sell" | "short" | "cover";
  quantity: string;
  entryPrice: string;
  exitPrice?: string;
  pnl?: string;
  takeProfit?: string;
  takeProfit2?: string;
  stopLoss?: string;
  status: "open" | "closed";
  notes?: string;
};

type RecordingState = "idle" | "recording" | "stopped" | "transcribing" | "extracting" | "reviewing";

export default function VoiceRecording() {
  const [state, setState] = useState<RecordingState>("idle");
  const [transcript, setTranscript] = useState("");
  const [emotionalNote, setEmotionalNote] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [extractedTrades, setExtractedTrades] = useState<ExtractedTrade[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [sessionId, setSessionId] = useState<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [, navigate] = useLocation();

  const utils = trpc.useUtils();
  const createSession = trpc.sessions.create.useMutation();
  const updateSession = trpc.sessions.update.useMutation();
  const transcribeMutation = trpc.sessions.transcribe.useMutation();
  const extractMutation = trpc.sessions.extractTrades.useMutation();
  const createTrade = trpc.trades.create.useMutation();
  const updateTradeMutation = trpc.trades.update.useMutation();
  const generateSummary = trpc.sessions.generateSummary.useMutation();

  // Fetch open positions to give AI context when closing trades
  const { data: openTradesData } = trpc.trades.openTrades.useQuery(undefined, { refetchInterval: REALTIME_INTERVALS.quote });

  // Fetch live Finnhub quotes for all extracted symbols to anchor price magnitude correction
  const [extractedSymbols, setExtractedSymbols] = useState<string>("");
  const { data: liveQuotesData } = trpc.market.quotes.useQuery(
    { symbols: extractedSymbols },
    { enabled: !!extractedSymbols, refetchInterval: REALTIME_INTERVALS.quote }
  );
  // Build a symbol -> last price map for sanitizePrice
  const liveQuoteMap: Record<string, number> = {};
  if (liveQuotesData) {
    for (const q of liveQuotesData as Array<{ symbol: string; last: number }>) {
      if (q.symbol && q.last) liveQuoteMap[q.symbol] = q.last;
    }
  }

  // When live quotes arrive (async after extraction), re-run price correction on extracted trades.
  // This ensures that if the AI extracted "2.53" for AAPL (live ~$213), it gets corrected to "253.00".
  const liveQuoteMapRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!liveQuotesData || extractedTrades.length === 0) return;
    const newMap: Record<string, number> = {};
    for (const q of liveQuotesData as Array<{ symbol: string; last: number }>) {
      if (q.symbol && q.last) newMap[q.symbol] = q.last;
    }
    // Only re-apply if the map actually has new data
    const hasData = Object.keys(newMap).length > 0;
    const changed = JSON.stringify(newMap) !== JSON.stringify(liveQuoteMapRef.current);
    if (hasData && changed) {
      liveQuoteMapRef.current = newMap;
      setExtractedTrades((prev) => applyTpSlDefaults(prev, newMap));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveQuotesData]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        // Auto-transcribe immediately after recording stops
        setTimeout(() => autoTranscribe(blob), 300);
      };

      mediaRecorder.start(1000);
      setState("recording");
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch {
      toast.error("Microphone access denied. Please allow microphone access.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && state === "recording") {
      mediaRecorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      setState("transcribing"); // immediately show transcribing state
    }
  };

  // Build open positions context for AI extraction
  const buildOpenPositionsContext = () => {
    if (!openTradesData || !Array.isArray(openTradesData)) return [];
    return openTradesData.map((t: any) => ({
      symbol: t.symbol as string,
      side: t.side as "buy" | "sell" | "short" | "cover",
      quantity: t.quantity as string,
      entryPrice: t.entryPrice as string,
      takeProfit: t.takeProfit as string | null | undefined,
      takeProfit2: t.takeProfit2 as string | null | undefined,
      stopLoss: t.stopLoss as string | null | undefined,
      notes: t.notes as string | null | undefined,
    }));
  };

  const autoTranscribe = async (blob: Blob) => {
    setState("transcribing");
    try {
      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");

      const uploadRes = await fetch("/api/upload-audio", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { url } = await uploadRes.json() as { url: string };

      const title = sessionTitle || `Session ${new Date().toLocaleDateString()}`;
      const session = await createSession.mutateAsync({ title, audioUrl: url, emotionalNote });
      setSessionId(session.id);

      const result = await transcribeMutation.mutateAsync({ audioUrl: url });
      setTranscript(result.transcript);
      setState("extracting");

      const openPositions = buildOpenPositionsContext();
      // Fetch live quotes for open position symbols so the server can auto-fill
      // exit price at market when user says "close AAPL" (no price mentioned)
      let preQuoteMap: Record<string, number> = { ...liveQuoteMap };
      const openSymbols = openPositions.map((p) => p.symbol).join(",");
      if (openSymbols) {
        try {
          const freshQuotes = await utils.market.quotes.fetch({ symbols: openSymbols });
          for (const q of freshQuotes as Array<{ symbol: string; last: number }>) {
            if (q.symbol && q.last) preQuoteMap[q.symbol] = q.last;
          }
        } catch { /* ignore — fall back to cached liveQuoteMap */ }
      }
      const extracted = await extractMutation.mutateAsync({ transcript: result.transcript, openPositions, liveQuotes: preQuoteMap });
      // Kick off live quote fetch for extracted symbols (used for price magnitude correction)
      const symbols = (extracted.trades as ExtractedTrade[]).map((t) => t.symbol).join(",");
      if (symbols) setExtractedSymbols(symbols);
      setExtractedTrades(applyTpSlDefaults(extracted.trades as ExtractedTrade[], preQuoteMap));
      setState("reviewing");
    } catch (err: any) {
      toast.error(err.message ?? "Transcription failed");
      setState("stopped");
    }
  };

  // Keep handleTranscribe for manual retry
  const handleTranscribe = async () => {
    if (!audioBlob) return;
    await autoTranscribe(audioBlob);
  };

  const handleManualTranscript = async () => {
    if (!transcript.trim()) return;
    setState("extracting");
    try {
      const title = sessionTitle || `Session ${new Date().toLocaleDateString()}`;
      const session = await createSession.mutateAsync({ title, transcript, emotionalNote });
      setSessionId(session.id);

      const openPositions = buildOpenPositionsContext();
      // Pre-fetch live quotes for open positions so server can auto-fill exit price at market
      let preQuoteMap: Record<string, number> = { ...liveQuoteMap };
      const openSymbols = openPositions.map((p) => p.symbol).join(",");
      if (openSymbols) {
        try {
          const freshQuotes = await utils.market.quotes.fetch({ symbols: openSymbols });
          for (const q of freshQuotes as Array<{ symbol: string; last: number }>) {
            if (q.symbol && q.last) preQuoteMap[q.symbol] = q.last;
          }
        } catch { /* ignore — fall back to cached liveQuoteMap */ }
      }
      const extracted = await extractMutation.mutateAsync({ transcript, openPositions, liveQuotes: preQuoteMap });
      const symbols = (extracted.trades as ExtractedTrade[]).map((t) => t.symbol).join(",");
      if (symbols) setExtractedSymbols(symbols);
      setExtractedTrades(applyTpSlDefaults(extracted.trades as ExtractedTrade[], preQuoteMap));
      setState("reviewing");
    } catch (err: any) {
      toast.error(err.message ?? "Extraction failed");
      setState("stopped");
    }
  };

  const handleSaveSession = async () => {
    if (!sessionId) return;
    try {
      // Save all extracted trades
      // If a trade is a close (has exitPrice) AND matches an existing open position,
      // close it fully or reduce its quantity for a partial exit.
      for (const trade of extractedTrades) {
        let tradeToSave = { ...trade };
        const closeLikeTrade = tradeToSave.side === "sell" ||
          tradeToSave.side === "cover" ||
          tradeToSave.status === "closed" ||
          /\b(close|closed|closing|exit|exited|sell|sold|cover|covered)\b/i.test(String(tradeToSave.notes ?? ""));

        // Try to find a matching open trade to update (same symbol, opposite side)
        const matchingSide = tradeToSave.side === "sell" ? "buy" : tradeToSave.side === "cover" ? "short" : null;
        const matchingOpen = openTradesData
          ? openTradesData.find(o => o.symbol === tradeToSave.symbol && (matchingSide ? o.side === matchingSide : closeLikeTrade))
          : null;

        if (matchingOpen && closeLikeTrade && !tradeToSave.exitPrice) {
          try {
            const freshQuotes = await utils.market.quotes.fetch({ symbols: matchingOpen.symbol });
            const quote = (freshQuotes as Array<{ symbol: string; last: number }>).find((q) => q.symbol === matchingOpen.symbol);
            if (quote?.last) {
              tradeToSave = {
                ...tradeToSave,
                symbol: matchingOpen.symbol,
                side: matchingOpen.side === "short" ? "cover" : "sell",
                quantity: tradeToSave.quantity || matchingOpen.quantity,
                entryPrice: matchingOpen.entryPrice,
                exitPrice: quote.last.toFixed(2),
                status: "closed",
                notes: tradeToSave.notes ?? "Closed at live market price",
              };
            }
          } catch {
            // If quote fetch fails, fall through and keep the trade editable instead of crashing save.
          }
        }

        const status = tradeToSave.exitPrice ? "closed" : (tradeToSave.status ?? "open");

        if (matchingOpen && tradeToSave.exitPrice) {
          const openQty = parseFloat(matchingOpen.quantity);
          const closeQty = parseFloat(tradeToSave.quantity);
          const entry = parseFloat(matchingOpen.entryPrice);
          const exit = parseFloat(tradeToSave.exitPrice);
          const isShortClose = matchingOpen.side === "short";
          const calculatedPnl = !isNaN(closeQty) && !isNaN(entry) && !isNaN(exit)
            ? (isShortClose ? (entry - exit) * closeQty : (exit - entry) * closeQty).toFixed(2)
            : tradeToSave.pnl;

          if (!isNaN(openQty) && !isNaN(closeQty) && closeQty > 0 && closeQty < openQty) {
            const remainingQty = openQty - closeQty;

            // Partial close: keep the original position open with the remaining quantity.
            await updateTradeMutation.mutateAsync({
              id: matchingOpen.id,
              quantity: remainingQty % 1 === 0 ? String(Math.round(remainingQty)) : remainingQty.toFixed(4),
              takeProfit: tradeToSave.takeProfit ?? matchingOpen.takeProfit ?? undefined,
              takeProfit2: tradeToSave.takeProfit2 ?? matchingOpen.takeProfit2 ?? undefined,
              stopLoss: tradeToSave.stopLoss ?? matchingOpen.stopLoss ?? undefined,
              notes: matchingOpen.notes ?? undefined,
            });

            // Record the realized partial exit as its own closed trade.
            await createTrade.mutateAsync({
              symbol: matchingOpen.symbol,
              side: matchingOpen.side,
              quantity: tradeToSave.quantity,
              entryPrice: matchingOpen.entryPrice,
              exitPrice: tradeToSave.exitPrice,
              pnl: calculatedPnl,
              status: "closed",
              takeProfit: tradeToSave.takeProfit ?? matchingOpen.takeProfit ?? undefined,
              takeProfit2: tradeToSave.takeProfit2 ?? matchingOpen.takeProfit2 ?? undefined,
              stopLoss: tradeToSave.stopLoss ?? matchingOpen.stopLoss ?? undefined,
              notes: tradeToSave.notes ?? `Partial close via ${tradeToSave.side}`,
              sessionId,
            });
          } else {
            // Full close: update the original open trade with exit data.
            await updateTradeMutation.mutateAsync({
              id: matchingOpen.id,
              exitPrice: tradeToSave.exitPrice,
              pnl: calculatedPnl,
              status: "closed",
              takeProfit: tradeToSave.takeProfit ?? matchingOpen.takeProfit ?? undefined,
              takeProfit2: tradeToSave.takeProfit2 ?? matchingOpen.takeProfit2 ?? undefined,
              stopLoss: tradeToSave.stopLoss ?? matchingOpen.stopLoss ?? undefined,
              notes: tradeToSave.notes ?? matchingOpen.notes ?? undefined,
            });
          }
        } else {
          // No matching open trade — create as new
          await createTrade.mutateAsync({ ...tradeToSave, status, sessionId });
        }
      }

      // Update session with emotional note
      if (emotionalNote && sessionId) {
        await updateSession.mutateAsync({ id: sessionId, emotionalNote });
      }

      // Generate AI summary
      await generateSummary.mutateAsync({ sessionId, transcript, trades: extractedTrades });

      utils.trades.list.invalidate();
      utils.trades.openTrades.invalidate();
      utils.analytics.summary.invalidate();
      utils.sessions.list.invalidate();

      toast.success(`Session saved with ${extractedTrades.length} trades!`);
      navigate("/dashboard");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save session");
    }
  };

  // Normalize a price/numeric string: strip "null"/"undefined", format to 2 decimals
  const normPrice = (val: string | null | undefined): string => {
    if (!val || val === "null" || val === "undefined") return "";
    const n = parseFloat(val);
    return isNaN(n) ? "" : n.toFixed(2);
  };

  /**
   * Fix speech-to-text decimal errors: if a price is implausibly far from the
   * reference (entry) price, try scaling it by 10x, 100x, 0.1x, 0.01x to find
   * the closest reasonable match.
   *
   * Additionally, if a liveMarketPrice is provided (from Finnhub), we use it as
   * a second anchor: if the candidate is closer to the live price after scaling,
   * we prefer that correction. This handles the case where the user says "Apple
   * at 253" and the AI extracts "2.53" — the live price of ~$213 confirms the
   * correct magnitude is ~$253, not $2.53.
   *
   * e.g. entry=150, candidate=1.72 → scaled 172 is within 20% → return "172.00"
   * e.g. entry=150, candidate=1720 → scaled 172 is within 20% → return "172.00"
   * e.g. livePrice=213, candidate=2.53 → scaled 253 is within 30% of live → return "253.00"
   */
  const sanitizePrice = (candidate: string, referenceEntry: number, liveMarketPrice?: number): string => {
    if (!candidate) return candidate;
    const raw = parseFloat(candidate);
    if (isNaN(raw)) return candidate;

    // Helper: is a value "close enough" to a reference (within 50%–200% range)
    const isClose = (val: number, ref: number) => ref > 0 && val / ref >= 0.5 && val / ref <= 2.0;

    // If already within range of entry, it's fine
    if (!isNaN(referenceEntry) && referenceEntry > 0 && isClose(raw, referenceEntry)) return candidate;

    // If already within range of live market price, it's fine
    if (liveMarketPrice && liveMarketPrice > 0 && isClose(raw, liveMarketPrice)) return candidate;

    // Try scaling factors to find a value within range of entry OR live price
    const scales = [10, 100, 0.1, 0.01, 1000, 0.001];
    let bestCandidate: string | null = null;

    for (const scale of scales) {
      const scaled = raw * scale;
      const closeToEntry = !isNaN(referenceEntry) && referenceEntry > 0 && isClose(scaled, referenceEntry);
      const closeToLive = liveMarketPrice && liveMarketPrice > 0 && isClose(scaled, liveMarketPrice);
      if (closeToEntry || closeToLive) {
        // Prefer the scale that is closest to the live price if available
        if (!bestCandidate) bestCandidate = scaled.toFixed(2);
        if (liveMarketPrice && liveMarketPrice > 0) {
          const prevBest = parseFloat(bestCandidate);
          if (Math.abs(scaled - liveMarketPrice) < Math.abs(prevBest - liveMarketPrice)) {
            bestCandidate = scaled.toFixed(2);
          }
        }
      }
    }

    return bestCandidate ?? candidate;
  };

  /**
   * Apply TP/SL defaults and enforce 2:1 risk-reward ratio.
   * Also uses live Finnhub quotes (if available) to sanity-check the entry price
   * magnitude — e.g. if user says "Apple at 253" and AI extracts "2.53",
   * the live price of ~$213 confirms the correct value is ~$253.
   *
   * 2:1 RULE: TP distance from entry must be >= 2x the SL distance from entry.
   * If the extracted TP/SL violates this, TP is automatically extended to 2x SL distance.
   */
  const applyTpSlDefaults = (rawTrades: ExtractedTrade[], liveQuotes?: Record<string, number>): ExtractedTrade[] => {
    return rawTrades.map((t) => {
      // Normalize all numeric fields first
      const entryNorm = normPrice(t.entryPrice);
      const exitNorm = normPrice(t.exitPrice);
      const pnlNorm = normPrice(t.pnl);
      const qtyNorm = (() => {
        const n = parseFloat(t.quantity);
        return isNaN(n) ? t.quantity : n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2);
      })();

      // Get live price for this symbol (from Finnhub quotes) to anchor magnitude correction
      const livePrice = liveQuotes?.[t.symbol.toUpperCase()];
      const entryText = String(t.entryPrice ?? "").trim().toLowerCase();
      const marketEntry = ["", "null", "market", "market price", "current", "current price"].includes(entryText);

      // Sanity-check the entry price itself against live market price
      // e.g. user says "Apple at 253", AI extracts "2.53" → correct to "253.00"
      const entrySane = livePrice && marketEntry ? livePrice.toFixed(2) : livePrice ? sanitizePrice(entryNorm, parseFloat(entryNorm), livePrice) : entryNorm;
      const entry = parseFloat(entrySane);
      const isShort = t.side === "short" || t.side === "cover";

      // Apply magnitude sanity correction to exit, TP, SL relative to (corrected) entry
      const exitSane = exitNorm ? sanitizePrice(exitNorm, entry, livePrice) : "";
      const rawTp = normPrice(t.takeProfit);
      const rawTp2 = normPrice(t.takeProfit2);
      const rawSl = normPrice(t.stopLoss);
      const tpSane = rawTp ? sanitizePrice(rawTp, entry, livePrice) : "";
      const tp2Sane = rawTp2 ? sanitizePrice(rawTp2, entry, livePrice) : "";
      const slSane = rawSl ? sanitizePrice(rawSl, entry, livePrice) : "";

      // Recalculate PnL using corrected prices
      const correctedPnl = (() => {
        if (!exitSane) return pnlNorm;
        const qty = parseFloat(qtyNorm);
        const ex = parseFloat(exitSane);
        if (isNaN(qty) || isNaN(entry) || isNaN(ex)) return pnlNorm;
        const mult = isShort ? -1 : 1;
        return (mult * qty * (ex - entry)).toFixed(2);
      })();

      // Default TP/SL if not provided: TP1 at 2R and TP2 at 3R using a 2% stop.
      let tpNorm = tpSane || (isNaN(entry) ? "" : (isShort ? (entry * 0.97).toFixed(2) : (entry * 1.03).toFixed(2)));
      let tp2Norm = tp2Sane || (isNaN(entry) ? "" : (isShort ? (entry * 0.94).toFixed(2) : (entry * 1.06).toFixed(2)));
      let slNorm = slSane || (isNaN(entry) ? "" : (isShort ? (entry * 1.02).toFixed(2) : (entry * 0.98).toFixed(2)));

      // ─── Enforce minimum 2:1 TP/SL ratio ─────────────────────────────────────
      // TP distance must be >= 2x SL distance from entry.
      // If not, extend TP to exactly 2x SL distance.
      if (!isNaN(entry) && tpNorm && slNorm) {
        const tp = parseFloat(tpNorm);
        const sl = parseFloat(slNorm);
        if (!isNaN(tp) && !isNaN(sl)) {
          const slDist = Math.abs(entry - sl);
          const tpDist = Math.abs(tp - entry);
          if (slDist > 0 && tpDist < 2 * slDist) {
            // Extend TP to 2x SL distance
            const correctedTp = isShort
              ? (entry - 2 * slDist).toFixed(2)
              : (entry + 2 * slDist).toFixed(2);
            tpNorm = correctedTp;
          }
          const tp2 = parseFloat(tp2Norm);
          const tp2Dist = Math.abs(tp2 - entry);
          if (!isNaN(tp2) && slDist > 0 && tp2Dist < 3 * slDist) {
            tp2Norm = isShort
              ? (entry - 3 * slDist).toFixed(2)
              : (entry + 3 * slDist).toFixed(2);
          }
        }
      }

      return {
        ...t,
        quantity: qtyNorm,
        entryPrice: entrySane,
        exitPrice: exitSane || undefined,
        pnl: correctedPnl || undefined,
        takeProfit: tpNorm || undefined,
        takeProfit2: tp2Norm || undefined,
        stopLoss: slNorm || undefined,
        notes: (!t.notes || t.notes === "null" || t.notes === "undefined") ? undefined : t.notes,
      };
    });
  };

  const recalcPnl = (trade: ExtractedTrade, overrides: Partial<ExtractedTrade> = {}): string => {
    const t = { ...trade, ...overrides };
    const qty = parseFloat(t.quantity);
    const entry = parseFloat(t.entryPrice);
    const exit = parseFloat(t.exitPrice ?? "");
    if (!isNaN(qty) && !isNaN(entry) && !isNaN(exit) && qty > 0) {
      const isShort = t.side === "short" || t.side === "cover";
      const calc = isShort ? (entry - exit) * qty : (exit - entry) * qty;
      return calc.toFixed(2);
    }
    return t.pnl ?? "";
  };

  const updateTrade = (index: number, field: keyof ExtractedTrade, value: string) => {
    setExtractedTrades((prev) => prev.map((t, i) => {
      if (i !== index) return t;
      const updated = { ...t, [field]: value };
      // Auto-recalculate PnL when price or qty fields change
      if (["exitPrice", "entryPrice", "quantity"].includes(field)) {
        const newPnl = recalcPnl(t, { [field]: value });
        if (newPnl !== "") updated.pnl = newPnl;
      }
      return updated;
    }));
  };

  const removeTrade = (index: number) => {
    setExtractedTrades((prev) => prev.filter((_, i) => i !== index));
  };

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const moodEmojis = ["😡", "😢", "😨", "😰", "😟", "😐", "🙂", "😄"];
  const moodLabels = ["Mad", "Upset", "Afraid", "Anxious", "Nervous", "Neutral", "Confident", "Excellent"];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Record Session</h1>
          <p className="text-sm text-muted-foreground">Capture your trading session with voice or text</p>
        </div>

        {/* Session Title */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Session Title (optional)</label>
          <Input
            value={sessionTitle}
            onChange={(e) => setSessionTitle(e.target.value)}
            placeholder={`Session ${new Date().toLocaleDateString()}`}
            className="bg-card border-border"
          />
        </div>

        {/* Voice Recorder */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Mic className="h-4 w-4 text-primary" /> Voice Recording
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col items-center gap-4 py-4">
              {/* Recording button */}
              <div className="relative">
                {state === "recording" && (
                  <div className="absolute inset-0 rounded-full bg-destructive/30 recording-ring" />
                )}
                <button
                  onClick={state === "recording" ? stopRecording : startRecording}
                  disabled={state === "transcribing" || state === "extracting" || state === "reviewing"}
                  className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                    state === "recording"
                      ? "bg-destructive hover:bg-destructive/90"
                      : "bg-primary hover:bg-primary/90"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {state === "recording" ? (
                    <Square className="h-8 w-8 text-white" />
                  ) : (
                    <Mic className="h-8 w-8 text-primary-foreground" />
                  )}
                </button>
              </div>

              {state === "recording" && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-destructive live-dot" />
                  <span className="text-sm font-mono text-destructive">{formatTime(recordingTime)}</span>
                </div>
              )}

              {state === "stopped" && audioUrl && (
                <div className="flex flex-col items-center gap-2">
                  <audio src={audioUrl} controls className="h-8 max-w-xs" />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    Processing your recording...
                  </div>
                  <Button size="sm" variant="ghost" onClick={handleTranscribe} className="text-xs text-muted-foreground h-6">
                    Retry transcription
                  </Button>
                </div>
              )}

              {(state === "transcribing" || state === "extracting") && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {state === "transcribing" ? "Transcribing audio..." : "Extracting trades with AI..."}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Manual Transcript */}
        {state !== "reviewing" && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Or Type Your Session Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Describe your trades... e.g. 'Bought 100 shares of AAPL at $150, sold at $155 for a $500 gain. Also shorted SPY at 480, still open.'"
                className="bg-input border-border min-h-32 text-sm resize-none"
                disabled={state === "extracting"}
              />
              {state !== "extracting" && (
                <Button
                  onClick={handleManualTranscript}
                  disabled={!transcript.trim()}
                  className="bg-primary text-primary-foreground"
                >
                  <><Sparkles className="h-4 w-4 mr-2" /> Extract Trades with AI</>
                </Button>
              )}
              {state === "extracting" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Extracting trades with AI...
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Extracted Trades Review */}
        {state === "reviewing" && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                Review Extracted Trades ({extractedTrades.length})
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => setExtractedTrades([])} className="h-7 text-xs border-border">
                Clear All
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {extractedTrades.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No trades extracted. You can still save the session without trades.
                </p>
              ) : (
                extractedTrades.map((trade, i) => (
                  <div key={i} className="p-4 rounded-lg border border-border bg-secondary/30 space-y-3">
                    {/* Trade header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`text-xs ${trade.side === "buy" || trade.side === "cover" ? "border-[oklch(0.65_0.18_160)] text-[oklch(0.65_0.18_160)]" : "border-destructive text-destructive"}`}>
                          {trade.side.toUpperCase()}
                        </Badge>
                        <span className="font-mono font-bold text-foreground">{trade.symbol}</span>
                        <Badge variant="outline" className={`text-xs ${trade.status === "open" ? "border-yellow-500 text-yellow-500" : "border-muted-foreground text-muted-foreground"}`}>
                          {trade.status}
                        </Badge>
                        {trade.pnl && (
                          <span className={`text-sm font-bold ${parseFloat(trade.pnl) >= 0 ? "text-[oklch(0.65_0.18_160)]" : "text-destructive"}`}>
                            {parseFloat(trade.pnl) >= 0 ? "+" : ""}${parseFloat(trade.pnl).toFixed(2)}
                          </span>
                        )}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => removeTrade(i)} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Row 1: Qty, Entry, Exit */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Qty</label>
                        <Input value={trade.quantity} onChange={(e) => updateTrade(i, "quantity", e.target.value)} className="h-7 text-xs bg-input border-border mt-0.5" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Entry Price</label>
                        <Input value={trade.entryPrice} onChange={(e) => updateTrade(i, "entryPrice", e.target.value)} className="h-7 text-xs bg-input border-border mt-0.5" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Exit Price</label>
                        <Input value={trade.exitPrice ?? ""} onChange={(e) => updateTrade(i, "exitPrice", e.target.value)} className="h-7 text-xs bg-input border-border mt-0.5" placeholder="—" />
                      </div>
                    </div>

                    {/* Row 2: TP1, TP2, Stop Loss, P&L */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div>
                        <label className="text-xs text-[oklch(0.65_0.18_160)]">TP1</label>
                        <Input
                          value={trade.takeProfit ?? ""}
                          onChange={(e) => updateTrade(i, "takeProfit", e.target.value)}
                          className="h-7 text-xs bg-input border-[oklch(0.65_0.18_160)]/40 mt-0.5 focus-visible:ring-[oklch(0.65_0.18_160)]/50"
                          placeholder={(() => {
                            const entry = parseFloat(trade.entryPrice);
                            if (isNaN(entry)) return "e.g. 158.00";
                            const isShort = trade.side === "short" || trade.side === "cover";
                            return isShort ? (entry * 0.97).toFixed(2) : (entry * 1.03).toFixed(2);
                          })()}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[oklch(0.72_0.16_190)]">TP2</label>
                        <Input
                          value={trade.takeProfit2 ?? ""}
                          onChange={(e) => updateTrade(i, "takeProfit2", e.target.value)}
                          className="h-7 text-xs bg-input border-[oklch(0.72_0.16_190)]/40 mt-0.5 focus-visible:ring-[oklch(0.72_0.16_190)]/50"
                          placeholder={(() => {
                            const entry = parseFloat(trade.entryPrice);
                            if (isNaN(entry)) return "e.g. 162.00";
                            const isShort = trade.side === "short" || trade.side === "cover";
                            return isShort ? (entry * 0.94).toFixed(2) : (entry * 1.06).toFixed(2);
                          })()}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-destructive">Stop Loss</label>
                        <Input
                          value={trade.stopLoss ?? ""}
                          onChange={(e) => updateTrade(i, "stopLoss", e.target.value)}
                          className="h-7 text-xs bg-input border-destructive/40 mt-0.5 focus-visible:ring-destructive/50"
                          placeholder={(() => {
                            const entry = parseFloat(trade.entryPrice);
                            if (isNaN(entry)) return "e.g. 148.00";
                            const isShort = trade.side === "short" || trade.side === "cover";
                            return isShort ? (entry * 1.02).toFixed(2) : (entry * 0.98).toFixed(2);
                          })()}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">P&amp;L Override</label>
                        <Input
                          value={trade.pnl ?? ""}
                          onChange={(e) => updateTrade(i, "pnl", e.target.value)}
                          className="h-7 text-xs bg-input border-border mt-0.5"
                          placeholder="auto-calc"
                        />
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="text-xs text-muted-foreground">Trade Notes</label>
                      <Input
                        value={trade.notes ?? ""}
                        onChange={(e) => updateTrade(i, "notes", e.target.value)}
                        className="h-7 text-xs bg-input border-border mt-0.5"
                        placeholder="Any notes about this trade..."
                      />
                    </div>
                  </div>
                ))
              )}

              {/* Emotional State — pre-filled from recording, shown in review */}
              <div className="pt-2 border-t border-border space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-2">How were you feeling during this session?</label>
                  {/* Quick mood picker */}
                  <div className="flex gap-2 mb-2">
                    {moodEmojis.map((emoji, idx) => (
                      <button
                        key={idx}
                        onClick={() => setEmotionalNote(moodLabels[idx])}
                        className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg border transition-all text-xs ${
                          emotionalNote === moodLabels[idx]
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        <span className="text-lg">{emoji}</span>
                        <span>{moodLabels[idx]}</span>
                      </button>
                    ))}
                  </div>
                  <Input
                    value={emotionalNote}
                    onChange={(e) => setEmotionalNote(e.target.value)}
                    placeholder="Or describe in your own words: focused, revenge trading, FOMO..."
                    className="bg-input border-border text-sm"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setState("idle")} className="border-border">
                  <MicOff className="h-4 w-4 mr-2" /> Start Over
                </Button>
                <Button
                  onClick={handleSaveSession}
                  disabled={createTrade.isPending || generateSummary.isPending}
                  className="flex-1 bg-primary text-primary-foreground"
                >
                  {createTrade.isPending || generateSummary.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    <><Save className="h-4 w-4 mr-2" /> Save Session & Get AI Feedback</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
