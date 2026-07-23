import { useState, useEffect } from "react";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import {
  Zap, CheckCircle, XCircle, Clock,
  TrendingUp, TrendingDown, Copy, ExternalLink,
  RefreshCw, AlertTriangle, Info, ShieldCheck, ShieldAlert
} from "lucide-react";
import { API_URL } from "../config/api";
import BrokerModal from "../components/BrokerModal";

function MT5() {
  const [signals, setSignals] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lotSize, setLotSize] = useState("0.01");
  const [copied, setCopied] = useState(false);
  const [showBrokers, setShowBrokers] = useState(false);
  const [accountType, setAccountType] = useState(
    localStorage.getItem("mt5AccountType") || "demo"
  );
  const token = localStorage.getItem("token");
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const headers = { Authorization: `Bearer ${token}` };

  const selectAccountType = (type) => {
    setAccountType(type);
    localStorage.setItem("mt5AccountType", type);
  };

  const SERVER_URL = API_URL;
  const MT5_ENDPOINT = `${SERVER_URL}/api/mt5/pending?userId=${user._id}`;
  const MT5_EXECUTED_ENDPOINT = `${SERVER_URL}/api/mt5/executed`;

  const fetchData = async () => {
    try {
      const [signalsRes, statsRes] = await Promise.all([
        axios.get(`${SERVER_URL}/api/mt5/signals`, { headers }),
        axios.get(`${SERVER_URL}/api/mt5/stats`, { headers }),
      ]);
      setSignals(signalsRes.data || []);
      setStats(statsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "executed": return "text-green-400 bg-green-500/10 border-green-500/20";
      case "sent": return "text-blue-400 bg-blue-500/10 border-blue-500/20";
      case "pending": return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
      case "failed": return "text-red-400 bg-red-500/10 border-red-500/20";
      case "cancelled": return "text-slate-400 bg-slate-700 border-slate-600";
      default: return "text-slate-400 bg-slate-700 border-slate-600";
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case "executed": return <CheckCircle size={12} />;
      case "sent": return <Clock size={12} />;
      case "pending": return <Clock size={12} />;
      case "failed": return <XCircle size={12} />;
      default: return <Clock size={12} />;
    }
  };

  // MQL5 EA code to show user
  const eaCode = `//+------------------------------------------------------------------+
//|                                          TradeMind_AI_EA.mq5    |
//|                              TradeMind AI — Auto Trading EA      |
//+------------------------------------------------------------------+
#property copyright "TradeMind AI"
#property version   "1.00"

#include <Trade\\Trade.mqh>

CTrade trade;

input string ServerURL = "${MT5_ENDPOINT}";
input string ExecutedURL = "${MT5_EXECUTED_ENDPOINT}";
input double DefaultLotSize = ${lotSize};
input int    CheckIntervalSeconds = 10;
input bool   EnableAutoTrading = true;

string lastSignalId = "";

int OnInit() {
   Print("TradeMind AI EA Started");
   EventSetTimer(CheckIntervalSeconds);
   return(INIT_SUCCEEDED);
}

void OnTimer() {
   if(!EnableAutoTrading) return;
   CheckForSignals();
}

void CheckForSignals() {
   string url = ServerURL;
   string headers = "Content-Type: application/json\\r\\n";
   char post[], result[];
   string resultHeaders;

   int res = WebRequest("GET", url, headers, 5000, post, result, resultHeaders);
   
   if(res == 200) {
      string response = CharArrayToString(result);
      
      // Parse JSON response
      if(StringLen(response) > 10 && StringFind(response, "pair") >= 0) {
         ParseAndExecuteSignals(response);
      }
   } else {
      Print("TradeMind AI: Failed to connect — Code: ", res);
   }
}

void ParseAndExecuteSignals(string jsonResponse) {
   // Find pair
   string pair = ExtractValue(jsonResponse, "pair");
   string action = ExtractValue(jsonResponse, "action");
   string signalId = ExtractValue(jsonResponse, "signalId");
   string token = ExtractValue(jsonResponse, "token");
   double entry = StringToDouble(ExtractValue(jsonResponse, "entry"));
   double sl = StringToDouble(ExtractValue(jsonResponse, "stopLoss"));
   double tp = StringToDouble(ExtractValue(jsonResponse, "takeProfit"));
   double lots = StringToDouble(ExtractValue(jsonResponse, "lotSize"));
   
   if(lots <= 0) lots = DefaultLotSize;
   if(signalId == lastSignalId || signalId == "") return;
   
   lastSignalId = signalId;
   
   Print("TradeMind AI Signal: ", action, " ", pair, " @ ", entry);
   
   bool success = false;
   
   if(action == "buy") {
      success = trade.Buy(lots, pair, 0, sl, tp, "TradeMind AI");
   } else if(action == "sell") {
      success = trade.Sell(lots, pair, 0, sl, tp, "TradeMind AI");
   }
   
   // Report back to TradeMind AI
   string status = success ? "executed" : "failed";
   string mt5Msg = success ? "Trade executed successfully" : "Trade execution failed";
   
   ReportToServer(signalId, token, status, mt5Msg);
}

void ReportToServer(string signalId, string token, string status, string msg) {
   string url = ExecutedURL;
   string headers = "Content-Type: application/json\\r\\n";
   string body = "{\\"signalId\\":\\"" + signalId + "\\",\\"token\\":\\"" + token +
                 "\\",\\"status\\":\\"" + status + "\\",\\"mt5Response\\":\\"" + msg + "\\"}";
   
   char post[], result[];
   string resultHeaders;
   StringToCharArray(body, post, 0, StringLen(body));
   
   WebRequest("POST", url, headers, 5000, post, result, resultHeaders);
   Print("TradeMind AI: Reported status — ", status);
}

string ExtractValue(string json, string key) {
   string search = "\\"" + key + "\\":";
   int start = StringFind(json, search);
   if(start < 0) return "";
   
   start += StringLen(search);
   
   // Skip whitespace
   while(start < StringLen(json) && (json[start] == ' ' || json[start] == '"')) start++;
   
   int end = start;
   while(end < StringLen(json) && json[end] != '"' && json[end] != ',' && 
         json[end] != '}' && json[end] != ']') end++;
   
   return StringSubstr(json, start, end - start);
}

void OnDeinit(const int reason) {
   EventKillTimer();
   Print("TradeMind AI EA Stopped");
}
//+------------------------------------------------------------------+`;

  return (
    <MainLayout>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white flex items-center gap-3">
            <Zap className="text-green-400" size={32} />
            MT5 Auto Trading
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Connect TradeMind AI signals to MetaTrader 5
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white transition"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Account Type — safety-critical, shown prominently */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 rounded-2xl border p-5 ${
        accountType === "real"
          ? "bg-red-500/10 border-red-500/30"
          : "bg-green-500/10 border-green-500/30"
      }`}>
        <div className="flex items-center gap-3">
          {accountType === "real"
            ? <ShieldAlert className="text-red-400 flex-shrink-0" size={24} />
            : <ShieldCheck className="text-green-400 flex-shrink-0" size={24} />
          }
          <div>
            <p className={`font-bold text-sm ${accountType === "real" ? "text-red-400" : "text-green-400"}`}>
              {accountType === "real" ? "REAL MONEY ACCOUNT" : "DEMO ACCOUNT"}
            </p>
            <p className="text-slate-400 text-xs mt-0.5">
              {accountType === "real"
                ? "Signals sent to MT5 will be tagged for your live account — real funds are at risk"
                : "Signals sent to MT5 will be tagged for practice/demo trading only"
              }
            </p>
          </div>
        </div>
        <div className="flex items-center bg-slate-950/50 rounded-xl p-1 flex-shrink-0 w-full sm:w-auto">
          <button
            onClick={() => selectAccountType("demo")}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-semibold transition ${
              accountType === "demo" ? "bg-green-500 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            Demo
          </button>
          <button
            onClick={() => selectAccountType("real")}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-semibold transition ${
              accountType === "real" ? "bg-red-500 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Real
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <p className="text-slate-400 text-sm mb-1">Total Signals</p>
            <p className="text-3xl font-bold text-white">{stats.total}</p>
          </div>
          <div className="bg-slate-900 border border-green-500/20 rounded-2xl p-5">
            <p className="text-slate-400 text-sm mb-1">Executed</p>
            <p className="text-3xl font-bold text-green-400">{stats.executed}</p>
          </div>
          <div className="bg-slate-900 border border-yellow-500/20 rounded-2xl p-5">
            <p className="text-slate-400 text-sm mb-1">Pending</p>
            <p className="text-3xl font-bold text-yellow-400">{stats.pending}</p>
          </div>
          <div className="bg-slate-900 border border-red-500/20 rounded-2xl p-5">
            <p className="text-slate-400 text-sm mb-1">Failed</p>
            <p className="text-3xl font-bold text-red-400">{stats.failed}</p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">

        {/* Setup Guide */}
        <div className="space-y-5">

          {/* Step 1 */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-slate-950 font-bold text-sm flex-shrink-0">
                1
              </div>
              <h3 className="font-bold text-white">Download & Install MT5</h3>
            </div>
            <p className="text-slate-400 text-sm mb-4">
              Choose your broker to download MetaTrader 5
            </p>
            <button
              onClick={() => setShowBrokers(true)}
              className="flex items-center gap-2 w-full bg-slate-800 border border-slate-700 hover:border-green-500/50 px-4 py-2.5 rounded-xl text-sm text-slate-300 hover:text-white transition"
            >
              <ExternalLink size={14} className="text-green-400" />
              Select a broker
            </button>
            <BrokerModal open={showBrokers} onClose={() => setShowBrokers(false)} />
          </div>

          {/* Step 2 */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-slate-950 font-bold text-sm flex-shrink-0">
                2
              </div>
              <h3 className="font-bold text-white">Configure Lot Size</h3>
            </div>
            <p className="text-slate-400 text-sm mb-3">
              Set your default lot size for auto trades
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={lotSize}
                onChange={(e) => setLotSize(e.target.value)}
                className="bg-slate-800 border border-slate-700 focus:border-green-500 p-3 rounded-xl outline-none text-white font-mono text-sm w-32"
              />
              <div className="text-xs text-slate-500">
                <p>0.01 = Micro lot ($0.10/pip)</p>
                <p>0.10 = Mini lot ($1.00/pip)</p>
                <p>1.00 = Standard lot ($10/pip)</p>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-slate-950 font-bold text-sm flex-shrink-0">
                3
              </div>
              <h3 className="font-bold text-white">Copy EA to MT5</h3>
            </div>
            <p className="text-slate-400 text-sm mb-4">
              Copy this Expert Advisor code and paste it in MT5 MetaEditor
            </p>
            <div className="bg-slate-950 border border-slate-700 rounded-xl p-4 max-h-48 overflow-y-auto mb-3">
              <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                {eaCode.slice(0, 500)}...
              </pre>
            </div>
            <button
              onClick={() => copyToClipboard(eaCode)}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-sm transition w-full justify-center"
            >
              <Copy size={14} />
              {copied ? "Copied! ✓" : "Copy Full EA Code"}
            </button>
          </div>

          {/* Step 4 */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-slate-950 font-bold text-sm flex-shrink-0">
                4
              </div>
              <h3 className="font-bold text-white">Allow WebRequests in MT5</h3>
            </div>
            <div className="space-y-2 text-sm text-slate-400">
              <p>In MT5: <span className="text-white">Tools → Options → Expert Advisors</span></p>
              <p>Check: <span className="text-green-400">✅ Allow WebRequest for listed URL</span></p>
              <p>Add URL:</p>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 flex items-center justify-between">
                <code className="text-green-400 text-xs font-mono break-all">
                  {SERVER_URL}
                </code>
                <button
                  onClick={() => copyToClipboard(SERVER_URL)}
                  className="text-slate-500 hover:text-green-400 transition flex-shrink-0 ml-2"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
          </div>

          {/* Step 5 */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-slate-950 font-bold text-sm flex-shrink-0">
                5
              </div>
              <h3 className="font-bold text-white">Your MT5 Signal URL</h3>
            </div>
            <p className="text-slate-400 text-sm mb-3">
              This URL is configured in the EA — MT5 polls it every 10 seconds
            </p>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 flex items-center justify-between mb-2">
              <code className="text-green-400 text-xs font-mono break-all">
                {MT5_ENDPOINT}
              </code>
              <button
                onClick={() => copyToClipboard(MT5_ENDPOINT)}
                className="text-slate-500 hover:text-green-400 transition flex-shrink-0 ml-2"
              >
                <Copy size={12} />
              </button>
            </div>
            <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
              <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-300">
                For live trading, deploy backend to internet (Railway/Render) and use production URL
              </p>
            </div>
          </div>

        </div>

        {/* Signal History */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden h-fit">
          <div className="px-6 py-4 border-b border-slate-800">
            <h3 className="font-bold text-white">Signal History</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Signals sent to MT5
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : signals.length === 0 ? (
            <div className="text-center py-16 px-6">
              <Zap size={40} className="text-slate-700 mx-auto mb-4" />
              <p className="text-slate-400 font-semibold">No signals sent yet</p>
              <p className="text-slate-500 text-sm mt-2">
                Send a signal from Live Analysis or Notifications page
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800 max-h-[600px] overflow-y-auto">
              {signals.map((signal) => (
                <div key={signal._id} className="px-5 py-4 hover:bg-slate-800/40 transition">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-base font-bold ${
                        signal.action === "buy" ? "text-green-400" : "text-red-400"
                      }`}>
                        {signal.action === "buy"
                          ? <TrendingUp size={16} className="inline mr-1" />
                          : <TrendingDown size={16} className="inline mr-1" />}
                        {signal.action?.toUpperCase()}
                      </span>
                      <span className="font-bold text-white">{signal.pair}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                        signal.accountType === "real"
                          ? "bg-red-500/10 text-red-400"
                          : "bg-green-500/10 text-green-400"
                      }`}>
                        {signal.accountType === "real" ? "REAL" : "DEMO"}
                      </span>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold ${getStatusColor(signal.status)}`}>
                      {getStatusIcon(signal.status)}
                      {signal.status?.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div className="bg-slate-800 rounded-lg p-2 text-center">
                      <p className="text-xs text-slate-500">Entry</p>
                      <p className="font-mono text-xs font-bold text-white">
                        {signal.entry}
                      </p>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center">
                      <p className="text-xs text-slate-500">SL</p>
                      <p className="font-mono text-xs font-bold text-red-400">
                        {signal.stopLoss || "—"}
                      </p>
                    </div>
                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2 text-center">
                      <p className="text-xs text-slate-500">TP</p>
                      <p className="font-mono text-xs font-bold text-green-400">
                        {signal.takeProfit || "—"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      Lot: {signal.lotSize} · {signal.confidence}% confidence
                    </span>
                    <span className="text-xs text-slate-600">
                      {new Date(signal.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {signal.mt5Response && (
                    <div className="mt-2 bg-slate-800/50 rounded-lg p-2">
                      <p className="text-xs text-slate-400">
                        MT5: {signal.mt5Response}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Info Box */}
      <div className="mt-6 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-blue-400 font-semibold text-sm mb-1">
              How Auto Trading Works
            </p>
            <div className="text-slate-300 text-sm space-y-1">
              <p>1. TradeMind AI generates a signal (from Live Analysis or Notifications)</p>
              <p>2. You click "Send to MT5" — signal is saved to database</p>
              <p>3. MT5 EA checks for new signals every 10 seconds</p>
              <p>4. EA executes the trade automatically with your configured lot size</p>
              <p>5. EA reports back — status updates to "Executed" here</p>
            </div>
          </div>
        </div>
      </div>

    </MainLayout>
  );
}

export default MT5;