const $ = (id) => document.getElementById(id);
const say = (t) => { $("msg").textContent = t; setTimeout(() => ($("msg").textContent = ""), 2000); };

chrome.storage.local.get(["allowNeutral"]).then((s) => {
  $("neutral").checked = s.allowNeutral !== false;
});
$("save").onclick = async () => {
  await chrome.storage.local.set({ allowNeutral: $("neutral").checked });
  say("Uložené");
};
// Cache hodnotení má kľúč id:hash titulku; staré kľúče z minulých verzií mažeme tiež.
$("clear").onclick = async () => { await chrome.storage.local.remove("dnnCache"); say("Cache vymazaná"); };
