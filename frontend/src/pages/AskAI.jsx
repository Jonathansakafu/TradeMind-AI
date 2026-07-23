import { useState, useRef, useEffect } from "react";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import { Sparkles, Send, BookOpen, History, User, Bot } from "lucide-react";
import { API_URL } from "../config/api";

const SOURCE_ICONS = {
  book: <BookOpen size={12} className="text-purple-400" />,
  trade: <History size={12} className="text-blue-400" />,
};

function AskAI() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const askQuestion = async (e) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setLoading(true);

    try {
      const res = await axios.post(
        `${API_URL}/api/ai/ask`,
        { question },
        { headers }
      );
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: res.data.answer, sources: res.data.sources || [] },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: "Something went wrong answering that — please try again.", sources: [] },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold flex items-center gap-3">
            <Sparkles className="text-green-400" size={32} />
            Ask AI
          </h2>
          <p className="text-slate-400 mt-2">
            Ask questions grounded in your uploaded books and trade history — powered by retrieval-augmented generation
          </p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-[65vh]">
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <Sparkles size={40} className="text-slate-700 mx-auto mb-4" />
              <p className="text-slate-400 text-lg font-semibold">Ask anything about your trading</p>
              <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
                e.g. "What does my Wyckoff book say about spring patterns?" or
                "How have my EURUSD London session trades performed?"
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "ai" && (
                <div className="w-8 h-8 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center flex-shrink-0">
                  <Bot size={16} className="text-green-400" />
                </div>
              )}
              <div className={`max-w-[80%] ${m.role === "user" ? "order-1" : ""}`}>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-green-500 text-slate-950 font-medium"
                      : "bg-slate-800 text-slate-200"
                  }`}
                >
                  {m.text}
                </div>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.sources.map((s, si) => (
                      <span
                        key={si}
                        title={s.snippet}
                        className="inline-flex items-center gap-1 text-xs bg-slate-800/70 border border-slate-700 text-slate-400 px-2 py-1 rounded-lg"
                      >
                        {SOURCE_ICONS[s.source] || <BookOpen size={12} />}
                        {s.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {m.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center flex-shrink-0 order-2">
                  <User size={16} className="text-slate-400" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center flex-shrink-0">
                <Bot size={16} className="text-green-400" />
              </div>
              <div className="bg-slate-800 rounded-2xl px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={askQuestion} className="border-t border-slate-800 p-4 flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your books or trade history..."
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-semibold px-5 py-3 rounded-xl text-sm transition"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </MainLayout>
  );
}

export default AskAI;
