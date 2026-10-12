// Turns app text (signals, AI answers, plans) into something a speech
// engine reads naturally: no emoji or symbols ("red circle", "check mark"
// were being read aloud), trading shorthand spelled out, and split into
// sentence-sized chunks -- Chrome's speech engine silently stops long
// single utterances after ~15 seconds.

const REPLACEMENTS = [
  [/\bR:R\b|\brisk\s*:\s*reward\b/gi, "risk to reward"],
  // Ratios are written "1 : 2.1" (spaces); clock times "12:30" are not.
  [/(\d+(?:\.\d+)?)\s+:\s+(\d+(?:\.\d+)?)/g, "$1 to $2"],
  [/\bSL\b/g, "stop loss"],
  [/\bTP\b/g, "take profit"],
  [/\bBOS\b/g, "break of structure"],
  [/\bCHoCH\b/gi, "change of character"],
  [/\bATR\b/g, "average true range"],
  [/\bUTC\b/g, "U T C"],
  [/\bEAT\b/g, "East Africa time"],
  [/\bXAUUSD\b/g, "gold"],
  [/\b(EUR|GBP|USD)(USD|JPY|CHF)\b/g, "$1 $2"],
  [/(\d)\s*R\b/g, "$1 R"],
  [/→|->/g, " to "],
  [/±/g, "plus or minus "],
  [/≥/g, " at least "],
  [/≤/g, " at most "],
  [/[•·|]/g, ". "],
  [/[—–]/g, ", "],
];

// Emoji, pictographs, arrows and similar symbols.
const SYMBOLS = /\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|[←-⇿☀-➿]/gu;

export function cleanForSpeech(text) {
  let t = String(text || "");
  for (const [re, rep] of REPLACEMENTS) t = t.replace(re, rep);
  t = t.replace(SYMBOLS, " ");
  t = t.replace(/[*_#`>[\]]/g, " "); // markdown leftovers
  t = t.replace(/\n+/g, ". ")
    .replace(/\s*[:;,]\s*\./g, ".")      // "Rule check:." -> "Rule check."
    .replace(/\s+([.,])/g, "$1")           // "gold . 72%" -> "gold. 72%"
    .replace(/\.(\s*\.)+/g, ".")          // repeated full stops
    .replace(/\s{2,}/g, " ");
  return t.trim();
}

// Sentence-ish chunks of at most ~200 characters.
export function speechChunks(text, max = 200) {
  const sentences = cleanForSpeech(text).match(/[^.!?]+[.!?]*/g) || [];
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if ((cur + " " + piece).length > max && cur) {
      chunks.push(cur);
      cur = piece;
    } else {
      cur = cur ? `${cur} ${piece}` : piece;
    }
  }
  if (cur) chunks.push(cur);
  // A single very long sentence still gets split on commas / spaces.
  return chunks.flatMap((c) => (c.length <= max * 1.5 ? [c] : c.match(new RegExp(`.{1,${max}}(\\s|$)`, "g")) || [c]));
}
