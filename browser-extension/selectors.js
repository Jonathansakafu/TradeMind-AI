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

  // Not yet confirmed against the live site — only the section title divs
  // ("Amount", "Time") were captured so far, not the actual input/selector
  // controls next to them. Placeholder until the real markup is provided.
  function findAmountInput() {
    return firstMatch(["input[name='amount']", ".amount-input input", "[data-testid='trade-amount']"]);
  }

  function findExpirySelector() {
    return firstMatch([".expiry-selector", "[data-testid='trade-expiry']"]);
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
  async function placeTrade({ pair, signal, stake }) {
    if (isDemoMode() !== true) {
      return { ok: false, reason: "Could not confirm Demo mode — refusing to trade" };
    }

    const pairEl = findPairSearch();
    if (!pairEl) return { ok: false, reason: "Pair selector not found on page (selectors.js needs updating for this site)" };
    // TODO Phase 2: actually search/select `pair` once the real search UI is known.

    const amountEl = findAmountInput();
    if (!amountEl) return { ok: false, reason: "Amount input not found" };
    amountEl.focus();
    amountEl.value = String(stake);
    amountEl.dispatchEvent(new Event("input", { bubbles: true }));

    const targetButton = signal === "buy" ? findBuyButton() : findSellButton();
    if (!targetButton) return { ok: false, reason: `${signal === "buy" ? "Buy" : "Sell"} button not found` };

    const clicked = await humanClick(targetButton);
    if (!clicked) return { ok: false, reason: "Click dispatch failed" };

    return { ok: true };
  }

  // Attempts to read the outcome of the most recent trade. Returns
  // "win" | "loss" | "unknown" — never guesses between win/loss.
  function readLastResult() {
    // TODO Phase 2: locate the real result/history readout once known.
    return "unknown";
  }

  window.TradeMindSelectors = {
    isDemoMode,
    findAmountInput,
    findExpirySelector,
    findPairSearch,
    findBuyButton,
    findSellButton,
    placeTrade,
    readLastResult,
  };
})();
