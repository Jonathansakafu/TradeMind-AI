import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import commonEn from "./locales/en/common.json";
import commonSw from "./locales/sw/common.json";
import commonFr from "./locales/fr/common.json";
import commonAr from "./locales/ar/common.json";

import authEn from "./locales/en/auth.json";
import authSw from "./locales/sw/auth.json";
import authFr from "./locales/fr/auth.json";
import authAr from "./locales/ar/auth.json";

import dashboardEn from "./locales/en/dashboard.json";
import dashboardSw from "./locales/sw/dashboard.json";
import dashboardFr from "./locales/fr/dashboard.json";
import dashboardAr from "./locales/ar/dashboard.json";

import settingsEn from "./locales/en/settings.json";
import settingsSw from "./locales/sw/settings.json";
import settingsFr from "./locales/fr/settings.json";
import settingsAr from "./locales/ar/settings.json";

export const RTL_LANGUAGES = ["ar"];

const resources = {
  en: { common: commonEn, auth: authEn, dashboard: dashboardEn, settings: settingsEn },
  sw: { common: commonSw, auth: authSw, dashboard: dashboardSw, settings: settingsSw },
  fr: { common: commonFr, auth: authFr, dashboard: dashboardFr, settings: settingsFr },
  ar: { common: commonAr, auth: authAr, dashboard: dashboardAr, settings: settingsAr },
};

function applyDirection(lng) {
  document.documentElement.dir = RTL_LANGUAGES.includes(lng) ? "rtl" : "ltr";
  document.documentElement.lang = lng;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: ["en", "sw", "fr", "ar"],
    ns: ["common", "auth", "dashboard", "settings"],
    defaultNS: "common",
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "language",
    },
    interpolation: { escapeValue: false },
  });

applyDirection(i18n.resolvedLanguage || "en");
i18n.on("languageChanged", applyDirection);

export default i18n;
