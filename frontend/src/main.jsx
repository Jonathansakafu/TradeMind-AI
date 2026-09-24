import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import "./index.css";
import "./i18n";
import App from "./App";

// No timeout was set anywhere in this app -- every axios call (login
// included) would wait indefinitely if a response never came back, which
// is exactly "loads forever, no error, nothing" with zero way to recover
// short of reloading the page. 60s is generous enough to survive a Render
// free-tier cold start (documented elsewhere in this app as 30-60s) while
// still guaranteeing every request eventually fails loudly -- existing
// catch blocks across the app already show a real error message on a
// rejected promise (a timeout rejects with no `error.response`, which
// every call site's `error.response?.data?.message || fallback` already
// handles correctly), they just never got the chance to run before this.
axios.defaults.timeout = 60000;

if (Capacitor.isNativePlatform()) {
  SplashScreen.hide();
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);