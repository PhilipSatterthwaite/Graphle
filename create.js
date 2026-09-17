// The Create tab: edit a rule set, optionally hand-pick words, then play it or share a link.

let draft;               // rules being edited
let wordMode;            // "random" | "pick"
let pickInputs = [];     // hand-picked word inputs, one per slot
let wordsHidden = false; // hide hand-picked words that arrived via someone else's link
let authoredWords = "";  // words typed in this session, which never need hiding
let selectedHint = null; // tap-to-move alternative to dragging hint cards

function openCreator(currentRules) {
  draft = cloneRules(currentRules);
  wordMode = draft.words ? "pick" : "random";
  pickInputs = draft.words ? [...draft.words] : [];
  wordsHidden = Boolean(draft.words) && draft.words.join(",") !== authoredWords;
  selectedHint = null;
  ensureWordList();
  renderCreator();
}

function ensureWordList() {
  if ($("word-list").childElementCount) return;
  const frag = document.createDocumentFragment();
  for (const w of Object.keys(data.series).sort()) frag.append(el("option", { value: w }));
  $("word-list").append(frag);
}

function randomWord(exclude) {
  const all = Object.keys(data.series);
  for (;;) {
    const w = all[Math.floor(Math.random() * all.length)];
    if (!exclude.includes(w)) return w;
  }
}

// ---- Building and validating the rule set --------------------------------

function pickProblems() {
  const words = pickInputs.slice(0, draft.n).map((w) => (w || "").trim().toLowerCase());
  return words.map((w, i) => {
    if (!w) return "empty";
    if (!isValidWord(w)) return "not in the word list";
    if (words.indexOf(w) !== i) return "duplicate";
    return null;
  });
}

function builtRules() {
  const r = cloneRules(draft);
  r.words = wordMode === "pick" ? pickInputs.slice(0, draft.n).map((w) => w.trim().toLowerCase()) : null;
  return r;
}

const creatorValid = () => wordMode === "random" || pickProblems().every((p) => p === null);

function shareUrl() {
  return location.origin + location.pathname + rulesToQuery(builtRules());
}

// ---- Rendering -----------------------------------------------------------

function segmented(options, value, onPick) {
  const wrap = el("div", { className: "segmented" });
  for (const [val, label] of options) {
    const b = el("button", { className: "seg" + (val === value ? " active" : ""), textContent: label, type: "button" });
    b.addEventListener("click", () => onPick(val));
    wrap.append(b);
  }
  return wrap;
}

function section(title, hint, ...content) {
  return el("section", { className: "panel" }, el("h2", { textContent: title }), hint ? el("p", { className: "panel-hint", textContent: hint }) : "", ...content);
}

function renderCreator() {
  const root = $("creator");
  root.replaceChildren(
    section("Round size", null,
      el("div", { className: "field" }, el("span", { className: "field-label", textContent: "Words per round" }),
        segmented([[3, "3"], [4, "4"], [5, "5"]], draft.n, (n) => {
          draft.n = n;
          renderCreator();
        })),
      el("div", { className: "field" }, el("span", { className: "field-label", textContent: "Guesses" }),
        segmented(Array.from({ length: MAX_GUESS_SETTING }, (_, i) => [i + 1, String(i + 1)]), draft.guesses, (g) => {
          draft.guesses = g;
          for (const h of HINT_TYPES) if (draft.hints[h.key] !== null) draft.hints[h.key] = Math.min(draft.hints[h.key], g - 1);
          renderCreator();
        }))),
    section("Word frequency", "Random rounds only draw words whose graph peaks at least this high (uses per billion words). Higher means more familiar words.", renderPeakSlider()),
    section("Feedback after each guess", null,
      segmented([["count", "How many are right"], ["exact", "Which ones are right"]], draft.feedback, (fb) => {
        draft.feedback = fb;
        renderCreator();
      }),
      el("p", {
        className: "panel-hint",
        textContent: draft.feedback === "exact"
          ? "Correct words lock in green; wrong ones are marked so the player can rearrange them."
          : "The player only sees a count, and has to deduce which words are right.",
      })),
    section("Logic helper", null,
      segmented([[false, "Off"], [true, "On"]], draft.logic, (on) => {
        draft.logic = on;
        renderCreator();
      }),
      el("p", {
        className: "panel-hint",
        textContent: "When on, each past guess is colored green if the current arrangement is consistent with its score and red if it can't be, so repeating a 0-correct placement gets flagged.",
      })),
    section("Hints", "Drag each hint to when it unlocks (or tap a hint, then tap a column). “Start” means it's available from the beginning.", renderHintBoard()),
    section("Words", null, renderWordSection()),
    renderActions(),
  );
}

function renderPeakSlider() {
  const index = Math.max(0, MIN_PEAK_STEPS.indexOf(draft.minPeak));
  const slider = el("input", { type: "range", className: "peak-slider", min: 0, max: MIN_PEAK_STEPS.length - 1, step: 1, value: index });
  const label = el("span", { className: "peak-value" });
  const update = () => {
    const eligible = Object.keys(data.series).filter((w) => peaks[w] >= draft.minPeak).length;
    label.textContent = `${formatPeak(draft.minPeak)} per billion — ${eligible} words available`;
    label.className = "peak-value" + (eligible < 50 ? " bad" : "");
  };
  slider.addEventListener("input", () => {
    draft.minPeak = MIN_PEAK_STEPS[Number(slider.value)];
    update();
    renderActions(true);
  });
  update();
  return el("div", { className: "field" }, slider, label);
}

function renderHintBoard() {
  const board = el("div", { className: "hint-board" });
  const columns = [null, ...Array.from({ length: draft.guesses }, (_, i) => i)];
  for (const at of columns) {
    const title = at === null ? "Off" : at === 0 ? "Start" : `After ${at} wrong`;
    const col = el("div", { className: "hint-col" + (at === null ? " off" : "") }, el("div", { className: "hint-col-title", textContent: title }));
    for (const h of HINT_TYPES.filter((t) => draft.hints[t.key] === at)) {
      const card = el("div", { className: "hint-card" + (selectedHint === h.key ? " selected" : ""), draggable: true, title: h.desc },
        el("b", { textContent: h.label }), el("span", { textContent: h.desc }));
      card.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", h.key));
      card.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedHint = selectedHint === h.key ? null : h.key;
        renderCreator();
      });
      col.append(card);
    }
    const moveHere = (key) => {
      if (!HINT_TYPES.some((t) => t.key === key)) return;
      draft.hints[key] = at;
      selectedHint = null;
      renderCreator();
    };
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drop");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drop"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      moveHere(e.dataTransfer.getData("text/plain"));
    });
    col.addEventListener("click", () => selectedHint && moveHere(selectedHint));
    board.append(col);
  }
  return board;
}

function renderWordSection() {
  const wrap = el("div", {},
    segmented([["random", "Random every round"], ["pick", "Hand-pick the first round"]], wordMode, (mode) => {
      wordMode = mode;
      renderCreator();
    }));
  if (wordMode === "random") {
    wrap.append(el("p", { className: "panel-hint", textContent: "Each round draws words at random from the full list." }));
    return wrap;
  }
  wrap.append(el("p", { className: "panel-hint", textContent: "The first round uses these words (graphs are shuffled). Rounds after that are random." }));

  if (wordsHidden) {
    const reveal = el("button", { className: "secondary", type: "button", textContent: "Show the words" });
    reveal.addEventListener("click", () => {
      wordsHidden = false;
      renderCreator();
    });
    const replace = el("button", { className: "secondary", type: "button", textContent: "Pick new words" });
    replace.addEventListener("click", () => {
      wordsHidden = false;
      pickInputs = [];
      renderCreator();
    });
    wrap.append(el("div", { className: "hidden-words" },
      el("span", { textContent: `This puzzle's ${draft.n} words are hidden so they aren't spoiled.` }), reveal, replace));
    return wrap;
  }

  const list = el("div", { className: "pick-list" });
  const statusEls = [];
  const previewEls = [];
  const refreshStatus = () => {
    const problems = pickProblems();
    statusEls.forEach((s, i) => {
      s.textContent = problems[i] === null ? "✓" : problems[i] === "empty" ? "" : problems[i];
      s.className = "pick-status " + (problems[i] === null ? "ok" : problems[i] === "empty" ? "" : "bad");
      // Small preview of the word's graph, redrawn only when the word changes.
      const word = (pickInputs[i] || "").trim().toLowerCase();
      const preview = previewEls[i];
      const shown = isValidWord(word) ? word : "";
      if (preview.dataset.word !== shown) {
        preview.dataset.word = shown;
        preview.replaceChildren(...(shown ? [el("div", { className: "preview-star" }, starButton(shown)), drawChart(data.series[shown], true)] : []));
      }
    });
    renderActions(true);
  };
  for (let i = 0; i < draft.n; i++) {
    const input = el("input", { className: "pick-input", value: pickInputs[i] || "", placeholder: `Word ${i + 1}`, autocomplete: "off", spellcheck: false });
    input.setAttribute("list", "word-list");
    input.addEventListener("input", () => {
      pickInputs[i] = input.value;
      authoredWords = pickInputs.slice(0, draft.n).join(",");
      refreshStatus();
    });
    const dice = el("button", { className: "dice", type: "button", title: "Random word", textContent: "🎲" });
    dice.addEventListener("click", () => {
      pickInputs[i] = randomWord(pickInputs);
      input.value = pickInputs[i];
      authoredWords = pickInputs.slice(0, draft.n).join(",");
      refreshStatus();
    });
    const status = el("span", { className: "pick-status" });
    statusEls.push(status);
    const preview = el("div", { className: "pick-preview" });
    previewEls.push(preview);
    list.append(el("div", { className: "pick-row" }, el("div", { className: "pick-controls" }, input, dice, status), preview));
  }
  wrap.append(list);

  const suggestions = el("div", { className: "suggestions" }, el("span", { className: "field-label", textContent: "Suggestions" }));
  const more = el("button", { className: "secondary", type: "button", textContent: "More" });
  suggestions.append(more);
  const drawSuggestions = () => {
    suggestions.querySelectorAll(".chip").forEach((c) => c.remove());
    for (let k = 0; k < 10; k++) {
      const w = randomWord(pickInputs);
      const chip = el("button", { className: "chip small", type: "button", textContent: w });
      chip.addEventListener("click", () => {
        const slot = Array.from({ length: draft.n }, (_, i) => i).find((i) => !(pickInputs[i] || "").trim());
        if (slot === undefined) return;
        pickInputs[slot] = w;
        list.querySelectorAll(".pick-input")[slot].value = w;
        authoredWords = pickInputs.slice(0, draft.n).join(",");
        chip.remove();
        refreshStatus();
      });
      suggestions.insertBefore(chip, more);
    }
  };
  more.addEventListener("click", drawSuggestions);
  drawSuggestions();
  wrap.append(suggestions);
  queueMicrotask(refreshStatus);
  return wrap;
}

function renderActions(updateOnly) {
  const valid = creatorValid();
  if (updateOnly) {
    const bar = $("creator").querySelector(".creator-actions");
    if (!bar) return;
    bar.querySelectorAll("button.needs-valid").forEach((b) => (b.disabled = !valid));
    bar.querySelector(".share-url").value = valid ? shareUrl() : "Fill in valid words to get a link";
    return;
  }
  const play = el("button", { className: "primary needs-valid", type: "button", textContent: "Play these rules" });
  play.disabled = !valid;
  play.addEventListener("click", () => {
    if (!creatorValid()) return;
    const r = builtRules();
    if (r.words) authoredWords = r.words.join(",");
    applyRules(r);
    showTab("play");
  });
  const url = el("input", { className: "share-url", readOnly: true, value: valid ? shareUrl() : "Fill in valid words to get a link" });
  url.addEventListener("focus", () => url.select());
  const copy = el("button", { className: "secondary needs-valid", type: "button", textContent: "Copy share link" });
  copy.disabled = !valid;
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url.value);
      copy.textContent = "Copied!";
    } catch {
      url.select();
      copy.textContent = "Press Ctrl+C";
    }
    setTimeout(() => (copy.textContent = "Copy share link"), 1500);
  });
  const reset = el("button", { className: "link-btn", type: "button", textContent: "Reset to defaults" });
  reset.addEventListener("click", () => openCreator(DEFAULT_RULES));
  return el("div", { className: "creator-actions" },
    el("div", { className: "share-row" }, url, copy),
    el("div", { className: "action-row" }, play, reset));
}
