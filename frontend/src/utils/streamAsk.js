import { API_URL } from "../config/api";

// Consumes the /api/ai/ask/stream SSE endpoint. Uses fetch + a manual
// reader rather than EventSource, since EventSource can't send the
// Authorization header or a POST body.
export async function* streamAsk(question, token) {
  const res = await fetch(`${API_URL}/api/ai/ask/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ question }),
  });

  if (!res.ok || !res.body) {
    throw new Error("Stream request failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const eventMatch = rawEvent.match(/^event: (.+)$/m);
      const dataMatch = rawEvent.match(/^data: (.+)$/m);
      if (!eventMatch || !dataMatch) continue;

      yield { event: eventMatch[1], data: JSON.parse(dataMatch[1]) };
    }
  }
}
