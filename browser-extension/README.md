# TradeMind AI — Quick Trade Auto-Execute (browser extension)

Sideloaded Chrome/Edge extension that auto-executes Quick Trade signals on a **Pocket Option demo account only**. It never runs on Real accounts — enforced both by the backend (a bot token is only ever issued for a demo Quick Trade session) and by this extension itself (it re-checks the account-mode indicator on the live page before every trade and refuses to act if it can't confirm Demo).

## Status

**Phase 1 (this code): backend contract, safety gating, and extension skeleton — done and testable.**
**Phase 2: the actual Pocket Option selectors in `selectors.js` — placeholder.** Pocket Option's trading UI is behind login, so its real markup can't be researched without a live, logged-in session. Every selector in `selectors.js` is an educated guess and is expected to need correcting against the real site before trades can actually be placed. Until then, the extension will connect, poll, and correctly report every signal as `"failed"` with a clear reason in the popup's status log — nothing will silently misbehave.

## Install (Developer Mode — this can't go through the Chrome Web Store)

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. Click **Load unpacked**, select this `browser-extension` folder.
3. Open a Pocket Option demo account tab and log in.
4. Click the extension's icon, paste the Session ID and Bot Token shown on the app's Trading Robot page (only appears when you start a Quick Trade session with "Auto-Execute" checked), click Connect.
5. Keep the Pocket Option tab open and visible/focused — Chrome throttles timers in hidden/backgrounded tabs to about once a minute, which is too slow relative to trade expiries.

**After updating the extension** (Reload in `chrome://extensions`), also **refresh any already-open Pocket Option tab** (F5) — the old content script left running in that tab doesn't get the update and becomes unable to talk to the extension at all ("Extension context invalidated" in the console), which otherwise fails silently.

## File map

- `manifest.json` — MV3 config.
- `background.js` — network calls to the backend only (content-script `fetch()` can be constrained by the host page's CSP; background isn't). Also a 1-minute keep-alive alarm that flags a stale content script in the status log.
- `content.js` — owns the real polling loop, the mandatory demo-mode safety gate, and the report-back flow. Runs only on `pocketoption.com`.
- `selectors.js` — **all** Pocket Option DOM knowledge lives here, isolated so Phase 2 fixes never touch polling/safety/reporting logic.
- `popup.html`/`popup.js` — connect/disconnect form and a timestamped status/error log.
