import { Capacitor, registerPlugin } from "@capacitor/core";

// "Hey TradeMind" wake word -- Android app only (native WakeWordService:
// offline Vosk recogniser in a background service). Browsers and iPhones
// can't listen with the app closed, so everything here is a no-op there.

export const wakeWordSupported = Capacitor.getPlatform() === "android";
const WakeWord = wakeWordSupported ? registerPlugin("WakeWord") : null;

export const wakeStatus = () => (WakeWord ? WakeWord.status() : Promise.resolve(null));
export const startWake = () => WakeWord.start();
export const stopWake = () => WakeWord.stop();
export const openOverlaySettings = () => WakeWord?.openOverlaySettings();
export const openBatterySettings = () => WakeWord?.openBatterySettings();

// Hand the microphone to the app's own voice typing and take it back after.
export const pauseWake = () => (WakeWord ? WakeWord.pause().catch(() => {}) : Promise.resolve());
export const resumeWake = () => (WakeWord ? WakeWord.resume().catch(() => {}) : Promise.resolve());

// Called when the phrase is heard (also on a cold start opened by it).
export function onWake(cb) {
  if (!WakeWord) return () => {};
  const handle = WakeWord.addListener("wake", cb);
  return () => { handle.then((h) => h.remove()).catch(() => {}); };
}
