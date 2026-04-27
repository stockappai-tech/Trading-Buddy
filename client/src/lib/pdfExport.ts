import jsPDF from "jspdf";

type Trade = {
  symbol: string;
  side: string;
  quantity: string;
  entryPrice: string;
  exitPrice?: string | null;
  pnl?: string | null;
  status: string;
  notes?: string | null;
  tradeDate: Date | string;
};

type Session = {
  title?: string | null;
  transcript?: string | null;
  coachFeedback?: string | null;
  emotionalNote?: string | null;
  createdAt: Date | string;
};

export function exportSessionPdf(session: Session, trades: Trade[]) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  // Header
  doc.setFillColor(20, 30, 48);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Trading Buddy AI", margin, 12);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Session Report", margin, 20);
  doc.setFontSize(9);
  doc.text(new Date(session.createdAt).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }), pageW - margin, 20, { align: "right" });

  y = 38;

  // Session Title
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(session.title ?? "Trading Session", margin, y);
  y += 8;

  // Emotional Note
  if (session.emotionalNote) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100, 100, 100);
    doc.text(`Emotional State: ${session.emotionalNote}`, margin, y);
    y += 7;
  }

  // Divider
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // Trade Summary
  const closed = trades.filter((t) => t.status === "closed");
  const totalPnl = closed.reduce((s, t) => s + parseFloat(t.pnl ?? "0"), 0);
  const wins = closed.filter((t) => parseFloat(t.pnl ?? "0") > 0);
  const winRate = closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(1) : "0";

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  doc.text("Performance Summary", margin, y);
  y += 7;

  const summaryItems = [
    ["Total P&L", `${totalPnl >= 0 ? "+" : ""}$${Math.abs(totalPnl).toFixed(2)}`],
    ["Total Trades", String(trades.length)],
    ["Win Rate", `${winRate}%`],
    ["Wins / Losses", `${wins.length} / ${closed.length - wins.length}`],
  ];

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  summaryItems.forEach(([label, value], i) => {
    const x = margin + (i % 2) * (contentW / 2);
    if (i % 2 === 0 && i > 0) y += 6;
    doc.setTextColor(100, 100, 100);
    doc.text(label + ":", x, y);
    doc.setTextColor(30, 30, 30);
    doc.setFont("helvetica", "bold");
    if (label === "Total P&L") {
      doc.setTextColor(totalPnl >= 0 ? 22 : 220, totalPnl >= 0 ? 163 : 38, totalPnl >= 0 ? 74 : 38);
    }
    doc.text(value, x + 30, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
  });
  y += 10;

  // Divider
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // Trades Table
  if (trades.length > 0) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 30);
    doc.text("Trade Log", margin, y);
    y += 7;

    // Table header
    const cols = ["Symbol", "Side", "Qty", "Entry", "Exit", "P&L", "Status"];
    const colW = [25, 18, 18, 22, 22, 22, 18];
    let x = margin;
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y - 4, contentW, 7, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    cols.forEach((col, i) => {
      doc.text(col, x + 1, y);
      x += colW[i];
    });
    y += 5;

    // Table rows
    doc.setFont("helvetica", "normal");
    trades.forEach((trade, idx) => {
      if (y > 270) { doc.addPage(); y = margin; }
      if (idx % 2 === 0) {
        doc.setFillColor(250, 250, 250);
        doc.rect(margin, y - 3.5, contentW, 6, "F");
      }
      const pnl = parseFloat(trade.pnl ?? "0");
      x = margin;
      const row = [
        trade.symbol,
        trade.side.toUpperCase(),
        trade.quantity,
        `$${parseFloat(trade.entryPrice).toFixed(2)}`,
        trade.exitPrice ? `$${parseFloat(trade.exitPrice).toFixed(2)}` : "—",
        trade.status === "closed" ? `${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}` : "—",
        trade.status,
      ];
      row.forEach((cell, i) => {
        if (i === 5 && trade.status === "closed") {
          doc.setTextColor(pnl >= 0 ? 22 : 220, pnl >= 0 ? 163 : 38, pnl >= 0 ? 74 : 38);
        } else {
          doc.setTextColor(30, 30, 30);
        }
        doc.setFontSize(8);
        doc.text(cell, x + 1, y);
        x += colW[i];
      });
      y += 6;
    });
    y += 4;
  }

  // Transcript
  if (session.transcript) {
    if (y > 240) { doc.addPage(); y = margin; }
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageW - margin, y);
    y += 6;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 30);
    doc.text("Session Transcript", margin, y);
    y += 7;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(session.transcript, contentW);
    lines.slice(0, 40).forEach((line: string) => {
      if (y > 270) { doc.addPage(); y = margin; }
      doc.text(line, margin, y);
      y += 4.5;
    });
    if (lines.length > 40) {
      doc.setTextColor(150, 150, 150);
      doc.text("... [transcript truncated]", margin, y);
      y += 5;
    }
    y += 4;
  }

  // Coach Feedback
  if (session.coachFeedback) {
    if (y > 240) { doc.addPage(); y = margin; }
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageW - margin, y);
    y += 6;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 30);
    doc.text("AI Coach Feedback", margin, y);
    y += 7;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    const feedbackLines = doc.splitTextToSize(session.coachFeedback, contentW);
    feedbackLines.slice(0, 50).forEach((line: string) => {
      if (y > 270) { doc.addPage(); y = margin; }
      doc.text(line, margin, y);
      y += 4.5;
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`Trading Buddy AI · Generated ${new Date().toLocaleString()} · Page ${i}/${pageCount}`, pageW / 2, 290, { align: "center" });
  }

  doc.save(`session-${new Date().toISOString().split("T")[0]}.pdf`);
}
