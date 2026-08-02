// All Pocket Option DOM knowledge lives in this one file so Phase 2 fixes
// (once we have real selectors from the live site) stay localized and never
// touch the polling/safety/reporting logic in content.js.
//
// STATUS: demo-mode detection, Buy/Sell, and expiry presets are confirmed
// against real markup from the user's live Pocket Option account. Amount
// entry is a best-effort first attempt (a real <input>, direct value-set
// not yet verified live) with a documented on-screen-keypad fallback if it
// doesn't work. Pair selection is still unconfirmed/placeholder — trading
// will refuse to run until that's filled in, since trading the wrong pair
// silently would be worse than not trading at all. Every function fails
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

  // Confirmed from a live screenshot: the main trading panel has a row
  // labelled exactly "Time" whose value is a ".value__val" div (e.g.
  // "00:03:00"), and a row labelled exactly "Amount" whose value is a
  // real <input type="text"> (e.g. "1,020.1"). Neither row's own wrapping
  // container has a confirmed class name, so both are found the same way
  // Buy/Sell are — anchored to real, visible label text rather than a
  // guessed class — by finding the label, then searching a few levels of
  // ancestors for the value element.
  function findRowValue(labelText, valueSelector) {
    const candidates = document.querySelectorAll("div, span");
    for (const el of candidates) {
      if (el.children.length === 0 && el.textContent?.trim() === labelText) {
        let container = el.parentElement;
        for (let i = 0; i < 3 && container; i++) {
          const valueEl = container.querySelector(valueSelector);
          if (valueEl) return valueEl;
          container = container.parentElement;
        }
      }
    }
    return null;
  }

  function findExpiryTrigger() {
    return findRowValue("Time", ".value__val");
  }

  // The main-panel Amount box is a real <input>, not just a display div —
  // worth trying to set its value directly (focus + set .value + dispatch
  // "input") before assuming the on-screen keypad inside the dropdown
  // modal is required. Not yet confirmed whether Pocket Option's Vue app
  // actually reacts to a programmatic value change here; that's the next
  // thing to verify live.
  function findAmountInput() {
    return findRowValue("Amount", "input[type='text']");
  }

  // Confirmed from the live site: the search box inside the pair picker is
  // ".search__field". Still missing, and still blocking real trading:
  // (1) the trigger that opens the pair picker in the first place (the
  // "AUD/CAD OTC ▾"-style label at the top-left of the chart), (2) what a
  // filtered result item looks like once you type into this box, and (3)
  // a way to verify the chart actually switched to the intended pair
  // before proceeding — without that verification, a wrong/failed pair
  // switch could silently trade whatever pair was already open instead of
  // the one the signal was actually about, which is worse than not
  // trading at all.
  function findPairSearch() {
    return firstMatch([".search__field"]);
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

    const amountEl = findAmountInput();
    if (!amountEl) return { ok: false, reason: "Amount input not found (selectors.js needs updating for this site)" };
    amountEl.focus();
    amountEl.value = String(stake);
    amountEl.dispatchEvent(new Event("input", { bubbles: true }));
    amountEl.dispatchEvent(new Event("change", { bubbles: true }));
    amountEl.blur();
    // TODO Phase 2, verify live: if Pocket Option's Vue app doesn't pick
    // up this programmatic value change, fall back to clicking the
    // on-screen keypad digits (.virtual-keyboard__input, inside the
    // ".amount-list-modal" opened by clicking this same input) instead.
    await new Promise((r) => setTimeout(r, 300));
    if (amountEl.value.replace(/,/g, "") !== String(stake)) {
      return { ok: false, reason: `Amount field shows "${amountEl.value}" instead of ${stake} — direct value-set didn't take, needs the on-screen keypad fallback` };
    }

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
    findExpiryOption,
    findExpiryTrigger,
    findAmountInput,
    findPairSearch,
    findBuyButton,
    findSellButton,
    placeTrade,
    readLastResult,
  };
})();
