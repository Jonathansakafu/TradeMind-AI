// Chat answer text: the AI sometimes uses **bold** (and "## " headings)
// even when asked for plain prose -- show them as bold instead of raw
// asterisks. Everything else stays plain text (whitespace kept by the bubble).
function ChatText({ text }) {
  const lines = String(text || "").split("\n");
  return lines.map((line, li) => {
    const heading = /^#{1,4}\s+/.test(line);
    const body = line.replace(/^#{1,4}\s+/, "");
    const parts = body.split(/\*\*(.+?)\*\*/g);
    return (
      <span key={li}>
        {heading ? <b>{body.replace(/\*\*/g, "")}</b> : parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}
        {li < lines.length - 1 ? "\n" : ""}
      </span>
    );
  });
}

export default ChatText;
