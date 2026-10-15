import { useState } from "react";
import { Copy, Check, Loader2, Share2 } from "lucide-react";
import { copyImage, blobFromUrl, blobFromElement } from "../utils/copyImage";
import { useTheme } from "../hooks/useTheme";

// "Copy" for any chart or screenshot: pass url (a picture), getBlob (e.g.
// a chart's capture()) or targetRef (any element on the page).
function CopyImageButton({ url, getBlob, targetRef, name, className = "", label = false, dark: forceDark }) {
  const { theme } = useTheme();
  const [state, setState] = useState("idle"); // idle | busy | copied | shared | failed
  const bg = (forceDark ?? theme === "dark") ? "#0b1220" : "#ffffff";

  const run = async (e) => {
    e.stopPropagation();
    setState("busy");
    try {
      const make = getBlob || (url ? () => blobFromUrl(url) : () => blobFromElement(targetRef.current, bg));
      setState(await copyImage(make, name));
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2200);
  };

  const icon = state === "busy" ? <Loader2 size={16} className="animate-spin" />
    : state === "copied" ? <Check size={16} className="text-green-500" />
    : state === "shared" ? <Share2 size={16} />
    : <Copy size={16} />;
  const text = { copied: "Copied", shared: "Shared", failed: "Couldn't copy" }[state] || "Copy";

  return (
    <button type="button" onClick={run} disabled={state === "busy"} aria-label={state === "idle" ? "Copy picture" : text} title="Copy picture"
      className={`inline-flex items-center gap-1.5 ${className || "p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"}`}>
      {icon}{(label || state !== "idle") && <span className="text-xs font-semibold">{text}</span>}
    </button>
  );
}

export default CopyImageButton;
