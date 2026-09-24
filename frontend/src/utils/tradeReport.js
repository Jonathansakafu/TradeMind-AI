import axios from "axios";
import jsPDF from "jspdf";
import { API_URL } from "../config/api";
import { downloadBinaryFile } from "./nativeDownload";

// Quick presets, calendar-based (this week since Monday, this calendar
// month/year) rather than a rolling window -- matches how a trader
// normally thinks about "my report for this month." A custom range is
// offered alongside these in the UI, same pattern as broker statement
// generators and journals like MyFxBook/TradeZella (quick presets +
// explicit date range), per the user's request.
export const REPORT_PERIODS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

export function getPeriodRange(period) {
  const now = new Date();
  let from;
  if (period === "day") {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === "week") {
    const day = now.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  } else if (period === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    from = new Date(now.getFullYear(), 0, 1);
  }
  return { from, to: now };
}

// Cloudinary serves public delivery URLs with permissive CORS, so drawing
// onto a canvas and reading it back out doesn't taint it -- converting to
// PNG this way (rather than trying to embed the original bytes directly)
// sidesteps jsPDF needing to know/guess the source format at all.
function loadImageAsPngDataURL(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve({
        dataURL: canvas.toDataURL("image/png"),
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

const money = (n) => `${n >= 0 ? "+" : ""}$${Number(n).toFixed(2)}`;

// Standard performance metrics used by trading journals/broker statement
// reports (profit factor, expectancy, avg win/loss, max drawdown,
// consecutive streaks) -- researched 2026-09-24 against how established
// platforms (TradeZella, JournalPlus, LuxAlgo) structure this, at the
// user's explicit request for "good" report content, not just a trade
// list with a period filter.
function computeStats(closed) {
  const wins = closed.filter((t) => t.outcome === "win");
  const losses = closed.filter((t) => t.outcome === "loss");
  const breakeven = closed.filter((t) => t.outcome === "breakeven");
  const totalPL = closed.reduce((sum, t) => sum + (Number(t.profitLoss) || 0), 0);
  const grossProfit = wins.reduce((sum, t) => sum + Number(t.profitLoss), 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + Number(t.profitLoss), 0));
  const winRate = closed.length ? wins.length / closed.length : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  // Gross profit / gross loss -- undefined when there are no losses at all
  // (can't divide by zero), shown as "∞" rather than a misleading number.
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : wins.length ? Infinity : 0;
  // (WinRate × AvgWin) - (LossRate × AvgLoss): the expected $ per trade --
  // the single number that actually says whether the system has an edge,
  // independent of win rate alone.
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

  let peak = 0, running = 0, maxDrawdown = 0;
  const equityCurve = [{ x: 0, y: 0 }];
  let curWinStreak = 0, curLossStreak = 0, maxWinStreak = 0, maxLossStreak = 0;
  closed.forEach((t, i) => {
    running += Number(t.profitLoss) || 0;
    equityCurve.push({ x: i + 1, y: running });
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
    if (t.outcome === "win") { curWinStreak++; curLossStreak = 0; }
    else if (t.outcome === "loss") { curLossStreak++; curWinStreak = 0; }
    else { curWinStreak = 0; curLossStreak = 0; }
    maxWinStreak = Math.max(maxWinStreak, curWinStreak);
    maxLossStreak = Math.max(maxLossStreak, curLossStreak);
  });

  const best = closed.length
    ? closed.reduce((a, b) => (Number(b.profitLoss) > Number(a.profitLoss) ? b : a))
    : null;
  const worst = closed.length
    ? closed.reduce((a, b) => (Number(b.profitLoss) < Number(a.profitLoss) ? b : a))
    : null;

  return {
    wins: wins.length, losses: losses.length, breakeven: breakeven.length,
    totalPL, winRate, avgWin, avgLoss, profitFactor, expectancy,
    maxDrawdown, maxWinStreak, maxLossStreak, equityCurve, best, worst,
  };
}

function perPairBreakdown(closed) {
  const byPair = {};
  closed.forEach((t) => {
    byPair[t.pair] ||= { pair: t.pair, trades: 0, wins: 0, pl: 0 };
    byPair[t.pair].trades++;
    if (t.outcome === "win") byPair[t.pair].wins++;
    byPair[t.pair].pl += Number(t.profitLoss) || 0;
  });
  return Object.values(byPair).sort((a, b) => b.pl - a.pl);
}

// Drawn with jsPDF's own line primitives rather than a charting library --
// this is one polyline plus a zero-reference line, well within what's
// reasonable to hand-roll and avoids pulling in a whole chart dependency
// for a single sparkline-style curve.
function drawEquityCurve(doc, curve, x, y, width, height) {
  const values = curve.map((p) => p.y);
  const minY = Math.min(0, ...values);
  const maxY = Math.max(0, ...values);
  const range = maxY - minY || 1;
  const toX = (i) => x + (i / Math.max(1, curve.length - 1)) * width;
  const toY = (v) => y + height - ((v - minY) / range) * height;

  doc.setDrawColor(226, 232, 240);
  doc.rect(x, y, width, height);
  const zeroY = toY(0);
  doc.setDrawColor(203, 213, 225);
  doc.line(x, zeroY, x + width, zeroY);

  doc.setDrawColor(34, 197, 94);
  doc.setLineWidth(1.2);
  for (let i = 1; i < curve.length; i++) {
    doc.line(toX(i - 1), toY(curve[i - 1].y), toX(i), toY(curve[i].y));
  }
  doc.setLineWidth(0.5);
  doc.setDrawColor(0);

  doc.setFontSize(8).setTextColor(100);
  doc.text(money(maxY), x + 2, y + 9);
  doc.text(money(minY), x + 2, y + height - 3);
  doc.setTextColor(0);
}

export async function generateTradeReportPDF(headers, { from, to, label }) {
  const res = await axios.get(`${API_URL}/api/trades`, {
    headers,
    params: { from: from.toISOString(), to: to.toISOString(), limit: 5000 },
  });
  const trades = (res.data.trades || []).sort(
    (a, b) => new Date(a.openedAt) - new Date(b.openedAt)
  );
  const closed = trades.filter((t) => t.outcome);
  const stats = computeStats(closed);
  const pairStats = perPairBreakdown(closed);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Header
  doc.setFontSize(20).setFont(undefined, "bold");
  doc.text(`TradeMind AI — ${label} Report`, margin, y);
  y += 22;
  doc.setFontSize(10).setFont(undefined, "normal").setTextColor(100);
  doc.text(
    `${from.toLocaleDateString()} – ${to.toLocaleDateString()} · Generated ${new Date().toLocaleString()}`,
    margin, y
  );
  doc.setTextColor(0);
  y += 28;

  // Summary metrics
  doc.setFontSize(13).setFont(undefined, "bold");
  doc.text("Summary", margin, y);
  y += 18;
  doc.setFontSize(10).setFont(undefined, "normal");
  const pfText = stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2);
  const summaryLines = [
    `Total trades: ${trades.length}  (${closed.length} closed, ${trades.length - closed.length} open)`,
    `Wins: ${stats.wins}  ·  Losses: ${stats.losses}  ·  Breakeven: ${stats.breakeven}  ·  Win rate: ${(stats.winRate * 100).toFixed(1)}%`,
    `Total P&L: ${money(stats.totalPL)}  ·  Profit factor: ${pfText}  ·  Expectancy/trade: ${money(stats.expectancy)}`,
    `Avg win: ${money(stats.avgWin)}  ·  Avg loss: ${money(-stats.avgLoss)}  ·  Max drawdown: ${money(-stats.maxDrawdown)}`,
    `Longest win streak: ${stats.maxWinStreak}  ·  Longest loss streak: ${stats.maxLossStreak}`,
    stats.best ? `Best trade: ${stats.best.pair} ${money(Number(stats.best.profitLoss))} on ${new Date(stats.best.openedAt).toLocaleDateString()}` : null,
    stats.worst ? `Worst trade: ${stats.worst.pair} ${money(Number(stats.worst.profitLoss))} on ${new Date(stats.worst.openedAt).toLocaleDateString()}` : null,
  ].filter(Boolean);
  summaryLines.forEach((line) => {
    doc.text(line, margin, y);
    y += 15;
  });
  y += 10;

  // Equity curve
  if (closed.length > 1) {
    ensureSpace(140);
    doc.setFontSize(12).setFont(undefined, "bold");
    doc.text("Equity Curve", margin, y);
    y += 12;
    drawEquityCurve(doc, stats.equityCurve, margin, y, contentWidth, 100);
    y += 116;
  }

  // Per-pair breakdown
  if (pairStats.length > 0) {
    ensureSpace(24 + pairStats.length * 14);
    doc.setFontSize(12).setFont(undefined, "bold");
    doc.text("By Pair", margin, y);
    y += 16;
    doc.setFontSize(9).setFont(undefined, "bold").setTextColor(100);
    doc.text("Pair", margin, y);
    doc.text("Trades", margin + 120, y);
    doc.text("Win rate", margin + 190, y);
    doc.text("P&L", margin + 270, y);
    doc.setTextColor(0);
    y += 12;
    doc.setFont(undefined, "normal");
    pairStats.forEach((p) => {
      ensureSpace(14);
      doc.text(p.pair, margin, y);
      doc.text(String(p.trades), margin + 120, y);
      doc.text(`${((p.wins / p.trades) * 100).toFixed(0)}%`, margin + 190, y);
      doc.setTextColor(p.pl >= 0 ? [22, 163, 74] : [220, 38, 38]);
      doc.text(money(p.pl), margin + 270, y);
      doc.setTextColor(0);
      y += 14;
    });
    y += 12;
  }

  if (trades.length === 0) {
    doc.setFontSize(11);
    doc.text("No trades in this period.", margin, y);
  } else {
    ensureSpace(24);
    doc.setFontSize(13).setFont(undefined, "bold");
    doc.text("Trades", margin, y);
    y += 8;
  }

  // Per-trade sections, each with its screenshot -- the reason this had to
  // be a PDF and not a spreadsheet.
  for (const trade of trades) {
    ensureSpace(110);
    doc.setDrawColor(220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 18;

    doc.setFontSize(12).setFont(undefined, "bold");
    const outcomeText = trade.outcome ? trade.outcome.toUpperCase() : "OPEN";
    doc.text(`${trade.pair}  ${trade.direction?.toUpperCase()}  —  ${outcomeText}`, margin, y);
    doc.setFontSize(9).setFont(undefined, "normal").setTextColor(100);
    doc.text(new Date(trade.openedAt).toLocaleString(), pageWidth - margin, y, { align: "right" });
    doc.setTextColor(0);
    y += 16;

    doc.setFontSize(10);
    doc.text(
      `Entry: ${trade.entryPrice ?? "—"}   SL: ${trade.stopLoss ?? "—"}   TP: ${trade.takeProfit ?? "—"}   Exit: ${trade.exitPrice ?? "—"}`,
      margin, y
    );
    y += 14;
    if (trade.outcome) {
      doc.setTextColor(Number(trade.profitLoss) >= 0 ? [22, 163, 74] : [220, 38, 38]);
      doc.text(`P&L: ${money(Number(trade.profitLoss) || 0)}`, margin, y);
      doc.setTextColor(0);
      y += 14;
    }
    if (trade.setup) {
      doc.text(`Setup: ${trade.setup}`, margin, y);
      y += 14;
    }
    y += 4;

    // Failures here (a wiped/missing image, a network blip) are caught per
    // trade so one bad image doesn't abort the entire report.
    if (trade.screenshot?.url) {
      try {
        const { dataURL, width, height } = await loadImageAsPngDataURL(trade.screenshot.url);
        const maxImgWidth = contentWidth * 0.7;
        const scale = Math.min(maxImgWidth / width, 1);
        const imgWidth = width * scale;
        const imgHeight = height * scale;
        ensureSpace(imgHeight + 10);
        doc.addImage(dataURL, "PNG", margin, y, imgWidth, imgHeight);
        y += imgHeight + 16;
      } catch {
        doc.setFontSize(9).setTextColor(150);
        doc.text("(Screenshot unavailable)", margin, y);
        doc.setTextColor(0);
        y += 16;
      }
    } else {
      doc.setFontSize(9).setTextColor(150);
      doc.text("(No screenshot attached)", margin, y);
      doc.setTextColor(0);
      y += 16;
    }
    y += 10;
  }

  const base64 = doc.output("datauristring").split(",")[1];
  const filename = `trademind-${label.toLowerCase().replace(/\s+/g, "-")}-report-${to.toISOString().slice(0, 10)}.pdf`;
  await downloadBinaryFile(filename, base64, "application/pdf");
}
