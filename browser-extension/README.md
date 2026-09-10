# TradeMind AI — Quick Trade Auto-Execute (browser extension)

Sideloaded Chrome/Edge extension that auto-executes Quick Trade signals on a **Pocket Option demo account only**. It never runs on Real accounts — enforced both by the backend (a bot token is only ever issued for a demo Quick Trade session) and by this extension itself (it re-checks the account-mode indicator on the live page before every trade and refuses to act if it can't confirm Demo).

## Status

Backend contract, safety gating, and the extension skeleton are done. `selectors.js`'s real Pocket Option markup — demo-mode detection, pair selection, expiry, Buy/Sell, and reading a trade's win/loss result — has been confirmed against the live site and is expected to work.

**One deliberate limitation: the extension does not set your stake amount.** Three different ways of doing that programmatically (direct value assignment, simulated typing, and real clicks on the on-screen number pad) were all tested live and none of them worked — including the number pad's own on-screen total not updating when its buttons were clicked via script, which points to Pocket Option specifically blocking script-triggered clicks on that control. **Set your stake once in Pocket Option before starting a session** — it should stay in place across trades the same way it already does when you trade manually. The extension checks that a real (non-zero) amount is showing before every trade, and refuses with a clear error if it isn't, rather than trading with $0 or an unexpected amount.

## Install (Developer Mode — this can't go through the Chrome Web Store)

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. Click **Load unpacked**, select this `browser-extension` folder.
3. Open a Pocket Option demo account tab and log in.
4. Set your desired stake amount in Pocket Option's own Amount field — the extension won't set this for you (see Status above), so it needs to already be showing the amount you want to trade.
5. Click the extension's icon, paste the Session ID and Bot Token shown on the app's Trading Robot page (only appears when you start a Quick Trade session with "Auto-Execute" checked), click Connect.
6. Keep the Pocket Option tab open and visible/focused — Chrome throttles timers in hidden/backgrounded tabs to about once a minute, which is too slow relative to trade expiries.

**After updating the extension** (Reload in `chrome://extensions`), also **refresh any already-open Pocket Option tab** (F5) — the old content script left running in that tab doesn't get the update and becomes unable to talk to the extension at all ("Extension context invalidated" in the console), which otherwise fails silently.

## File map

- `manifest.json` — MV3 config.
- `background.js` — network calls to the backend only (content-script `fetch()` can be constrained by the host page's CSP; background isn't). Also a 1-minute keep-alive alarm that flags a stale content script in the status log.
- `content.js` — owns the real polling loop, the mandatory demo-mode safety gate, and the report-back flow. Runs only on `pocketoption.com`.
- `selectors.js` — **all** Pocket Option DOM knowledge lives here, isolated so Phase 2 fixes never touch polling/safety/reporting logic.
- `popup.html`/`popup.js` — connect/disconnect form and a timestamped status/error log.
