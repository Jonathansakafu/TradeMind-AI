import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { wakeWordSupported, wakeStatus, startWake, stopWake, openOverlaySettings, openBatterySettings, getWakePrefs, setWakePrefs } from "../utils/wakeWord";

// Settings card for the "Hey TradeMind" wake word (Android app only).
const STATE_TEXT = {
  listening: "✓ Listening — say \"Hey TradeMind\" any time.",
  loading: "Getting ready (first time takes a few seconds)…",
  paused: "Paused while you talk to TradeMind AI.",
  off: "Off.",
};

function WakeWordSettings() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [prefs, setPrefs] = useState(getWakePrefs);
  const choose = (patch) => setPrefs(setWakePrefs(patch));

  const refresh = useCallback(() => { wakeStatus().then(setS).catch(() => {}); }, []);

  // Re-check when coming back from Android's settings screens, and while
  // the model is still loading.
  useEffect(() => {
    if (!wakeWordSupported) return undefined;
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(refresh, 3000);
    return () => { document.removeEventListener("visibilitychange", onVisible); clearInterval(id); };
  }, [refresh]);

  if (!wakeWordSupported) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-300">
        "Hey TradeMind" works in the <b>Android app</b> only — browsers and iPhones don't let apps listen in the background.
        On iPhone you can say <b>"Hey Siri, open TradeMind"</b>; on any Android phone <b>"Hey Google, open TradeMind"</b>.
      </p>
    );
  }

  const toggle = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setS(s?.enabled ? await stopWake() : await startWake());
    } catch (err) {
      setMsg(err?.message || "Couldn't change it — try again.");
    } finally {
      setBusy(false);
    }
  };

  const on = !!s?.enabled;
  const row = "flex items-start justify-between gap-3 rounded-xl bg-slate-100 dark:bg-slate-800 p-3";
  const fixBtn = "flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-slate-950";

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Say <b>"Hey TradeMind"</b> — even with the app closed or the screen off — then ask your question, e.g. "How was my performance last month?".
        It answers from your own trades and says where the information comes from. Listening for the name happens on your phone (offline); your question needs internet.
      </p>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Hey TradeMind</p>
          <p className={`text-xs ${s?.state === "error" ? "text-amber-700 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"}`}>
            {on ? (s?.state === "error" ? s.error : STATE_TEXT[s?.running ? s.state : "loading"] || "") : "Off"}
          </p>
        </div>
        <button onClick={toggle} disabled={busy || !s} role="switch" aria-checked={on} aria-label="Hey TradeMind"
          className={`relative flex-shrink-0 w-12 h-7 rounded-full transition disabled:opacity-60 ${on ? "bg-green-500" : "bg-slate-300 dark:bg-slate-600"}`}>
          <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all flex items-center justify-center ${on ? "left-[1.375rem]" : "left-0.5"}`}>
            {busy && <Loader2 size={12} className="animate-spin text-slate-500" />}
          </span>
        </button>
      </div>
      {msg && <p className="text-xs text-red-600 dark:text-red-400">{msg}</p>}

      {on && (
        <div className="space-y-2">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">When I call TradeMind</p>
            <div className="space-y-1.5">
              {[
                ["voice", "Speak the answer", "Orb and answer in a small card over any app — Ask AI never opens"],
                ["text", "Show the answer only", "Same card, silent (for meetings, public places)"],
                ["app", "Open Ask AI", "Opens the app and listens there"],
              ].map(([value, label, hint]) => (
                <button key={value} onClick={() => choose({ response: value })} aria-pressed={prefs.response === value}
                  className={`w-full text-left rounded-xl border px-3 py-2 transition ${prefs.response === value ? "border-green-500 bg-green-500/10" : "border-slate-200 dark:border-slate-700"}`}>
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">{prefs.response === value ? "● " : "○ "}{label}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
                </button>
              ))}
            </div>
          </div>
          {prefs.response !== "app" && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">Card position</p>
              <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
                {[["bottom", "Bottom"], ["top", "Top"]].map(([v, label]) => (
                  <button key={v} onClick={() => choose({ position: v })} aria-pressed={prefs.position === v}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold ${prefs.position === v ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow" : "text-slate-500 dark:text-slate-400"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">It listens and answers in the language picked on Ask AI's 🎤 chip.</p>
          {!s.canOpenOverApps && (
            <div className={row}>
              <p className="text-xs text-slate-700 dark:text-slate-300"><b>{prefs.response === "app" ? "Open by itself" : "Needed for the answer card"}:</b> allow "Display over other apps". {prefs.response === "app" ? "Without it you'll get a notification to tap." : "Until then the answer comes as speech and a notification."}</p>
              <button onClick={openOverlaySettings} className={fixBtn}>Allow</button>
            </div>
          )}
          {!s.batteryUnrestricted && (
            <div className={row}>
              <p className="text-xs text-slate-700 dark:text-slate-300"><b>Keep listening:</b> let TradeMind run without battery limits, or your phone may stop it after a while.</p>
              <button onClick={openBatterySettings} className={fixBtn}>Allow</button>
            </div>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Uses some battery all day; a small "Hey TradeMind" notification shows while it listens (it has a Stop button).
            On a locked phone you'll get a notification — unlock to ask. After restarting the phone, open TradeMind once to switch it back on.
          </p>
        </div>
      )}
    </div>
  );
}

export default WakeWordSettings;
