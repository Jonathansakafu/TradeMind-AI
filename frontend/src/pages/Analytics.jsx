import { useState, useEffect } from "react";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import {
  Brain, TrendingUp, AlertTriangle,
  Star, RefreshCw, Upload, X,
  FileText, BookOpen, Trash2
} from "lucide-react";
import { API_URL } from "../config/api";

const PAIRS = ["EURUSD","GBPUSD","USDJPY","XAUUSD","AUDUSD","GBPJPY","EURJPY","USDCAD","NZDUSD","USDCHF"];
const SESSIONS = ["london","new_york","tokyo","sydney","overlap"];

function Analytics() {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [proposedTrade, setProposedTrade] = useState({
    pair: "EURUSD", direction: "buy", session: "london",
  });
  const [docFile, setDocFile] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docResult, setDocResult] = useState(null);
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotResult, setScreenshotResult] = useState(null);
  const [books, setBooks] = useState([]);

  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  // Fetch saved books
  useEffect(() => {
    axios.get(`${API_URL}/api/ai/books`, { headers })
      .then((res) => setBooks(res.data || []))
      .catch(console.error);
  }, []);

  const runAnalysis = async () => {
    setLoading(true);
    setAnalysis(null);
    try {
      const res = await axios.post(
        `${API_URL}/api/ai/patterns`, {}, { headers }
      );
      setAnalysis(res.data.result);
    } catch (err) {
      // Kama trades hazitoshi — bado endelea na AI auto
      setAnalysis({
        bestSession: "london",
        strongestPairs: [],
        riskBehaviors: [],
        recommendations: [
          "Add more trades in order to update personalized analysis",
          "Use AI Analytics page to get signals live and directlty from your trading patterns",
          "Upload forex book to get analysis based on its strategies",
        ],
      });
    } finally {
      setLoading(false);
    }
  };

  const getSuggestion = async () => {
    setSuggestLoading(true);
    setSuggestion(null);
    try {
      const res = await axios.post(
        `${API_URL}/api/ai/suggest`,
        { proposedTrade },
        { headers }
      );
      setSuggestion(res.data);
    } catch (err) {
      alert("Suggestion failed");
    } finally {
      setSuggestLoading(false);
    }
  };

  const analyzeDocument = async () => {
    if (!docFile) return alert("Chagua PDF kwanza");
    setDocLoading(true);
    setDocResult(null);
    try {
      const formData = new FormData();
      formData.append("document", docFile);
      const res = await axios.post(
        `${API_URL}/api/ai/document`,
        formData,
        { headers: { ...headers, "Content-Type": "multipart/form-data" } }
      );
      setDocResult(res.data);
      setDocFile(null);
      // Refresh books list
      const booksRes = await axios.get(`${API_URL}/api/ai/books`, { headers });
      setBooks(booksRes.data || []);
    } catch (err) {
      alert("Document analysis failed");
    } finally {
      setDocLoading(false);
    }
  };

  const deleteBook = async (id) => {
    try {
      await axios.delete(`${API_URL}/api/ai/books/${id}`, { headers });
      setBooks(books.filter((b) => b._id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const analyzeScreenshot = async () => {
    if (!screenshotFile) return alert("Chagua screenshot kwanza");
    setScreenshotLoading(true);
    setScreenshotResult(null);
    try {
      const formData = new FormData();
      formData.append("screenshot", screenshotFile);
      const res = await axios.post(
        `${API_URL}/api/ai/screenshot`,
        formData,
        { headers: { ...headers, "Content-Type": "multipart/form-data" } }
      );
      setScreenshotResult(res.data.analysis);
    } catch (err) {
      alert("Screenshot analysis failed");
    } finally {
      setScreenshotLoading(false);
    }
  };

  const handleScreenshotChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setScreenshotFile(file);
    setScreenshotPreview(URL.createObjectURL(file));
  };

  return (
    <MainLayout>
      <div className="mb-8">
        <h2 className="text-3xl md:text-4xl font-bold flex items-center gap-3">
          <Brain className="text-green-400" size={32} />
          AI Analysis
        </h2>
        <p className="text-slate-400 mt-2">Powered by TradeMind AI with Groq </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">

        {/* PATTERN DETECTION */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <TrendingUp size={18} className="text-green-400" />
              Pattern Detection
            </h3>
            <button
              onClick={runAnalysis} disabled={loading}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 px-4 py-2 rounded-xl text-sm font-semibold transition"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {loading ? "Analyzing..." : "Run Analysis"}
            </button>
          </div>

          {!analysis ? (
            <div className="text-center py-12 text-slate-500">
              <Brain size={40} className="mx-auto mb-3 text-slate-700" />
              <p className="text-sm">Click "Run Analysis"</p>
              <p className="text-xs text-slate-600 mt-1">
                AI works even no trades — AI Auto is generating signals based on market + news patterns and your saved books
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {analysis.bestSession && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
                  <p className="text-xs text-green-400 mb-1">✅ Best Session</p>
                  <p className="font-bold text-xl capitalize">{analysis.bestSession}</p>
                </div>
              )}
              {analysis.strongestPairs?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
                    <Star size={12} className="text-yellow-400" /> Strongest Pairs
                  </p>
                  {analysis.strongestPairs.slice(0, 3).map((p, i) => (
                    <div key={i} className="flex justify-between bg-slate-800 px-4 py-3 rounded-xl mb-2">
                      <span className="font-bold">{p.pair}</span>
                      <span className="text-green-400">{p.winRate}% win</span>
                    </div>
                  ))}
                </div>
              )}
              {analysis.riskBehaviors?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
                    <AlertTriangle size={12} className="text-yellow-400" /> Risk Behaviors
                  </p>
                  {analysis.riskBehaviors.map((r, i) => (
                    <div key={i} className={`px-4 py-3 rounded-xl text-sm border mb-2
                      ${r.severity === "high" ? "bg-red-500/10 border-red-500/20 text-red-300"
                        : r.severity === "medium" ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-300"
                        : "bg-slate-800 border-slate-700 text-slate-300"}`}>
                      <p className="font-semibold">{r.type}</p>
                      <p className="text-xs opacity-75 mt-0.5">{r.description}</p>
                    </div>
                  ))}
                </div>
              )}
              {analysis.recommendations?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 mb-2">💡 Recommendations</p>
                  {analysis.recommendations.map((r, i) => (
                    <div key={i} className="flex gap-2 text-sm text-slate-300 bg-slate-800 px-4 py-3 rounded-xl mb-2">
                      <span className="text-green-400 font-bold">→</span> {r}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* TRADE SUGGESTION */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h3 className="text-lg font-bold flex items-center gap-2 mb-6">
            <Brain size={18} className="text-green-400" />
            Should I Take This Trade?
          </h3>
          <div className="space-y-4 mb-5">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Pair</label>
              <select
                value={proposedTrade.pair}
                onChange={(e) => setProposedTrade({ ...proposedTrade, pair: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl text-white outline-none focus:border-green-500 transition"
              >
                {PAIRS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-400 mb-1 block">Direction</label>
                <select
                  value={proposedTrade.direction}
                  onChange={(e) => setProposedTrade({ ...proposedTrade, direction: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl text-white outline-none focus:border-green-500 transition"
                >
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1 block">Session</label>
                <select
                  value={proposedTrade.session}
                  onChange={(e) => setProposedTrade({ ...proposedTrade, session: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl text-white outline-none focus:border-green-500 transition"
                >
                  {SESSIONS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <button
              onClick={getSuggestion} disabled={suggestLoading}
              className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold p-4 rounded-xl transition flex items-center justify-center gap-2"
            >
              {suggestLoading
                ? <><div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" /> Asking AI...</>
                : <><Brain size={18} /> Ask AI</>}
            </button>
          </div>

          {suggestion && (
            <div className={`rounded-2xl p-5 border ${
              suggestion.recommendation === "take" ? "bg-green-500/10 border-green-500/30"
              : suggestion.recommendation === "skip" ? "bg-red-500/10 border-red-500/30"
              : "bg-yellow-500/10 border-yellow-500/30"}`}>
              <div className="flex items-center justify-between mb-3">
                <p className={`text-2xl font-bold ${
                  suggestion.recommendation === "take" ? "text-green-400"
                  : suggestion.recommendation === "skip" ? "text-red-400"
                  : "text-yellow-400"}`}>
                  {suggestion.recommendation === "take" ? "✅ TAKE IT"
                    : suggestion.recommendation === "skip" ? "❌ SKIP IT"
                    : "⚠️ WAIT"}
                </p>
                <span className="font-semibold text-slate-300">{suggestion.confidence}%</span>
              </div>
              <p className="text-slate-300 text-sm mb-3">{suggestion.reasoning}</p>
              {suggestion.risks?.map((r, i) => (
                <p key={i} className="text-xs text-red-300 mb-0.5">• {r}</p>
              ))}
              {suggestion.improvements?.map((r, i) => (
                <p key={i} className="text-xs text-green-300 mb-0.5">• {r}</p>
              ))}
            </div>
          )}
        </div>

        {/* SCREENSHOT ANALYSIS */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h3 className="text-lg font-bold flex items-center gap-2 mb-6">
            <Brain size={18} className="text-green-400" />
            Chart Screenshot Analysis
          </h3>
          {screenshotPreview ? (
            <div className="relative mb-4">
              <img src={screenshotPreview} alt="chart"
                className="w-full rounded-xl object-cover max-h-48 border border-slate-700" />
              <button
                onClick={() => { setScreenshotFile(null); setScreenshotPreview(null); setScreenshotResult(null); }}
                className="absolute top-2 right-2 bg-slate-900 border border-slate-700 rounded-full p-1.5"
              >
                <X size={14} className="text-red-400" />
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 rounded-xl p-8 cursor-pointer hover:border-green-500/50 transition mb-4">
              <Upload size={28} className="text-slate-600 mb-2" />
              <p className="text-slate-500 text-sm">Upload chart screenshot</p>
              <p className="text-slate-600 text-xs mt-1">PNG, JPG</p>
              <input type="file" accept="image/*" onChange={handleScreenshotChange} className="hidden" />
            </label>
          )}
          <button
            onClick={analyzeScreenshot} disabled={screenshotLoading || !screenshotFile}
            className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold p-3 rounded-xl transition flex items-center justify-center gap-2 mb-4"
          >
            {screenshotLoading
              ? <><div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" /> Analyzing...</>
              : <><Brain size={18} /> Analyze Chart</>}
          </button>
          {screenshotResult && (
            <div className="bg-slate-800 rounded-xl p-4 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
              {screenshotResult}
            </div>
          )}
        </div>

        {/* DOCUMENT UPLOAD + SAVED BOOKS */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h3 className="text-lg font-bold flex items-center gap-2 mb-6">
            <FileText size={18} className="text-green-400" />
            Forex Books — AI can analyize and learn from them to give you better signals and insights based on the strategies and concepts in those books
          </h3>

          {/* Saved Books */}
          {books.length > 0 && (
            <div className="mb-5">
              <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
                <BookOpen size={12} /> Vitabu vilivyohifadhiwa ({books.length})
              </p>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {books.map((b) => (
                  <div key={b._id} className="flex items-center justify-between bg-slate-800 px-3 py-2 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-white">{b.bookName}</p>
                      <p className="text-xs text-slate-500">
                        {b.concepts?.length} concepts · {b.strategies?.length} strategies
                      </p>
                    </div>
                    <button
                      onClick={() => deleteBook(b._id)}
                      className="text-slate-600 hover:text-red-400 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upload New Book */}
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 rounded-xl p-6 cursor-pointer hover:border-green-500/50 transition mb-4">
            <FileText size={28} className="text-slate-600 mb-2" />
            {docFile ? (
              <div className="text-center">
                <p className="text-green-400 text-sm font-semibold">{docFile.name}</p>
                <p className="text-slate-500 text-xs mt-1">
                  {(docFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              <>
                <p className="text-slate-500 text-sm">Upload your trusted forex book PDF</p>
                <p className="text-slate-600 text-xs mt-1">Max 15MB — it will be saved and be used always</p>
              </>
            )}
            <input
              type="file" accept=".pdf,.txt"
              onChange={(e) => { setDocFile(e.target.files[0]); setDocResult(null); }}
              className="hidden"
            />
          </label>

          {docFile && (
            <button
              onClick={() => { setDocFile(null); setDocResult(null); }}
              className="flex items-center gap-2 text-red-400 text-xs mb-3 hover:text-red-300"
            >
              <X size={12} /> Remove file
            </button>
          )}

          <button
            onClick={analyzeDocument} disabled={docLoading || !docFile}
            className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold p-3 rounded-xl transition flex items-center justify-center gap-2 mb-4"
          >
            {docLoading
              ? <><div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" /> Analyzing & Saving...</>
              : <><Brain size={18} /> Analyze & Save Book</>}
          </button>

          {docResult && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
              <p className="text-green-400 text-sm font-semibold mb-1">
                ✅ {docResult.message}
              </p>
              {docResult.bookConcept && (
                <div className="text-xs text-slate-400 mt-2">
                  <p>📚 {docResult.bookConcept.concepts?.length} concepts extracted</p>
                  <p>📈 {docResult.bookConcept.strategies?.length} strategies saved</p>
                  <p>📋 {docResult.bookConcept.rules?.length} rules stored</p>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </MainLayout>
  );
}

export default Analytics;