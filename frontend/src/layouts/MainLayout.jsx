import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, PlusCircle, History,
  BarChart2, LineChart, Settings, LogOut,
  Zap, Menu, X, Newspaper, Bell, Bot, Sparkles, BookOpen
} from "lucide-react";
import NotificationBell from "../components/NotificationBell";
import ChatWidget from "../components/ChatWidget";

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/add-trade", label: "Add Trade", icon: PlusCircle },
  { path: "/history", label: "Trade History", icon: History },
  { path: "/analytics", label: "AI Analytics", icon: BarChart2 },
  { path: "/ask-ai", label: "Ask AI", icon: Sparkles },
  { path: "/live", label: "Live Analysis", icon: Zap },
  { path: "/mt5", label: "MT5 Auto Trade", icon: Bot },
  { path: "/news", label: "Forex News", icon: Newspaper },
  { path: "/notifications", label: "Notifications", icon: Bell },
  { path: "/charts", label: "Live Charts", icon: LineChart },
  { path: "/guide", label: "User Guide", icon: BookOpen },
  { path: "/settings", label: "Settings", icon: Settings },
];

// Hoisted out of MainLayout so it isn't redefined (and its two instances
// aren't recreated from scratch) on every MainLayout render.
function SidebarContent({ pathname, onNavigate, onClose, user, onLogout }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-8 px-2">
        <h1 className="text-xl font-bold text-green-400">TradeMind AI</h1>
        <button
          onClick={onClose}
          className="md:hidden text-slate-400 hover:text-white"
        >
          <X size={20} />
        </button>
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map(({ path, label, icon: Icon }) => {
          const isActive = pathname === path;
          return (
            <Link
              key={path}
              to={path}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                isActive
                  ? "bg-green-500/10 text-green-400"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Icon size={18} />
              {label}
              {path === "/live" && (
                <span className="ml-auto text-xs bg-green-500 text-slate-950 px-1.5 py-0.5 rounded-md font-bold">
                  LIVE
                </span>
              )}
              {path === "/mt5" && (
                <span className="ml-auto text-xs bg-yellow-500 text-slate-950 px-1.5 py-0.5 rounded-md font-bold">
                  AUTO
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 pt-4">
        <div className="flex items-center gap-3 px-2 mb-3">
          <div className="w-9 h-9 rounded-full bg-green-500 flex items-center justify-center text-slate-950 font-bold flex-shrink-0">
            {user?.name?.[0]?.toUpperCase() || "T"}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-semibold truncate">{user?.name || "Trader"}</p>
            <p className="text-xs text-slate-500 truncate">{user?.email || ""}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
        >
          <LogOut size={18} /> Logout
        </button>
      </div>
    </div>
  );
}

function MainLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex overflow-x-hidden">
      <div className="fixed top-3 right-3 md:top-4 md:right-4 z-40">
        <NotificationBell />
      </div>
      <ChatWidget />

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={closeSidebar}
        />
      )}

      <aside className="hidden md:flex flex-col w-64 bg-slate-900 border-r border-slate-800 fixed h-full z-30 p-6">
        <SidebarContent
          pathname={location.pathname}
          onNavigate={closeSidebar}
          onClose={closeSidebar}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      <aside className={`md:hidden fixed top-0 left-0 h-full w-72 bg-slate-900 border-r border-slate-800 z-50 p-6 transform transition-transform duration-300 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}>
        <SidebarContent
          pathname={location.pathname}
          onNavigate={closeSidebar}
          onClose={closeSidebar}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      <div className="flex-1 min-w-0 md:ml-64 flex flex-col min-h-screen">
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 sticky top-0 z-20">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-400 hover:text-white transition"
          >
            <Menu size={22} />
          </button>
          <h1 className="text-lg font-bold text-green-400">TradeMind AI</h1>
          <span className="w-[22px]" aria-hidden="true" />
        </div>

        <main className="flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

export default MainLayout;
