import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard, PlusCircle, History,
  BarChart2, LineChart, Settings, LogOut,
  Zap, Menu, X, Newspaper, Bell, Bot, Sparkles, BookOpen, Target, Webhook, PieChart
} from "lucide-react";
import NotificationBell from "../components/NotificationBell";
import ChatWidget from "../components/ChatWidget";
import ThemeToggle from "../components/ThemeToggle";
import { useAuth } from "../hooks/useAuth";

const navItems = [
  { path: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { path: "/add-trade", labelKey: "nav.addTrade", icon: PlusCircle },
  { path: "/history", labelKey: "nav.tradeHistory", icon: History },
  { path: "/performance", labelKey: "nav.performance", icon: PieChart },
  { path: "/analytics", labelKey: "nav.aiAnalytics", icon: BarChart2 },
  { path: "/ask-ai", labelKey: "nav.askAI", icon: Sparkles },
  { path: "/live", labelKey: "nav.liveAnalysis", icon: Zap },
  { path: "/mt5", labelKey: "nav.mt5AutoTrade", icon: Bot },
  { path: "/tradingview", labelKey: "nav.tradingView", icon: Webhook },
  { path: "/session", labelKey: "nav.tradingRobot", icon: Target },
  { path: "/news", labelKey: "nav.forexNews", icon: Newspaper },
  { path: "/notifications", labelKey: "nav.notifications", icon: Bell },
  { path: "/charts", labelKey: "nav.liveCharts", icon: LineChart },
  { path: "/guide", labelKey: "nav.userGuide", icon: BookOpen },
  { path: "/settings", labelKey: "nav.settings", icon: Settings },
];

// Hoisted out of MainLayout so it isn't redefined (and its two instances
// aren't recreated from scratch) on every MainLayout render.
function SidebarContent({ pathname, onNavigate, onClose, user, onLogout }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col min-h-full">
      <div className="flex items-center justify-between mb-8 px-2">
        <h1 className="text-xl font-bold text-green-500 dark:text-green-400">{t("appName")}</h1>
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="md:hidden p-2 -m-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        >
          <X size={20} />
        </button>
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map(({ path, labelKey, icon: Icon }) => {
          const isActive = pathname === path;
          return (
            <Link
              key={path}
              to={path}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                isActive
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <Icon size={18} />
              {t(labelKey)}
              {path === "/live" && (
                <span className="ml-auto text-xs bg-green-500 text-slate-950 px-1.5 py-0.5 rounded-md font-bold">
                  {t("nav.live")}
                </span>
              )}
              {path === "/mt5" && (
                <span className="ml-auto text-xs bg-yellow-500 text-slate-950 px-1.5 py-0.5 rounded-md font-bold">
                  {t("nav.auto")}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
        <div className="flex items-center gap-3 px-2 mb-3">
          <div className="w-9 h-9 rounded-full bg-green-500 flex items-center justify-center text-slate-950 font-bold flex-shrink-0">
            {user?.name?.[0]?.toUpperCase() || "T"}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-semibold truncate">{user?.name || "Trader"}</p>
            <p className="text-xs text-slate-500 dark:text-slate-500 truncate">{user?.email || ""}</p>
          </div>
        </div>
        <ThemeToggle variant="inline" />
        <button
          onClick={onLogout}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm text-slate-500 dark:text-slate-400 hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
        >
          <LogOut size={18} /> {t("nav.logout")}
        </button>
      </div>
    </div>
  );
}

function MainLayout({ children }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const closeSidebar = () => setSidebarOpen(false);

  // While the mobile menu is open, freeze the page behind it -- otherwise a
  // swipe on the menu (or the dimmed backdrop) scrolled the whole page.
  useEffect(() => {
    if (!sidebarOpen) return;
    const html = document.documentElement;
    const prev = { html: html.style.overflow, body: document.body.style.overflow };
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev.html;
      document.body.style.overflow = prev.body;
    };
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-white flex overflow-x-hidden">
      {/* Safe-area-aware on mobile: the native status bar sits over the
          WebView (no visible border between them), so a plain top-3 here
          rendered this button partly behind the clock/signal icons on a
          real device -- invisible in a browser tab, which has no status
          bar to collide with. */}
      <div
        className="fixed right-3 md:top-4 md:right-4 z-40"
        style={{ top: "max(0.75rem, calc(env(safe-area-inset-top) + 0.25rem))" }}
      >
        <NotificationBell />
      </div>
      <ChatWidget />

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden touch-none"
          onClick={closeSidebar}
        />
      )}

      <aside className="hidden md:flex flex-col w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 fixed h-full z-30 p-6 overflow-y-auto overscroll-contain">
        <SidebarContent
          pathname={location.pathname}
          onNavigate={closeSidebar}
          onClose={closeSidebar}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      <aside
        className={`md:hidden fixed top-0 left-0 h-full w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-50 p-6 overflow-y-auto overscroll-contain transform transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          paddingTop: "calc(1.5rem + env(safe-area-inset-top))",
          paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
        }}
      >
        <SidebarContent
          pathname={location.pathname}
          onNavigate={closeSidebar}
          onClose={closeSidebar}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      <div className="flex-1 min-w-0 md:ml-64 flex flex-col min-h-screen">
        {/* `fixed` instead of `sticky`: the header stayed in the document
            flow under `sticky`, which on Android's WebView could visibly
            shift/glitch during the elastic overscroll bounce at the top of
            the page. `fixed` anchors it to the viewport unconditionally, so
            it never moves regardless of scroll or bounce. Positioned below
            the status bar via `top` (not padding), so its own height stays
            fixed and predictable for the spacer padding on <main> below. */}
        <div
          className="md:hidden fixed left-0 right-0 z-20 h-14 flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800"
          style={{ top: "env(safe-area-inset-top)" }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="p-2 -m-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
          >
            <Menu size={22} />
          </button>
          <h1 className="text-lg font-bold text-green-500 dark:text-green-400">{t("appName")}</h1>
          <span className="w-[22px]" aria-hidden="true" />
        </div>

        {/* md:pr-24 reserves room for the fixed notification bell (top-right,
            desktop/tablet) -- page headers' right-aligned buttons (e.g. the
            Dashboard's Add Trade) were sliding underneath it. On phones
            the bell sits in the top bar instead, so no extra space is needed. */}
        <main
          className="flex-1 p-4 pt-[calc(3.5rem+env(safe-area-inset-top)+1rem)] md:p-8 md:pr-24"
          style={{ paddingBottom: "max(1rem, calc(env(safe-area-inset-bottom) + 0.5rem))" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export default MainLayout;
