import { useState } from "react";
import { X, FileText, Calendar } from "lucide-react";
import { REPORT_PERIODS, getPeriodRange, generateTradeReportPDF } from "../utils/tradeReport";
import { useAuth } from "../hooks/useAuth";

// Quick presets + an explicit custom range, same pattern broker statement
// generators and journals (MyFxBook, TradeZella) use -- asked for
// explicitly rather than only offering fixed periods.
function ReportModal({ open, onClose }) {
  const { headers } = useAuth();
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  const run = async (from, to, label) => {
    setError(null);
    setGenerating(true);
    try {
      await generateTradeReportPDF(headers, { from, to, label });
      onClose();
    } catch (err) {
      console.error("Report generation failed:", err);
      setError("Couldn't generate the report — please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const runPreset = (periodId) => {
    const period = REPORT_PERIODS.find((p) => p.id === periodId);
    const { from, to } = getPeriodRange(periodId);
    run(from, to, `${period.label}ly`);
  };

  const runCustom = () => {
    if (!customFrom || !customTo) {
      setError("Pick both a start and end date.");
      return;
    }
    const from = new Date(customFrom);
    const to = new Date(customTo);
    to.setHours(23, 59, 59, 999);
    if (from > to) {
      setError("Start date must be before end date.");
      return;
    }
    run(from, to, `${customFrom} to ${customTo}`);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[999] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <p className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
            <FileText size={16} /> Generate PDF Report
          </p>
          <button onClick={onClose} aria-label="Close" className="p-2 -m-2 text-slate-400 hover:text-slate-900 dark:hover:text-white transition">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Which report do you need?</p>
            <div className="grid grid-cols-4 gap-2">
              {REPORT_PERIODS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => runPreset(p.id)}
                  disabled={generating}
                  className="px-2 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-green-500/50 hover:text-green-600 dark:hover:text-green-400 disabled:opacity-50 transition"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
              <Calendar size={12} /> Or pick a custom range
            </p>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:border-green-500 transition"
              />
              <span className="text-slate-400 dark:text-slate-500 text-sm">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:border-green-500 transition"
              />
            </div>
            <button
              onClick={runCustom}
              disabled={generating}
              className="w-full mt-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-2"
            >
              {generating ? (
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                "Generate for this range"
              )}
            </button>
          </div>

          {generating && (
            <p className="text-xs text-center text-slate-400 dark:text-slate-500">
              Generating report — fetching trade screenshots, this can take a moment…
            </p>
          )}
          {error && (
            <div className="text-sm rounded-xl p-3 bg-red-500/10 text-red-400 border border-red-500/20">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReportModal;
