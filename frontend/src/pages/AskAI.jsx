import { useState, useRef, useEffect, useCallback } from "react";
import MainLayout from "../layouts/MainLayout";
import { Sparkles, Send, BookOpen, History, HelpCircle, Image, User, Bot, MessageSquarePlus, MessagesSquare, Trash2 } from "lucide-react";
import SpeakButton from "../components/SpeakButton";
import { useAuth } from "../hooks/useAuth";
import { useChatConversation, fetchConversations, deleteConversation } from "../hooks/useChatConversation";

const SOURCE_ICONS = {
  book: <BookOpen size={12} className="text-purple-400" />,
  trade: <History size={12} className="text-blue-400" />,
  guide: <HelpCircle size={12} className="text-yellow-400" />,
  screenshot: <Image size={12} className="text-green-400" />,
};

function AskAI() {
  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState([]);
  const bottomRef = useRef(null);
  const { headers } = useAuth();
  const { conversationId, messages, loading, restoring, ask, newChat, selectConversation } =
    useChatConversation("askAI.conversationId");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const loadConversations = useCallback(() => {
    fetchConversations(headers).then(setConversations).catch(() => {});
  }, [headers]);

  // Refresh the list when it's opened and after each answer (a new chat
  // appears in it once its first question is sent).
  useEffect(() => {
    if (showHistory && !loading) loadConversations();
  }, [showHistory, loading, loadConversations]);

  const askQuestion = (e) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    ask(question);
  };

  const removeConversation = async (id) => {
    await deleteConversation(headers, id).catch(() => {});
    if (id === conversationId) newChat();
    loadConversations();
  };

  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold flex items-center gap-3">
            <Sparkles className="text-green-600 dark:text-green-400" size={32} />
            Ask AI
            <SpeakButton text="Ask AI. Ask questions grounded in your uploaded books and trade history — powered by retrieval-augmented generation" />
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            Ask questions grounded in your uploaded books and trade history — powered by retrieval-augmented generation
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition ${
              showHistory
                ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <MessagesSquare size={16} /> History
          </button>
          <button
            onClick={() => { newChat(); setShowHistory(false); }}
            disabled={loading}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-semibold px-4 py-2.5 rounded-xl text-sm transition"
          >
            <MessageSquarePlus size={16} /> New chat
          </button>
        </div>
      </div>

      {showHistory && (
        <div className="mb-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-2 max-h-64 overflow-y-auto overscroll-contain">
          {conversations.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 p-3">No saved chats yet — your conversations are saved automatically.</p>
          ) : conversations.map((c) => (
            <div
              key={c._id}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
                c._id === conversationId ? "bg-green-500/10" : "hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <button
                onClick={() => { selectConversation(c._id); setShowHistory(false); }}
                disabled={loading}
                className="flex-1 min-w-0 text-left"
              >
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{c.title}</p>
                <p className="text-xs text-slate-400">{new Date(c.updatedAt).toLocaleString()}</p>
              </button>
              <button
                onClick={() => removeConversation(c._id)}
                aria-label="Delete chat"
                className="p-2 text-slate-400 hover:text-red-500 transition"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col h-[65vh]">
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {restoring && messages.length === 0 && (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!restoring && messages.length === 0 && (
            <div className="text-center py-16">
              <Sparkles size={40} className="text-slate-300 dark:text-slate-700 mx-auto mb-4" />
              <p className="text-slate-500 dark:text-slate-400 text-lg font-semibold">Ask anything about your trading</p>
              <p className="text-slate-400 dark:text-slate-500 text-sm mt-2 max-w-md mx-auto">
                e.g. "What does my Wyckoff book say about spring patterns?" or
                "How have my EURUSD London session trades performed?"
              </p>
            </div>
          )}

          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            const isStreamingEmpty = m.role === "ai" && isLast && loading && !m.text;
            return (
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
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                    }`}
                  >
                    {isStreamingEmpty ? (
                      <div className="flex gap-1.5 py-0.5">
                        <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" />
                      </div>
                    ) : (
                      <>
                        {m.text}
                        {m.role === "ai" && isLast && loading && (
                          <span className="inline-block w-1.5 h-4 bg-green-400 ml-0.5 align-middle animate-pulse" />
                        )}
                      </>
                    )}
                  </div>
                  {m.incomplete && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Answer was cut off — ask again to continue.</p>
                  )}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.sources.map((s, si) => (
                        <span
                          key={si}
                          title={s.snippet}
                          className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-500 px-2 py-1 rounded-lg"
                        >
                          {SOURCE_ICONS[s.source] || <BookOpen size={12} />}
                          {s.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.role === "ai" && !isStreamingEmpty && m.text && (
                    <div className="mt-1">
                      <SpeakButton text={m.text} />
                    </div>
                  )}
                </div>
                {m.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 order-2">
                    <User size={16} className="text-slate-500 dark:text-slate-400" />
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={askQuestion} className="border-t border-slate-200 dark:border-slate-800 p-4 flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your books or trade history..."
            className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-green-500"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send message"
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
