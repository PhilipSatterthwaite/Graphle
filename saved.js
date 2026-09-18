// Dev tool: star interesting words while playing or building puzzles, then export them.
// Stars live in this browser's localStorage; the Saved tab downloads them as a word-list file.

const SAVED_KEY = "graphle-saved";
const DELETED_KEY = "graphle-deleted";
let saved = loadSaved();       // [{ word, savedAt }]
let deleted = loadDeleted();   // words banned from future rounds, kept in this browser

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; }
  catch { return []; }
}

function loadDeleted() {
  try { return new Set(JSON.parse(localStorage.getItem(DELETED_KEY)) || []); }
  catch { return new Set(); }
}

function persistDeleted() {
  try { localStorage.setItem(DELETED_KEY, JSON.stringify([...deleted])); } catch {}
  updateSavedCount();
}

const isDeleted = (word) => deleted.has(word);

// Drop a word from every future round. The current round keeps it unless no
// guesses have been made, in which case the round is redrawn without it.
function deleteWord(word) {
  deleted.add(word);
  saved = saved.filter((s) => s.word !== word);
  persistDeleted();
  persistSaved();
  if (round.words.includes(word)) {
    if (guesses.length === 0) {
      newRound();
      message = `Removed “${word}” — new round drawn.`;
    } else {
      message = `Removed “${word}” from future rounds.`;
    }
  } else {
    message = `Removed “${word}” from future rounds.`;
  }
  render();
  if (!$("saved-view").hidden) renderSaved();
}

function restoreWord(word) {
  deleted.delete(word);
  persistDeleted();
  renderSaved();
}

// A small ✕ that removes the word from the word list.
function deleteButton(word) {
  const b = el("button", { type: "button", className: "delete-word", textContent: "✕", title: `Remove “${word}” from the word list` });
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteWord(word);
  });
  b.addEventListener("pointerdown", (e) => e.stopPropagation());
  return b;
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
  const n = saved.length + deleted.size;
  $("saved-count").textContent = n ? ` (${n})` : "";
}

function deletedFileText() {
  return `# Words deleted in the browser, exported ${new Date().toISOString().slice(0, 10)}\n` +
    [...deleted].sort().join("\n") + "\n";
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

function renderDeleted() {
  const list = $("deleted-list");
  list.replaceChildren();
  $("deleted-empty").hidden = deleted.size > 0;
  $("deleted-actions").hidden = deleted.size === 0;
  $("deleted-total").textContent = deleted.size ? ` (${deleted.size})` : "";
  for (const word of [...deleted].sort()) {
    const undo = el("button", { type: "button", className: "chip small", textContent: word });
    undo.append(el("span", { className: "tag", textContent: "put back" }));
    undo.title = `Put “${word}” back in the word list`;
    undo.addEventListener("click", () => restoreWord(word));
    list.append(undo);
  }
}

function renderSaved() {
  renderDeleted();
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
      el("div", { className: "saved-foot" }, remove, deleteButton(word))));
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

$("deleted-download").addEventListener("click", () => {
  const blob = new Blob([deletedFileText()], { type: "text/plain" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `graphle-deleted-${new Date().toISOString().slice(0, 10)}.txt` });
  a.click();
  URL.revokeObjectURL(a.href);
});

$("deleted-copy").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(deletedFileText());
    btn.textContent = "Copied!";
  } catch {
    btn.textContent = "Couldnt copy";
  }
  setTimeout(() => (btn.textContent = "Copy as text"), 1500);
});

$("deleted-restore-all").addEventListener("click", () => {
  if (!confirm(`Put all ${deleted.size} deleted words back?`)) return;
  deleted = new Set();
  persistDeleted();
  renderSaved();
});
