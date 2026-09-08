# TradeMind AI

**Live:** <https://trade-mind-ai-seven.vercel.app>
**Part of my portfolio:** <https://portfolio-seven-dun-d8pz65t7l6.vercel.app>

An AI-powered forex/crypto trading journal and signal platform. AI-generated
intraday trade signals are fused from live market data, price-action
momentum, and retrieval-augmented generation over the trader's own uploaded
books and chart screenshots (vector search over MongoDB Atlas). Includes a
Chrome extension for auto-trading on Pocket Option and native Android/iOS
apps built with Capacitor.

## Stack

- **Frontend:** React 19, Vite, Tailwind CSS 4
- **Backend:** Express 5, MongoDB (Mongoose)
- **AI:** Groq (signal generation, Ask AI with tool-calling), Gemini Vision (chart screenshot analysis), local embeddings + RAG
- **Mobile:** Capacitor (Android/iOS), Chrome MV3 extension

## Project structure

- `frontend/` — React app + `frontend/backend/` Express API
- `browser-extension/` — Pocket Option auto-trading Chrome extension
- `.github/workflows/` — Android CI (GitHub Actions)
- `codemagic.yaml` — iOS CI (Codemagic)
