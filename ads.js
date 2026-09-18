// Ad slots. Each [data-ad] box on the page shows a house banner until AdSense is set up.
// To go live: paste the publisher ID and one ad-unit ID per slot from the AdSense dashboard.
// Every slot with an ID gets a live unit sized to its box; slots left blank keep their
// house banner, so the two can be mixed.
const ADSENSE = {
  client: "",          // publisher ID, "ca-pub-0000000000000000"
  slots: {
    bottom: "",        // 728×90 leaderboard below the game (320×100 on phones)
    "bottom-2": "",    // second banner below the game, when the rail doesn't fit
    rail: "",          // 160×600 skyscraper in the right-hand margin
  },
};

(() => {
  if (!ADSENSE.client) return;
  const script = Object.assign(document.createElement("script"), {
    async: true,
    crossOrigin: "anonymous",
    src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE.client}`,
  });
  document.head.append(script);

  for (const slot of document.querySelectorAll("[data-ad]")) {
    const unit = ADSENSE.slots[slot.dataset.ad];
    const box = slot.querySelector(".ad-box");
    // A slot hidden at this screen size has no box to fill; requesting an ad for it would fail.
    if (!unit || !box.offsetWidth) continue;
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.cssText = `display:inline-block;width:${box.offsetWidth}px;height:${box.offsetHeight}px`;
    ins.dataset.adClient = ADSENSE.client;
    ins.dataset.adSlot = unit;
    box.classList.add("live");
    box.replaceChildren(ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  }
})();
