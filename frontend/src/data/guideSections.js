// Mirrors frontend/backend/data/userGuide.js content — kept in sync
// manually since the backend (CommonJS) and frontend (ESM/Vite) builds
// don't share a module graph. This copy renders the Guide page; the
// backend copy gets embedded for the AI chatbot to reference.
export const GUIDE_SECTIONS = [
  {
    id: "getting-started",
    title: "Getting Started",
    body: `Create an account from the Register page with a username, email, and password. Once registered you're logged in automatically and taken to the Dashboard. Use the Login page afterwards with your email and password. Your session is stored as a token in your browser — logging out clears it. If the app feels slow the very first time you use it after it's been idle, that's normal: the free-tier backend server "wakes up" from sleep, which can take up to a minute.`,
  },
  {
    id: "dashboard",
    title: "Dashboard",
    body: `The Dashboard shows your trading stats at a glance: total trades, wins, losses, and win rate. The Total Profit/Loss card is hidden by default (click the eye icon to reveal it) so your numbers aren't visible over someone's shoulder. The live price ticker shows real-time forex and crypto prices scrolling across the top. The Recent Trades table shows your last few trades with a link to the full Trade History. The "Open MT5" button lets you pick a broker (including JustMarkets, Exness, ICMarkets, XM, and others) to download the MetaTrader 5 platform.`,
  },
  {
    id: "add-trade",
    title: "Adding a Trade",
    body: `Go to Add Trade to log a new trade: pick the currency pair, direction (buy/sell), entry price, stop loss, take profit, and lot size. You can also record the trading session (London, New York, Tokyo, Sydney, or Overlap) and your setup/strategy name. Optionally attach a screenshot of your chart. Once you close a trade, fill in the exit price and outcome (win/loss/breakeven) so it counts correctly in your stats and win rate.`,
  },
  {
    id: "trade-history",
    title: "Trade History",
    body: `Trade History lists every trade you've logged, with filters by pair, outcome, and status. You can search, sort, and edit or delete past trades here. This is also the data the AI uses (via retrieval-augmented generation) to answer questions about your own trading patterns.`,
  },
  {
    id: "ai-analytics",
    title: "AI Analytics",
    body: `The AI Analytics page runs pattern detection across your trade history — it surfaces your best/worst trading sessions, strongest and weakest pairs, and risk behaviors worth watching. You can also upload trading books or strategy PDFs here: TradeMind AI extracts concepts, strategies, and rules from them and indexes the full text so future AI analysis and the Ask AI chatbot can reference your own books, not just generic advice.`,
  },
  {
    id: "ask-ai",
    title: "Ask AI",
    body: `Ask AI is a chat page where you can ask questions in plain language — about your own trades ("how have my XAUUSD trades performed"), your uploaded books ("what does my book say about breakout entries"), or general trading concepts. Answers are grounded in your actual data when relevant, with sources cited under the answer. There's also a floating chat bubble available on every page for quick questions without navigating away.`,
  },
  {
    id: "live-analysis",
    title: "Live Analysis",
    body: `Live Analysis shows real-time price data and lets you request an AI trading signal (buy/sell/wait) for a chosen pair, combining current price action, your trade history, uploaded book strategies, and recent news. From a signal you can record the trade manually or send it directly to MT5 for automated execution.`,
  },
  {
    id: "mt5-auto-trading",
    title: "MT5 Auto Trading",
    body: `The MT5 page connects TradeMind AI to MetaTrader 5 through an Expert Advisor (EA) that you install in your MT5 terminal. Steps: (1) pick a broker and download MT5, (2) set your default lot size, (3) copy the provided EA code into MT5's MetaEditor, (4) allow WebRequests to your TradeMind AI server URL in MT5's options, (5) the EA polls for new signals every 10 seconds and executes them automatically. Before sending any signal, choose whether you're operating a Demo or Real account using the toggle at the top of the page — this is a safety setting: Demo signals are for practice, Real signals affect real funds. Every signal sent and in your Signal History is tagged Demo or Real so you always know which account it was intended for.`,
  },
  {
    id: "notifications",
    title: "Notifications",
    body: `TradeMind AI automatically generates trading signal notifications in the background (roughly every 2 hours) by analyzing crypto and forex pairs against your trade history, uploaded books, and news. Open the notification bell to see them, mark as read, or send a signal straight to MT5 or convert it into a logged trade.`,
  },
  {
    id: "news",
    title: "Forex News",
    body: `The News page shows recent forex and market news with AI-generated sentiment (bullish/bearish/neutral) and impact analysis per currency pair.`,
  },
  {
    id: "charts",
    title: "Live Charts",
    body: `Charts shows live candlestick price charts for your selected pair with your open trades' entry, stop loss, and take profit levels overlaid.`,
  },
  {
    id: "settings",
    title: "Settings",
    body: `Update your profile and password from Settings.`,
  },
];
