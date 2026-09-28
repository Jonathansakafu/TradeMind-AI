import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_URL } from "../config/api";
import { streamAsk } from "../utils/streamAsk";
import { useAuth } from "./useAuth";

// Shared by the Ask AI page and the floating ChatWidget. Conversations are
// saved server-side (models/ChatConversation.js); the active one's id is
// remembered per screen (storageKey) so reopening the app resumes it.

function readId(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeId(key, id) {
  try {
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch { /* storage unavailable -- resume just won't persist */ }
}

// Server shape -> the { role: "user" | "ai", text, sources } shape the chat UIs render.
const toUiMessages = (messages = []) => messages.map((m) => ({
  role: m.role === "assistant" ? "ai" : "user",
  text: m.content,
  sources: m.sources || [],
  incomplete: !!m.incomplete,
}));

export function useChatConversation(storageKey) {
  const { token, headers } = useAuth();
  const [conversationId, setConversationId] = useState(() => readId(storageKey));
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // Skips re-fetching a conversation that this hook itself just created
  // mid-stream (its messages are already on screen).
  const createdHere = useRef(null);

  useEffect(() => {
    if (!conversationId || !token || createdHere.current === conversationId) return;
    let cancelled = false;
    setRestoring(true);
    axios.get(`${API_URL}/api/ai/conversations/${conversationId}`, { headers })
      .then((res) => { if (!cancelled) setMessages(toUiMessages(res.data.messages)); })
      .catch((err) => {
        if (cancelled) return;
        // Deleted or not ours anymore -- start fresh instead of erroring.
        if (err.response?.status === 404) {
          writeId(storageKey, null);
          setConversationId(null);
          setMessages([]);
        }
      })
      .finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, [conversationId, token, headers, storageKey]);

  const selectConversation = useCallback((id) => {
    createdHere.current = null;
    writeId(storageKey, id);
    setMessages([]);
    setConversationId(id);
  }, [storageKey]);

  const newChat = useCallback(() => selectConversation(null), [selectConversation]);

  const updateLast = (updater) => setMessages((prev) => {
    const next = [...prev];
    next[next.length - 1] = updater(next[next.length - 1]);
    return next;
  });

  const ask = useCallback(async (question) => {
    if (!question || loading) return;
    setMessages((prev) => [...prev, { role: "user", text: question }, { role: "ai", text: "", sources: [] }]);
    setLoading(true);
    try {
      for await (const { event, data } of streamAsk(question, token, conversationId)) {
        if (event === "conversation") {
          if (data.id !== conversationId) {
            createdHere.current = data.id;
            writeId(storageKey, data.id);
            setConversationId(data.id);
          }
        } else if (event === "sources") {
          updateLast((m) => ({ ...m, sources: data.sources }));
        } else if (event === "chunk") {
          updateLast((m) => ({ ...m, text: m.text + data.text }));
        } else if (event === "error") {
          updateLast((m) => ({ ...m, text: m.text || data.message || "Something went wrong." }));
        }
      }
    } catch {
      updateLast((m) => ({
        ...m,
        text: m.text || "Connection lost — your question was saved. Please try again.",
        incomplete: !!m.text,
      }));
    } finally {
      setLoading(false);
    }
  }, [loading, token, conversationId, storageKey]);

  return { conversationId, messages, loading, restoring, ask, newChat, selectConversation };
}

export async function fetchConversations(headers) {
  const res = await axios.get(`${API_URL}/api/ai/conversations`, { headers });
  return res.data || [];
}

export async function deleteConversation(headers, id) {
  await axios.delete(`${API_URL}/api/ai/conversations/${id}`, { headers });
}
