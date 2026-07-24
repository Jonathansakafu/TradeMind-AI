import { useState, useRef, useEffect } from "react";
import { Sparkles, X, Send, Bot, User, BookOpen, History, HelpCircle } from "lucide-react";
import { streamAsk } from "../utils/streamAsk";

const SOURCE_ICONS = {
  book: <BookOpen size={11} className="text-purple-400" />,
  trade: <History size={11} className="text-blue-400" />,
  guide: <HelpCircle size={11} className="text-yellow-400" />,
};

function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, open]);

  if (!token) return null;

  const updateLastMessage = (updater) => {
    setMessages((prev) => {
      const next = [...prev];
      next[next.length - 1] = updater(next[next.length - 1]);
      return next;
    });
  };

  const ask = async (e) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", text: question },
      { role: "ai", text: "", sources: [] },
    ]);
    setInput("");
    setLoading(true);

    try {
      for await (const { event, data } of streamAsk(question, token)) {
        if (event === "sources") {
          updateLastMessage((m) => ({ ...m, sources: data.sources }));
        } else if (event === "chunk") {
          updateLastMessage((m) => ({ ...m, text: m.text + data.text }));
        } else if (event === "error") {
          updateLastMessage((m) => ({ ...m, text: data.message || "Something went wrong." }));
        }
      }
    } catch {
      updateLastMessage((m) => ({
        ...m,
        text: m.text || "Something went wrong — please try again.",
      }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Launcher bubble */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-5 right-5 z-[998] w-14 h-14 rounded-full bg-green-500 hover:bg-green-600 text-slate-950 shadow-2xl flex items-center justify-center transition"
        aria-label="Open AI chat"
      >
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed z-[997] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{
            bottom: "88px",
            right: "20px",
            width: "min(380px, calc(100vw - 32px))",
            height: "min(560px, calc(100vh - 140px))",
          }}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900 flex-shrink-0">
            <Sparkles size={16} className="text-green-400" />
            <p className="font-bold text-white text-sm">TradeMind AI Assistant</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-10 px-2">
                <Bot size={32} className="text-slate-700 mx-auto mb-3" />
                <p className="text-slate-400 text-sm font-semibold">Ask me anything</p>
                <p className="text-slate-500 text-xs mt-1.5 leading-relaxed">
                  Your trades, your books, or how to use the app — even general trading questions.
                </p>
              </div>
            )}

            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const isStreamingEmpty = m.role === "ai" && isLast && loading && !m.text;
              return (
                <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "ai" && (
                    <div className="w-6 h-6 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot size={12} className="text-green-400" />
                    </div>
                  )}
                  <div className="max-w-[82%]">
                    <div
                      className={`rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                        m.role === "user"
                          ? "bg-green-500 text-slate-950 font-medium"
                          : "bg-slate-800 text-slate-200"
                      }`}
                    >
                      {isStreamingEmpty ? (
                        <div className="flex gap-1 py-0.5">
                          <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                          <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                          <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" />
                        </div>
                      ) : (
                        <>
                          {m.text}
                          {m.role === "ai" && isLast && loading && (
                            <span className="inline-block w-1 h-3 bg-green-400 ml-0.5 align-middle animate-pulse" />
                          )}
                        </>
                      )}
                    </div>
                    {m.sources?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {m.sources.slice(0, 4).map((s, si) => (
                          <span
                            key={si}
                            title={s.snippet}
                            className="inline-flex items-center gap-1 text-[10px] bg-slate-800/70 border border-slate-700 text-slate-500 px-1.5 py-0.5 rounded"
                          >
                            {SOURCE_ICONS[s.source] || <BookOpen size={11} />}
                            {s.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {m.role === "user" && (
                    <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User size={12} className="text-slate-400" />
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={ask} className="border-t border-slate-800 p-3 flex gap-2 flex-shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-green-500"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex items-center justify-center bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 rounded-xl px-3.5 transition flex-shrink-0"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export default ChatWidget;
