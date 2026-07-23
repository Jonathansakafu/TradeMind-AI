import { useState, useEffect, useRef } from "react";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import {
  Newspaper, TrendingUp, TrendingDown,
  RefreshCw, ExternalLink, AlertTriangle,
  Bookmark, BookmarkCheck, Search, X
} from "lucide-react";
import { API_URL } from "../config/api";

function News() {
  const [news, setNews] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [savedNews, setSavedNews] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("saved_news") || "[]");
    } catch { return []; }
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [activeTab, setActiveTab] = useState("live");
  const analysisRef = useRef(null);
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchNews = async (query = "") => {
    setLoading(true);
    try {
      const url = query
        ? `${API_URL}/api/market/news?q=${encodeURIComponent(query)}`
        : `${API_URL}/api/market/news`;
      const res = await axios.get(url, { headers });
      setNews(res.data.articles || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchNews(); }, []);

  // Search suggestions
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchSuggestions([]);
      return;
    }
    const suggestions = [
      `${searchQuery} forex`,
      `${searchQuery} trading`,
      `${searchQuery} USD`,
      `${searchQuery} market impact`,
      `${searchQuery} currency`,
    ];
    setSearchSuggestions(suggestions);
  }, [searchQuery]);

  const handleSearch = (query) => {
    setSearchQuery(query);
    setSearchSuggestions([]);
    fetchNews(query);
  };

  const analyzeArticle = async (article) => {
    setSelectedArticle(article);
    setAnalyzing(true);
    setAnalysis(null);
    // Scroll to analysis on mobile
    setTimeout(() => {
      analysisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    try {
      const res = await axios.post(
        `${API_URL}/api/market/analyze-news`,
        { article },
        { headers }
      );
      setAnalysis(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleSave = (article) => {
    const isSaved = savedNews.some((n) => n.title === article.title);
    let updated;
    if (isSaved) {
      updated = savedNews.filter((n) => n.title !== article.title);
    } else {
      updated = [...savedNews, { ...article, savedAnalysis: analysis, savedAt: new Date() }];
    }
    setSavedNews(updated);
    localStorage.setItem("saved_news", JSON.stringify(updated));
  };

  const isSaved = (article) => savedNews.some((n) => n.title === article.title);

  const getImpactColor = (level) => {
    if (level === "high") return "text-red-400 bg-red-500/10 border-red-500/20";
    if (level === "medium") return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
    return "text-green-400 bg-green-500/10 border-green-500/20";
  };

  const displayNews = activeTab === "saved" ? savedNews : news;

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold flex items-center gap-3">
            <Newspaper className="text-green-400" size={32} />
            Forex News
          </h2>
          <p className="text-slate-400 mt-1">Live news with AI market impact analysis</p>
        </div>
        <button onClick={() => fetchNews(searchQuery)}
          className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white transition">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
          <Search size={16} className="text-slate-500 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search forex news... (e.g. Trump, Fed, Interest Rate)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch(searchQuery)}
            className="bg-transparent outline-none text-sm text-white flex-1"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(""); fetchNews(""); }}>
              <X size={14} className="text-slate-500 hover:text-white" />
            </button>
          )}
        </div>
        {/* Suggestions */}
        {searchSuggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 bg-slate-900 border border-slate-700 rounded-xl mt-1 z-20 overflow-hidden">
            {searchSuggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSearch(s)}
                className="flex items-center gap-2 w-full px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition text-left"
              >
                <Search size={12} className="text-slate-500" />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setActiveTab("live")}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
            activeTab === "live"
              ? "bg-green-500 text-slate-950"
              : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
          }`}>
          📡 Live News
        </button>
        <button onClick={() => setActiveTab("saved")}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${
            activeTab === "saved"
              ? "bg-green-500 text-slate-950"
              : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
          }`}>
          <Bookmark size={14} />
          Saved ({savedNews.length})
        </button>
      </div>

      {/* Main Layout — Fixed scroll issue */}
      <div className="grid lg:grid-cols-2 gap-6 items-start">

        {/* News List — Independent scroll */}
        <div className="overflow-y-auto max-h-screen space-y-3 pr-1"
          style={{ maxHeight: "calc(100vh - 280px)" }}>
          <h3 className="font-semibold text-slate-300 mb-3 sticky top-0 bg-slate-950 py-2">
            {activeTab === "live" ? "Latest News" : "Saved Articles"}
          </h3>
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : displayNews.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              <Newspaper size={40} className="mx-auto mb-3 text-slate-700" />
              <p>{activeTab === "saved" ? "No saved articles yet" : "No news available"}</p>
            </div>
          ) : (
            displayNews.map((article, i) => (
              <div key={i}
                onClick={() => analyzeArticle(article)}
                className={`bg-slate-900 border rounded-xl p-4 cursor-pointer transition hover:border-green-500/50 ${
                  selectedArticle?.title === article.title
                    ? "border-green-500/50 bg-green-500/5"
                    : "border-slate-800"
                }`}>
                <div className="flex items-start gap-3">
                  {article.urlToImage && (
                    <img src={article.urlToImage} alt=""
                      className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                      onError={(e) => { e.target.style.display = "none"; }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white leading-snug mb-1 line-clamp-2">
                      {article.title}
                    </p>
                    <p className="text-xs text-slate-500 mb-2 line-clamp-1">
                      {article.description}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-slate-600">{article.source?.name}</span>
                      <span className="text-xs text-slate-600">
                        {new Date(article.publishedAt || article.savedAt).toLocaleString()}
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleSave(article); }}
                          className={`transition ${isSaved(article) ? "text-green-400" : "text-slate-600 hover:text-green-400"}`}>
                          {isSaved(article)
                            ? <BookmarkCheck size={14} />
                            : <Bookmark size={14} />}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); window.open(article.url, "_blank"); }}
                          className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1">
                          Read <ExternalLink size={10} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* AI Analysis — Independent scroll */}
        <div ref={analysisRef}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 overflow-y-auto"
          style={{ maxHeight: "calc(100vh - 280px)" }}>
          <h3 className="font-semibold text-slate-300 mb-4 flex items-center gap-2 sticky top-0 bg-slate-900 py-2">
            <AlertTriangle size={16} className="text-yellow-400" />
            AI Market Impact Analysis
          </h3>

          {!selectedArticle ? (
            <div className="text-center py-16 text-slate-500">
              <Newspaper size={40} className="mx-auto mb-3 text-slate-700" />
              <p className="text-sm">Click any news article on the left</p>
              <p className="text-xs text-slate-600 mt-1">AI will analyze market impact</p>
            </div>
          ) : analyzing ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-400 text-sm">AI analyzing news impact...</p>
            </div>
          ) : analysis ? (
            <div className="space-y-4">
              <div className="bg-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-1">Headline</p>
                <p className="text-sm font-semibold text-white">{analysis.headline}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-xl p-3 border text-center ${
                  analysis.sentiment === "bullish" ? "bg-green-500/10 border-green-500/20"
                  : analysis.sentiment === "bearish" ? "bg-red-500/10 border-red-500/20"
                  : "bg-slate-800 border-slate-700"
                }`}>
                  <p className="text-xs text-slate-400 mb-1">Sentiment</p>
                  <p className={`font-bold ${
                    analysis.sentiment === "bullish" ? "text-green-400"
                    : analysis.sentiment === "bearish" ? "text-red-400"
                    : "text-slate-300"
                  }`}>
                    {analysis.sentiment === "bullish" ? "📈 Bullish"
                      : analysis.sentiment === "bearish" ? "📉 Bearish"
                      : "➖ Neutral"}
                  </p>
                </div>
                <div className={`rounded-xl p-3 border text-center ${getImpactColor(analysis.impactLevel)}`}>
                  <p className="text-xs text-slate-400 mb-1">Impact</p>
                  <p className="font-bold capitalize">{analysis.impactLevel} Impact</p>
                </div>
              </div>

              <div className="bg-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-1">Summary</p>
                <p className="text-sm text-slate-300">{analysis.summary}</p>
              </div>

              {analysis.affectedPairs?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 mb-2">Affected Pairs</p>
                  <div className="space-y-2">
                    {analysis.affectedPairs.map((p, i) => (
                      <div key={i} className={`rounded-xl p-3 border ${
                        p.impact === "bullish" ? "bg-green-500/10 border-green-500/20"
                        : p.impact === "bearish" ? "bg-red-500/10 border-red-500/20"
                        : "bg-slate-800 border-slate-700"
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-white">{p.pair}</span>
                          <span className={`text-xs font-semibold flex items-center gap-1 ${
                            p.impact === "bullish" ? "text-green-400"
                            : p.impact === "bearish" ? "text-red-400"
                            : "text-slate-400"
                          }`}>
                            {p.impact === "bullish" ? <><TrendingUp size={12} /> Bullish</>
                              : p.impact === "bearish" ? <><TrendingDown size={12} /> Bearish</>
                              : "Neutral"}
                          </span>
                        </div>
                        {p.entry && (
                          <div className="grid grid-cols-3 gap-2 mb-2">
                            <div className="bg-slate-900/50 rounded-lg px-2 py-1 text-center">
                              <p className="text-xs text-slate-500">Entry</p>
                              <p className="text-xs font-mono text-white">{p.entry}</p>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg px-2 py-1 text-center">
                              <p className="text-xs text-slate-500">SL</p>
                              <p className="text-xs font-mono text-red-400">{p.stopLoss}</p>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg px-2 py-1 text-center">
                              <p className="text-xs text-slate-500">TP</p>
                              <p className="text-xs font-mono text-green-400">{p.takeProfit}</p>
                            </div>
                          </div>
                        )}
                        <p className="text-xs text-slate-400">{p.reasoning}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-1">💡 Trading Advice</p>
                <p className="text-sm text-slate-300">{analysis.tradingAdvice}</p>
              </div>

              {/* Save with Analysis */}
              <button
                onClick={() => toggleSave({ ...selectedArticle, savedAnalysis: analysis })}
                className={`w-full flex items-center justify-center gap-2 p-3 rounded-xl border transition text-sm font-semibold ${
                  isSaved(selectedArticle)
                    ? "bg-green-500/10 border-green-500/30 text-green-400"
                    : "bg-slate-800 border-slate-700 text-slate-400 hover:text-white"
                }`}>
                {isSaved(selectedArticle)
                  ? <><BookmarkCheck size={16} /> Saved with Analysis</>
                  : <><Bookmark size={16} /> Save Article + Analysis</>}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </MainLayout>
  );
}

export default News;