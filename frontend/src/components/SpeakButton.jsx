import { Volume2, VolumeX } from "lucide-react";
import useSpeech from "../hooks/useSpeech";

// Reusable "read this aloud" icon button. Renders nothing if the device
// doesn't support speech synthesis at all, rather than showing a dead button.
function SpeakButton({ text, className = "", size = 16 }) {
  const { speak, stop, speaking, isSupported } = useSpeech();

  if (!isSupported || !text) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        speaking ? stop() : speak(text);
      }}
      aria-label={speaking ? "Stop reading aloud" : "Read aloud"}
      className={`p-2 -m-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-green-600 dark:hover:text-green-400 transition flex-shrink-0 ${
        speaking ? "text-green-600 dark:text-green-400 animate-pulse" : ""
      } ${className}`}
    >
      {speaking ? <VolumeX size={size} /> : <Volume2 size={size} />}
    </button>
  );
}

export default SpeakButton;
