import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Download, Copy, Check } from "lucide-react";
import { checkForUpdate, ANDROID_APK_URL } from "../utils/checkForUpdate";

// Settings > Android app: download / update the app straight from the
// browser (TradeMind's own /download link) with install steps.
const isApp = Capacitor.getPlatform() === "android";
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const onAndroid = /Android/i.test(ua);
const onIPhone = /iPhone|iPad|iPod/i.test(ua);
const SHORT_LINK = "trade-mind-ai-seven.vercel.app/download";
const builtSha = import.meta.env.VITE_APP_BUILD_SHA;

function AppDownloadSettings() {
  const [update, setUpdate] = useState(undefined); // undefined = checking, null = up to date
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isApp) return;
    checkForUpdate().then(setUpdate).catch(() => setUpdate(null));
  }, []);

  const download = (e) => {
    if (!isApp) return; // plain link: the browser downloads it
    e.preventDefault();
    Browser.open({ url: ANDROID_APK_URL });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`https://${SHORT_LINK}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };

  if (onIPhone && !isApp) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-300">
        The TradeMind app is for Android phones. On iPhone, open this site in Safari, tap <b>Share</b> → <b>Add to Home Screen</b> — it then opens like an app.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {isApp ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {update === undefined ? "Checking for updates…" : update ? <><b className="text-green-700 dark:text-green-400">A new version is available.</b> Download it and install over this one — you stay logged in.</> : <>✓ You have the latest version.</>}
          {builtSha && <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">This version: {builtSha.slice(0, 7)}</span>}
        </p>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Get TradeMind as an app on your Android phone — alerts pop up like WhatsApp, plus "Hey TradeMind" voice.
        </p>
      )}

      <a href={ANDROID_APK_URL} onClick={download} download="trademind-ai.apk"
        className="flex items-center justify-center gap-2 w-full bg-green-500 hover:bg-green-600 text-slate-950 font-semibold text-sm px-4 py-3 rounded-xl transition">
        <Download size={16} /> {isApp ? (update ? "Download update" : "Download again") : "Download for Android"} <span className="font-normal opacity-70">· ~70 MB</span>
      </a>

      {!onAndroid && !isApp && (
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-3">
          <p className="flex-1 min-w-0 text-xs text-slate-600 dark:text-slate-300">
            On your phone, open <b className="break-all text-slate-900 dark:text-white">{SHORT_LINK}</b>
          </p>
          <button onClick={copy} aria-label="Copy link" className="flex-shrink-0 p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700">
            {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
          </button>
        </div>
      )}

      <ol className="list-decimal ps-5 space-y-1 text-xs text-slate-600 dark:text-slate-400">
        <li>Tap <b>Download</b> and wait for it to finish.</li>
        <li>Open <b>trademind-ai.apk</b> from the notification or your Downloads.</li>
        <li>If asked, allow <b>Install unknown apps</b> for your browser, then go back.</li>
        <li>Tap <b>{isApp ? "Update" : "Install"}</b>.</li>
      </ol>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Not on the Play Store yet, so Android shows a warning — that's normal for apps installed directly.
      </p>
    </div>
  );
}

export default AppDownloadSettings;
