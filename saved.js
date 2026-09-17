// Dev tool: star interesting words while playing or building puzzles, then export them.
// Stars live in this browser's localStorage; the Saved tab downloads them as a word-list file.

const SAVED_KEY = "graphle-saved";
let saved = loadSaved();  // [{ word, savedAt }]

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; }
  catch { return []; }
}

function persistSaved() {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); } catch {}
  updateSavedCount();
}

const isSaved = (word) => saved.some((s) => s.word === word);

function toggleSaved(word) {
  if (isSaved(word)) saved = saved.filter((s) => s.word !== word);
  else saved.push({ word, savedAt: new Date().toISOString().slice(0, 10) });
  persistSaved();
}

// A star toggle that updates itself in place, so it can sit inside any view.
function starButton(word) {
  const b = el("button", { type: "button", className: "star" });
  const sync = () => {
    const on = isSaved(word);
    b.textContent = on ? "★" : "☆";
    b.classList.toggle("on", on);
    b.title = on ? `Unsave “${word}”` : `Save “${word}” for later`;
  };
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSaved(word);
    for (const other of document.querySelectorAll(".star")) other.dispatchEvent(new Event("sync"));
    if (!$("saved-view").hidden) renderSaved();
  });
  b.addEventListener("sync", sync);
  b.addEventListener("dragstart", (e) => e.preventDefault());
  sync();
  return b;
}

function updateSavedCount() {
  $("saved-count").textContent = saved.length ? ` (${saved.length})` : "";
}

function savedFileText() {
  const lines = [
    `# Saved words from Graphle, exported ${new Date().toISOString().slice(0, 10)}`,
    "# word | part of speech | definition",
  ];
  for (const { word } of saved) {
    const d = definitions[word];
    lines.push(`${word} | ${d ? d.pos : "?"} | ${d ? d.text : "?"}`);
  }
  return lines.join("\n") + "\n";
}

function renderSaved() {
  const root = $("saved-list");
  root.replaceChildren();
  $("saved-empty").hidden = saved.length > 0;
  $("saved-actions").hidden = saved.length === 0;
  for (const { word, savedAt } of [...saved].reverse()) {
    const d = definitions[word];
    const remove = el("button", { type: "button", className: "link-btn", textContent: "Remove" });
    remove.addEventListener("click", () => {
      toggleSaved(word);
      renderSaved();
    });
    root.append(el("div", { className: "saved-card" },
      el("div", { className: "saved-head" }, el("b", { textContent: word }), el("span", { className: "saved-date", textContent: savedAt })),
      el("p", { className: "saved-def" }, ...(d ? [el("span", { className: "pos", textContent: d.pos }), d.text] : ["No definition available."])),
      isValidWord(word) ? drawChart(data.series[word], true) : "",
      remove));
  }
}

$("saved-download").addEventListener("click", () => {
  const blob = new Blob([savedFileText()], { type: "text/plain" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `graphle-saved-${new Date().toISOString().slice(0, 10)}.txt` });
  a.click();
  URL.revokeObjectURL(a.href);
});

$("saved-copy").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(savedFileText());
    btn.textContent = "Copied!";
  } catch {
    btn.textContent = "Couldn't copy";
  }
  setTimeout(() => (btn.textContent = "Copy as text"), 1500);
});

$("saved-clear").addEventListener("click", () => {
  if (!confirm(`Remove all ${saved.length} saved words?`)) return;
  saved = [];
  persistSaved();
  renderSaved();
});

updateSavedCount();
