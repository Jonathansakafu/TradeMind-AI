// Splits text into paragraph-aware chunks of roughly chunkSize chars,
// prefixing each chunk (after the first) with a tail overlap of the previous
// one so semantic context isn't lost at chunk boundaries.
const chunkText = (text, { chunkSize = 900, overlap = 150 } = {}) => {
  const clean = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  const flush = () => {
    if (current.trim().length > 20) chunks.push(current.trim());
    current = "";
  };

  const splitLongParagraph = (paragraph) => {
    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    let piece = "";
    for (const sentence of sentences) {
      if (piece && (piece + " " + sentence).length > chunkSize) {
        chunks.push(piece.trim());
        piece = sentence;
      } else {
        piece = piece ? `${piece} ${sentence}` : sentence;
      }
    }
    return piece;
  };

  for (const paragraph of paragraphs) {
    if ((current ? current.length + 2 : 0) + paragraph.length <= chunkSize) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    flush();
    if (paragraph.length > chunkSize) {
      current = splitLongParagraph(paragraph);
    } else {
      current = paragraph;
    }
  }
  flush();

  if (overlap > 0) {
    for (let i = chunks.length - 1; i > 0; i--) {
      const prevTail = chunks[i - 1].slice(-overlap);
      chunks[i] = `${prevTail} ${chunks[i]}`;
    }
  }

  return chunks;
};

module.exports = { chunkText };
