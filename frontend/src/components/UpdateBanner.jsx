import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Download, X } from "lucide-react";
import { checkForUpdate, ANDROID_APK_URL } from "../utils/checkForUpdate";

const DISMISSED_KEY = "tm_update_dismissed_sha";

// Sideloaded Android apps have no auto-update mechanism at all -- this is
// the app telling the user directly when the code they're running is
// behind main, instead of them silently testing stale builds and wrongly
// concluding a shipped fix "didn't work."
function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    checkForUpdate().then((info) => {
      if (cancelled || !info) return;
      const dismissedSha = localStorage.getItem(DISMISSED_KEY);
      if (dismissedSha === info.latestSha) {
        setDismissed(true);
      }
      setUpdateInfo(info);
    });
    return () => { cancelled = true; };
  }, []);

  if (!updateInfo || dismissed) return null;

  const openDownload = () => {
    Browser.open({ url: ANDROID_APK_URL });
  };

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, updateInfo.latestSha);
    setDismissed(true);
  };

  return (
    // Bottom floating card rather than a top bar: at the top it covered the
    // app's header (menu + bell) and sat under the phone's status bar.
    // right: leaves room for the floating AI chat button.
    <div
      role="status"
      className="fixed z-[1000] left-3 right-[5.5rem] flex items-center gap-2 rounded-2xl bg-green-500 text-slate-950 shadow-2xl px-3 py-2.5 text-sm font-semibold"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
    >
      <span className="flex-1 min-w-0 leading-tight">Update available</span>
      <button
        onClick={openDownload}
        className="flex items-center gap-1.5 bg-slate-950 text-white px-3 py-1.5 rounded-lg flex-shrink-0"
      >
        <Download size={13} /> Install
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="p-1 -m-1 flex-shrink-0">
        <X size={16} />
      </button>
    </div>
  );
}

export default UpdateBanner;
