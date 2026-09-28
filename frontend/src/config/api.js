import { Capacitor } from "@capacitor/core";

// Deployed website: same-origin requests ("/api/..."), which vercel.json
// proxies to the Render backend. Some mobile networks (confirmed for the
// user on mobile data, 2026-09-28) won't reach *.onrender.com directly but
// do reach *.vercel.app -- so the site only ever talks to its own domain.
// The Android/iOS app sets VITE_API_URL to that same Vercel domain in CI
// for the same reason; local dev keeps talking to the backend directly.
const useSameOrigin = import.meta.env.PROD && !Capacitor.isNativePlatform();

export const API_URL = useSameOrigin ? "" : (import.meta.env.VITE_API_URL || "http://localhost:5000");
