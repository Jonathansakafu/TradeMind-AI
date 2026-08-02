// All Pocket Option DOM knowledge lives in this one file so Phase 2 fixes
// (once we have real selectors from the live site) stay localized and never
// touch the polling/safety/reporting logic in content.js.
//
// STATUS: placeholder. Pocket Option's trading UI is behind login, so its
// real markup can't be researched from outside a live, authenticated
// session — these selectors are unverified guesses and are expected to be
// wrong until corrected against the real page. Every function below fails
// closed (returns null/false) rather than guessing, and content.js reports
// "failed" with a clear reason whenever that happens instead of pretending
// to have placed or read a trade.

(function () {
  // Try a list of candidate selectors in order, return the first match.
  function firstMatch(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch {
        // invalid selector, skip
      }
    }
    return null;
  }

  // Confirmed from the live site: <body> carries "is-chart-demo" while on
  // a demo account. The real-account equivalent class hasn't been
  // confirmed yet (not seen live), so this only returns true on a
  // positive demo match — anything else is null (unknown), which
  // content.js treats the same as false. Fail closed, never guess.
  function isDemoMode() {
    const classes = document.body.classList;
    if (classes.contains("is-chart-demo")) return true;
    if (classes.contains("is-chart-live") || classes.contains("is-chart-real")) return false;
    return null;
  }

  // Confirmed from the live site: the Buy/Sell toggle is two
  // ".switch-state-block__item" elements, each containing a
  // ".payout__text" span with the literal text "Buy" or "Sell". Matching
  // on that label text (rather than a fragile positional/CSS-class guess)
  // survives minor markup/styling changes as long as the label stays.
  function findButtonByLabel(label) {
    const items = document.querySelectorAll(".switch-state-block__item");
    for (const item of items) {
      const text = item.querySelector(".payout__text")?.textContent?.trim();
      if (text === label) return item;
    }
    return null;
  }

  function findBuyButton() {
    return findButtonByLabel("Buy");
  }

  function findSellButton() {
    return findButtonByLabel("Sell");
  }

  // Confirmed from the live site: expiry is chosen from a preset list
  // (".dops__timeframes-item", inside ".expiration-inputs-list-modal")
  // labelled S3/S15/S30/M1/M3/M5/M30/H1/H4 — not a free-typed value. Only
  // whole-minute presets are mapped since that's what analyzeQuickSignal
  // returns (expiresInMinutes).
  const EXPIRY_MINUTE_LABELS = { 1: "M1", 3: "M3", 5: "M5", 30: "M30" };

  function findExpiryOption(minutes) {
    const label = EXPIRY_MINUTE_LABELS[minutes];
    if (!label) return null;
    const items = document.querySelectorAll(".dops__timeframes-item");
    for (const item of items) {
      if (item.textContent?.trim() === label) return item;
    }
    return null;
  }

  // NOT yet confirmed — the small trigger box on the main trading panel
  // that opens the expiry dropdown (".expiration-inputs-list-modal") in
  // the first place. Everything captured so far was the dropdown's
  // *contents* once already open, not the button that opens it.
  function findExpiryTrigger() {
    return firstMatch([".expiry-trigger", "[data-testid='trade-expiry']"]);
  }

  // NOT yet confirmed — same gap as findExpiryTrigger, but for the Amount
  // dropdown (".amount-list-modal"). Also still missing: how a typed
  // digit actually lands in ".amount-field" — Pocket Option uses a custom
  // on-screen keypad (".virtual-keyboard__input", one div per digit) for
  // this, not a plain fillable <input>, so setting a value directly like
  // findExpiryOption below won't work here even once the trigger is known.
  function findAmountTrigger() {
    return firstMatch([".amount-trigger", "[data-testid='trade-amount']"]);
  }

  function findPairSearch() {
    return firstMatch([".asset-search", "[data-testid='asset-select']"]);
  }

  // Dispatches a realistic sequence of pointer events rather than a bare
  // .click(), with a small randomized delay first — best-effort only until
  // verified against the real site in Phase 2.
  async function humanClick(el) {
    if (!el) return false;
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 500));
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 80));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    return true;
  }

  // Attempts to place a trade. Returns { ok: true } or { ok: false, reason }
  // — never throws, never guesses success.
  async function placeTrade({ pair, signal, stake, expiresInMinutes }) {
    if (isDemoMode() !== true) {
      return { ok: false, reason: "Could not confirm Demo mode — refusing to trade" };
    }

    const pairEl = findPairSearch();
    if (!pairEl) return { ok: false, reason: "Pair selector not found on page (selectors.js needs updating for this site)" };
    // TODO Phase 2: actually search/select `pair` once the real search UI is known.

    const expiryTrigger = findExpiryTrigger();
    if (!expiryTrigger) return { ok: false, reason: "Expiry dropdown trigger not found (selectors.js needs updating for this site)" };
    await humanClick(expiryTrigger);
    const expiryOption = findExpiryOption(expiresInMinutes);
    if (!expiryOption) return { ok: false, reason: `No ${expiresInMinutes}-minute expiry preset available` };
    await humanClick(expiryOption);

    const amountTrigger = findAmountTrigger();
    if (!amountTrigger) return { ok: false, reason: "Amount dropdown trigger not found (selectors.js needs updating for this site)" };
    await humanClick(amountTrigger);

    // TODO Phase 2: Pocket Option's amount field is a custom on-screen
    // keypad (.virtual-keyboard__input digits), not a fillable <input> —
    // clicking Buy/Sell is deliberately left unimplemented until digit
    // entry works, so a real trade is never placed with the wrong stake.
    return { ok: false, reason: "Amount entry not yet implemented (custom keypad UI — see selectors.js TODO)" };
  }

  // Attempts to read the outcome of the most recent trade. Returns
  // "win" | "loss" | "unknown" — never guesses between win/loss.
  function readLastResult() {
    // TODO Phase 2: locate the real result/history readout once known.
    return "unknown";
  }

  window.TradeMindSelectors = {
    isDemoMode,
    findExpiryOption,
    findExpiryTrigger,
    findAmountTrigger,
    findPairSearch,
    findBuyButton,
    findSellButton,
    placeTrade,
    readLastResult,
  };
})();
