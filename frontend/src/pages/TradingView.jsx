import { useState } from "react";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import { LineChart, Copy, Check, Info, RefreshCw, Bell } from "lucide-react";
import { Clipboard } from "@capacitor/clipboard";
import { API_URL } from "../config/api";
import { useAuth } from "../hooks/useAuth";
import { useResource } from "../hooks/useResource";
import { fetchTradingViewInfo } from "../api/resources";

// Hoisted out of TradingView so it isn't redefined on every render —
// takes copiedField/onCopy as props instead of closing over component state.
function CopyField({ value, field, copiedField, onCopy }) {
  return (
    <div className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex items-start justify-between gap-2">
      <pre className="text-green-600 dark:text-green-400 text-xs font-mono whitespace-pre-wrap break-all">
        {value}
      </pre>
      <button
        onClick={() => onCopy(value, field)}
        aria-label="Copy"
        className="p-2 -m-1 text-slate-400 dark:text-slate-500 hover:text-green-600 dark:hover:text-green-400 transition flex-shrink-0"
      >
        {copiedField === field ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

// This data only ever changes when the user explicitly regenerates their
// token (handled via refetch below, not this interval) -- a long poll
// just guards against the value going stale if left open for a very long
// session.
const TRADINGVIEW_INFO_POLL_MS = 24 * 60 * 60 * 1000;

function TradingView() {
  const { headers } = useAuth();
  const { data: info, isLoading: loading, refetch } = useResource(
    "tradingview-info",
    () => fetchTradingViewInfo(headers),
    TRADINGVIEW_INFO_POLL_MS
  );
  const [regenerating, setRegenerating] = useState(false);
  const [copiedField, setCopiedField] = useState(null);

  const regenerateToken = async () => {
    if (!confirm("This invalidates your current token — any TradingView alert still using the old one will stop working until you update it. Continue?")) return;
    setRegenerating(true);
    try {
      await axios.post(`${API_URL}/api/tradingview/regenerate`, {}, { headers });
      await refetch();
    } finally {
      setRegenerating(false);
    }
  };

  const copyToClipboard = (text, field) => {
    Clipboard.write({ string: text });
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const strategyTemplate = info
    ? `{
  "token": "${info.token}",
  "pair": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "entry": {{close}},
  "reasoning": "TradingView strategy alert, {{interval}}"
}`
    : "";

  const manualBuyTemplate = info
    ? `{
  "token": "${info.token}",
  "pair": "{{ticker}}",
  "action": "buy",
  "entry": {{close}}
}`
    : "";

  const manualSellTemplate = info
    ? `{
  "token": "${info.token}",
  "pair": "{{ticker}}",
  "action": "sell",
  "entry": {{close}}
}`
    : "";

  return (
    <MainLayout>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
          <LineChart size={20} className="text-green-500" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">TradingView Alerts</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Feed your own TradingView alerts into TradeMind as another signal source
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !info ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-sm text-slate-500 dark:text-slate-400">
          Couldn't load your webhook info. <button onClick={refetch} className="text-green-600 dark:text-green-400 underline">Try again</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            {/* Step 1 */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-slate-950 font-bold text-sm flex-shrink-0">1</div>
                <h3 className="font-bold text-slate-900 dark:text-white">Your webhook URL</h3>
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-3">
                Paste this into TradingView's alert setup, under "Notifications → Webhook URL"
              </p>
              <CopyField value={info.webhookUrl} field="url" copiedField={copiedField} onCopy={copyToClipboard} />
            </div>

            {/* Step 2 */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-slate-950 font-bold text-sm flex-shrink-0">2</div>
                  <h3 className="font-bold text-slate-900 dark:text-white">Your token</h3>
                </div>
                <button
                  onClick={regenerateToken}
                  disabled={regenerating}
                  className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-red-500 transition disabled:opacity-50"
                >
                  <RefreshCw size={12} className={regenerating ? "animate-spin" : ""} />
                  Regenerate
                </button>
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-3">
                Identifies you on incoming alerts — TradingView doesn't send any login info of its own, so this goes inside the alert's own message body (see the templates below).
              </p>
              <CopyField value={info.token} field="token" copiedField={copiedField} onCopy={copyToClipboard} />
            </div>

            <div className="flex items-start gap-2 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
              <Info size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                An alert fires → it lands in your Notifications feed as a regular signal, tagged "TradingView Alert" → you review and act on it yourself, same as any other signal. It is <span className="text-slate-900 dark:text-white">not</span> auto-sent to MT5 — that stays a manual step, since this comes from outside the app's own AI verification.
              </p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Step 3 */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-slate-950 font-bold text-sm flex-shrink-0">3</div>
                <h3 className="font-bold text-slate-900 dark:text-white">Alert message template</h3>
              </div>

              <p className="text-slate-500 dark:text-slate-400 text-sm mb-2">
                If your alert comes from a Pine <span className="text-slate-900 dark:text-white">strategy</span> (not a plain indicator), one alert covers both directions:
              </p>
              <div className="mb-4">
                <CopyField value={strategyTemplate} field="strategyTemplate" copiedField={copiedField} onCopy={copyToClipboard} />
              </div>

              <p className="text-slate-500 dark:text-slate-400 text-sm mb-2">
                For a plain indicator alert, set up two separate alerts — one per condition, each with a fixed action:
              </p>
              <div className="space-y-2">
                <CopyField value={manualBuyTemplate} field="buyTemplate" copiedField={copiedField} onCopy={copyToClipboard} />
                <CopyField value={manualSellTemplate} field="sellTemplate" copiedField={copiedField} onCopy={copyToClipboard} />
              </div>

              <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
                TradingView fills in <code className="text-green-600 dark:text-green-400">{"{{ticker}}"}</code>/<code className="text-green-600 dark:text-green-400">{"{{close}}"}</code> automatically when the alert fires. <code className="text-green-600 dark:text-green-400">stopLoss</code>, <code className="text-green-600 dark:text-green-400">takeProfit</code>, and <code className="text-green-600 dark:text-green-400">reasoning</code> are optional extra fields you can add the same way.
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <Bell size={16} className="text-green-500" />
                <h3 className="font-bold text-slate-900 dark:text-white">On TradingView's side</h3>
              </div>
              <ol className="text-sm text-slate-500 dark:text-slate-400 space-y-2 list-decimal list-inside">
                <li>Open the chart, right-click → <span className="text-slate-900 dark:text-white">Add Alert</span> (or use an existing one)</li>
                <li>Under <span className="text-slate-900 dark:text-white">Notifications</span>, check <span className="text-slate-900 dark:text-white">Webhook URL</span> and paste the URL from Step 1</li>
                <li>In the <span className="text-slate-900 dark:text-white">Message</span> box, paste one of the templates from Step 3</li>
                <li>Save — the next time the alert fires, it'll show up in your Notifications feed here</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}

export default TradingView;
