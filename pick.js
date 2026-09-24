// Dev tool: browse every word's graph, pick a round's worth, then play or share them.
// The whole list is thousands of words, so cards are added a page at a time as you scroll.

const PICK_PAGE = 40;

let picked = [];        // words chosen for the next round, in the order they were picked
let pickQuery = "";
let pickSort = "peak";  // "peak" | "az" | "random"
let pickOrder = [];     // the filtered, sorted word list
let pickDrawn = 0;      // how much of pickOrder is on screen
let pickSeed = [];      // one shuffle, kept so scrolling doesn't reshuffle underfoot
let pickWatcher = null;

const pickFull = () => picked.length >= rules.n;

function pickMatches(word) {
  if (!pickQuery) return true;
  const def = definitions[word];
  return word.includes(pickQuery) || (def && def.text.toLowerCase().includes(pickQuery));
}

function buildPickOrder() {
  const all = Object.keys(data.series).filter((w) => !isDeleted(w) && pickMatches(w));
  if (pickSort === "az") return all.sort();
  if (pickSort === "peak") return all.sort((a, b) => peaks[b] - peaks[a]);
  if (!pickSeed.length) pickSeed = shuffle(Object.keys(data.series));
  const rank = new Map(pickSeed.map((w, i) => [w, i]));
  return all.sort((a, b) => rank.get(a) - rank.get(b));
}

// ---- The tray of picked words -------------------------------------------

function togglePick(word) {
  if (picked.includes(word)) picked = picked.filter((w) => w !== word);
  else if (!pickFull()) picked.push(word);
  else return;   // full: a word has to come out before another goes in
  renderPickTray();
  for (const card of document.querySelectorAll("#pick-grid .pick-card")) {
    card.classList.toggle("chosen", picked.includes(card.dataset.word));
  }
}

function pickedLink() {
  return location.origin + location.pathname + rulesToQuery({ ...rules, words: [...picked] });
}

function renderPickTray() {
  const tray = $("pick-tray");
  tray.replaceChildren();
  tray.style.setProperty("--slots", rules.n);
  for (let i = 0; i < rules.n; i++) {
    const word = picked[i];
    if (!word) {
      tray.append(el("div", { className: "tray-slot empty", textContent: `Word ${i + 1}` }));
      continue;
    }
    const slot = el("div", { className: "tray-slot" });
    const drop = el("button", { className: "tray-drop", type: "button", textContent: "✕", title: `Remove “${word}”` });
    drop.addEventListener("click", () => togglePick(word));
    slot.append(
      el("div", { className: "tray-head" }, el("b", { textContent: word }), drop),
      drawChart(data.series[word], true));
    tray.append(slot);
  }
  $("pick-count").textContent = `${picked.length} of ${rules.n} picked`;
  $("pick-play").disabled = picked.length !== rules.n;
  $("pick-copy").disabled = picked.length !== rules.n;
  $("pick-clear").disabled = !picked.length;
}

// ---- The scrolling list --------------------------------------------------

function pickCard(word) {
  const card = el("div", { className: "pick-card" + (picked.includes(word) ? " chosen" : "") });
  card.dataset.word = word;
  const def = definitions[word];
  const add = el("button", { className: "pick-add", type: "button", title: "Pick this word" });
  const choose = () => togglePick(word);
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    choose();
  });
  card.addEventListener("click", choose);
  card.append(
    el("div", { className: "pick-card-head" },
      el("b", { textContent: word }),
      el("span", { className: "pick-peak", textContent: fmt(peaks[word]) }),
      starButton(word), deleteButton(word), add),
    drawChart(data.series[word], true),
    el("p", { className: "pick-def" }, ...(def ? [el("span", { className: "pos", textContent: def.pos }), def.text] : ["No definition available."])));
  return card;
}

function drawMorePicks() {
  const grid = $("pick-grid");
  const next = pickOrder.slice(pickDrawn, pickDrawn + PICK_PAGE);
  for (const word of next) grid.append(pickCard(word));
  pickDrawn += next.length;
  $("pick-more").hidden = pickDrawn >= pickOrder.length;
  $("pick-total").textContent = pickOrder.length
    ? `${pickOrder.length} word${pickOrder.length === 1 ? "" : "s"}${pickQuery ? ` matching “${pickQuery}”` : ""}`
    : `No words match “${pickQuery}”`;
}

function refreshPicks() {
  pickOrder = buildPickOrder();
  pickDrawn = 0;
  $("pick-grid").replaceChildren();
  drawMorePicks();
  // Keep filling while the sentinel is still in view (a short list, or a tall window).
  pickWatcher?.disconnect();
  pickWatcher = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && pickDrawn < pickOrder.length) drawMorePicks();
  }, { rootMargin: "600px" });
  pickWatcher.observe($("pick-more"));
}

function openPicker() {
  renderPickTray();
  refreshPicks();
}

$("pick-search").addEventListener("input", (e) => {
  pickQuery = e.target.value.trim().toLowerCase();
  refreshPicks();
});
$("pick-sort").addEventListener("click", (e) => {
  const button = e.target.closest("[data-sort]");
  if (!button) return;
  pickSort = button.dataset.sort;
  if (pickSort === "random") pickSeed = shuffle(Object.keys(data.series));   // a new shuffle each time
  for (const b of $("pick-sort").children) b.classList.toggle("active", b.dataset.sort === pickSort);
  refreshPicks();
});
$("pick-play").addEventListener("click", () => {
  if (picked.length !== rules.n) return;
  applyRules({ ...rules, words: [...picked] });
  showTab("play");
});
$("pick-copy").addEventListener("click", async (e) => {
  const button = e.currentTarget;
  const ok = await copyText(pickedLink());
  button.textContent = ok ? "Copied!" : "Couldn't copy";
  setTimeout(() => (button.textContent = "Copy link"), 1600);
});
$("pick-clear").addEventListener("click", () => {
  picked = [];
  renderPickTray();
  for (const card of document.querySelectorAll("#pick-grid .pick-card.chosen")) card.classList.remove("chosen");
});
