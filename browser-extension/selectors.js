// All Pocket Option DOM knowledge lives in this one file so Phase 2 fixes
// (once we have real selectors from the live site) stay localized and never
// touch the polling/safety/reporting logic in content.js.
//
// STATUS: demo-mode detection, Buy/Sell, expiry presets, and pair
// selection (including a post-switch verification check) are all
// confirmed against real markup/screenshots from the user's live Pocket
// Option account. Amount entry is a best-effort first attempt (a real
// <input>, direct value-set not yet verified live) with a documented
// on-screen-keypad fallback if it doesn't work — that, plus reading back
// the win/loss result (readLastResult), are the two remaining pieces that
// need a first live test to confirm. Every function fails closed (returns
// null/false) rather than guessing, and content.js reports "failed" with
// a clear reason whenever that happens instead of pretending to have
// placed or read a trade.

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
  // ".search__field", and the current-pair label/trigger at the top-left
  // of the chart is ".current-symbol" (its exact text, e.g. "AUD/CAD OTC",
  // is also what's used below to confirm the switch actually worked).
  function findPairSearch() {
    return firstMatch([".search__field"]);
  }

  function findPairTrigger() {
    return firstMatch([".current-symbol"]);
  }

  // Result rows in the pair picker don't have a confirmed class name, but
  // — same trick as Buy/Sell — every row shows the pair's exact name as
  // plain text (e.g. "EUR/USD OTC"), which `notification.pair` already
  // matches exactly (it's stored in the same "EUR/USD OTC" format chosen
  // for the Quick Trade pair picker in TradingSession.jsx), so matching on
  // that text finds the row without needing its class.
  function findPairResult(label) {
    const candidates = document.querySelectorAll("div, span");
    for (const el of candidates) {
      if (el.children.length === 0 && el.textContent?.trim() === label) return el;
    }
    return null;
  }

  // Types text one character at a time with real keydown/input/keyup
  // events per character (not one bulk value-set + single "input" event) —
  // more likely to be picked up by search-as-you-type logic that listens
  // for individual keystrokes rather than just watching the field's value.
  async function typeIntoField(el, text) {
    el.focus();
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    for (const char of text) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
      el.value += char;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
      await new Promise((r) => setTimeout(r, 60 + Math.random() * 80));
    }
  }

  // Turns "GBP/USD OTC" into "GBP" and "Gold OTC" into "Gold" — a short
  // base-currency term, not the full label. Confirmed live: searching the
  // full "EUR/USD OTC" string (with the slash and the word "OTC") found no
  // results, but a human searching just "eur" correctly matched every
  // "EUR/..." OTC pair, so Pocket Option's search evidently isn't doing a
  // full-string match against the exact displayed label.
  function toSearchTerm(pair) {
    const base = pair.replace(/\s*OTC$/i, "").trim();
    return base.split("/")[0];
  }

  // Polls checkFn until it returns true or timeout elapses — used instead
  // of one fixed delay since we don't know how long Pocket Option's Vue
  // app actually takes to re-render after a selection.
  async function waitForCondition(checkFn, { timeout = 3000, interval = 250 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (checkFn()) return true;
      await new Promise((r) => setTimeout(r, interval));
    }
    return checkFn();
  }

  // Opens the pair picker (if needed), searches for `pair`, clicks the
  // matching result, then re-reads .current-symbol to confirm the switch
  // actually took before returning ok — a wrong/failed switch must never
  // silently leave whatever pair was already open selected instead.
  async function selectPair(pair) {
    const trigger = findPairTrigger();
    if (!trigger) return { ok: false, reason: "Pair trigger (.current-symbol) not found" };
    if (trigger.textContent?.trim() === pair) return { ok: true }; // already on the right pair

    await humanClick(trigger);
    await new Promise((r) => setTimeout(r, 300));

    const searchEl = findPairSearch();
    if (!searchEl) return { ok: false, reason: "Pair search box not found after opening the picker" };
    await typeIntoField(searchEl, toSearchTerm(pair));
    await new Promise((r) => setTimeout(r, 600));

    const resultEl = findPairResult(pair);
    if (!resultEl) return { ok: false, reason: `No result found for "${pair}" in the pair picker (searched "${toSearchTerm(pair)}")` };

    const isSelected = () => findPairTrigger()?.textContent?.trim() === pair;

    await humanClick(resultEl);
    if (await waitForCondition(isSelected)) return { ok: true };

    // The leaf text span we matched on might not be the actual click
    // target Pocket Option's Vue app listens on — try again on its
    // nearest likely-interactive ancestor before giving up.
    const parentTarget = resultEl.closest("a, button, li, [role='option'], div") || resultEl.parentElement;
    if (parentTarget && parentTarget !== resultEl) {
      await humanClick(parentTarget);
      if (await waitForCondition(isSelected, { timeout: 2000 })) return { ok: true };
    }

    return { ok: false, reason: `Pair switch didn't take — chart shows "${findPairTrigger()?.textContent?.trim()}" instead of "${pair}"` };
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

    const pairResult = await selectPair(pair);
    if (!pairResult.ok) return pairResult;

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
    findPairTrigger,
    findPairResult,
    selectPair,
    findBuyButton,
    findSellButton,
    placeTrade,
    readLastResult,
  };
})();
