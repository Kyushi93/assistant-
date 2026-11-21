// Assistant Thyvan — application (données locales + synchro Supabase + notifications push)
const CFG = window.APP_CONFIG || {};
const HAS_CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const GOAL = 2500;
const LS = "thyvan-assistant-v1";

/* ---------- Données fixes ---------- */
const CC = (window.CC_DATA || []).map(r => ({ id: r[0] + "|" + r[1] + "|" + r[3], date: r[0], ue: r[1], name: r[2], cc: r[3], mod: r[4], note: r[5] || "", status: r[6] || "" }));
const isOff = c => /annul/i.test(c.status || "");
let NEWS = [];
let EDT = []; try { EDT = JSON.parse(localStorage.getItem("thy-edt") || "[]"); } catch (e) {}
let edtAt = 0;
const KIND = { CM: "CM", TD: "TD", TP_PAO: "PAO", FC_I: "Clinique" };
function edtLabel(r) { const c = CC.find(x => x.ue === "UE " + r[3]); return (KIND[r[4]] || r[4]) + " · UE " + r[3] + (c ? " " + c.name : "") + (r[5] ? " · " + r[5] : "") + (r[6] ? " (" + r[6] + ")" : ""); }
async function loadEdt(force) {
  if (!user || (!force && Date.now() - edtAt < 300000)) return;
  edtAt = Date.now();
  const { data } = await sb.from("edt").select("data").maybeSingle();
  if (data && Array.isArray(data.data)) { EDT = data.data; try { localStorage.setItem("thy-edt", JSON.stringify(EDT)); } catch (e) {} renderAll(); }
}
const NEWS_ICON = { cancel: "❌", change: "🔁", new: "🆕", result: "📊", info: "📩", course: "📚" };
const BASE_RESULTS = [
  { id: "r57", ue: "UE 5.7 — PAO Thoraco-scapulaire", date: "05/11", note: "13,7 / 20", cls: "p-gold",
    good: ["Positionnement patient & praticien", "Repérage, accord palpatoire, mise en tension", "Communication & hygiène"],
    bad: ["Méthodologie des tests (à énoncer à voix haute)", "Action (test poussé trop loin)", "Interrogatoire & élaboration du diagnostic", "Justifier le choix de la technique"] },
  { id: "r58", ue: "UE 5.8 — PAO Membre supérieur", date: "16/11", note: "ABS", cls: "p-coral",
    bad: ["Noté absent : vérifie la justification et le rattrapage avec la scolarité"] }
];

/* ---------- État ---------- */
const EMPTY = () => ({ days: {}, tasks: [], events: [], rev: {}, results: [], prefs: { evals: true, water: true, tasks: true, evening: true }, seeded: false, updatedAt: 0 });
let S = EMPTY();
try { const l = localStorage.getItem(LS); if (l) S = Object.assign(EMPTY(), JSON.parse(l)); } catch (e) {}
S.prefs = Object.assign({ evals: true, water: true, tasks: true, evening: true }, S.prefs || {});
if (!S.results) S.results = [];

function seed() {
  if (S.seeded) return;
  S.tasks.push(
    { id: uid(), t: "Vérifier mon absence UE 5.8 (16/11) avec la scolarité + rattrapage", d: "2026-11-23", c: "admin", done: false },
    { id: uid(), t: "Réviser la méthodo des tests PAO lombo-pelvien (CC 25/11)", d: "2026-11-24", c: "etudes", done: false },
    { id: uid(), t: "Vérifier mon groupe de passage UE 1.8 (27/11 ou 07/12)", d: "2026-11-24", c: "etudes", done: false },
    { id: uid(), t: "Préparer l'exposé UE 1.4 Biomécanique (01/12)", d: "2026-11-29", c: "etudes", done: false }
  );
  S.seeded = true;
}

/* ---------- Utils ---------- */
function uid() { return Math.random().toString(36).slice(2, 10); }
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parse = s => { const [a, b, c] = s.split("-").map(Number); return new Date(a, b - 1, c); };
const TODAY = () => iso(new Date());
const diffDays = s => Math.round((parse(s) - parse(TODAY())) / 864e5);
const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MC = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
const fmtL = ml => (ml / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " L";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const jx = n => n === 0 ? "Aujourd'hui" : n === 1 ? "Demain" : n > 0 ? "J-" + n : "Il y a " + (-n) + " j";
function day(d) { if (!S.days[d]) S.days[d] = { water: 0, meals: [], gym: "", dur: "", gnote: "", sleep: "", energy: 0, mood: "" }; return S.days[d]; }
function toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 2600); }

/* ---------- Sauvegarde & synchro ---------- */
let sb = null, user = null, pushT = null, pushing = false, again = false;
function setDot(state) { $("sync-dot").className = "d " + state; }
function save() {
  S.updatedAt = Date.now();
  try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {}
  if (user) { clearTimeout(pushT); pushT = setTimeout(() => { pushT = null; pushRemote(); }, 800); }
}
async function pushRemote() {
  if (!user) return;
  if (pushing) { again = true; return; }
  pushing = true; setDot("warn");
  const { error } = await sb.from("assistant_state").upsert({ user_id: user.id, data: S, updated_at: new Date(S.updatedAt).toISOString() });
  setDot(error ? "warn" : "ok");
  if (error) console.warn(error);
  pushing = false; if (again) { again = false; pushRemote(); }
}
async function pullRemote() {
  if (!user) return;
  const { data, error } = await sb.from("assistant_state").select("data,updated_at").eq("user_id", user.id).maybeSingle();
  if (error) { setDot("warn"); return; }
  if (!data) { seed(); save(); await pushRemote(); renderAll(); return; }
  const remoteAt = new Date(data.updated_at).getTime();
  if (remoteAt > (S.updatedAt || 0) + 500) {
    S = Object.assign(EMPTY(), data.data); S.updatedAt = remoteAt;
    S.prefs = Object.assign({ evals: true, water: true, tasks: true, evening: true }, S.prefs || {});
    try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {}
    renderAll();
  } else if ((S.updatedAt || 0) > remoteAt + 500) { await pushRemote(); }
  setDot("ok");
  loadEdt();
}
async function initCloud() {
  if (!HAS_CLOUD) { setDot("off"); renderAcct(); return; }
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await sb.auth.getSession();
    user = data.session ? data.session.user : null;
    sb.auth.onAuthStateChange((_e, sess) => { const was = user; user = sess ? sess.user : null; renderAcct(); if (user && !was) pullRemote(); if (!user && was) { EDT = []; try { localStorage.removeItem("thy-edt"); } catch (e) {} } });
    renderAcct();
    if (user) await pullRemote(); else setDot("off");
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullRemote(); });
    setInterval(() => { if (document.visibilityState === "visible" && !pushT) pullRemote(); }, 15000);
  } catch (e) { console.warn(e); setDot("warn"); renderAcct("Impossible de joindre le serveur (hors-ligne ?)."); }
}
function renderAcct(msg) {
  const el = $("acct");
  if (!HAS_CLOUD) {
    el.innerHTML = `<p class="small">Mode <b>local</b> : tes données restent sur cet appareil.</p><p class="small muted" style="margin-top:6px">Pour retrouver les mêmes données partout, remplis <code>config.js</code> avec ton projet Supabase (voir le guide).</p>`;
    return;
  }
  if (user) {
    el.innerHTML = `<p class="small">Connecté : <b>${esc(user.email)}</b></p><p class="small muted" style="margin:4px 0 10px">Synchronisé sur tous tes appareils.</p><div class="row"><button class="btn sec" id="sync-now">Synchroniser</button><button class="btn sec" id="logout">Se déconnecter</button></div>`;
    $("sync-now").onclick = async () => { await pullRemote(); await pushRemote(); toast("Synchronisé ✓"); };
    $("logout").onclick = async () => { await sb.auth.signOut(); toast("Déconnecté"); };
    return;
  }
  el.innerHTML = `${msg ? `<div class="alert">${esc(msg)}</div>` : ""}<p class="small muted" style="margin-bottom:8px">Connecte-toi pour synchroniser entre ton téléphone et ton ordi.</p>
  <form id="login" class="grid" style="gap:8px"><input type="email" id="lg-mail" placeholder="Email" autocomplete="email" required><input type="password" id="lg-pw" placeholder="Mot de passe (6+ caractères)" autocomplete="current-password" required minlength="6">
  <div class="row"><button class="btn teal" data-act="in">Se connecter</button><button class="btn sec" type="button" id="signup">Créer mon compte</button></div></form>`;
  $("login").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $("lg-mail").value.trim(), password: $("lg-pw").value });
    if (error) renderAcct(/confirm/i.test(error.message) ? "Confirme d'abord ton email (lien reçu par mail), puis reconnecte-toi." : "Email ou mot de passe incorrect.");
    else toast("Connecté ✓");
  };
  $("signup").onclick = async () => {
    const email = $("lg-mail").value.trim(), password = $("lg-pw").value;
    if (!email || password.length < 6) return toast("Email + mot de passe (6 caractères min.)");
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split("#")[0] } });
    if (error) renderAcct(error.message);
    else if (!data.session) renderAcct("Compte créé ! Clique sur le lien reçu par mail, puis reviens te connecter ici.");
    else toast("Compte créé ✓");
  };
}

/* ---------- Navigation ---------- */
function show(v) {
  document.querySelectorAll("#tabs button").forEach(t => t.classList.toggle("on", t.dataset.v === v));
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === "v-" + v));
  try { history.replaceState(null, "", "#" + v); } catch (e) {}
  window.scrollTo({ top: 0 });
}
$("tabs").onclick = e => { const b = e.target.closest("button"); if (b) show(b.dataset.v); };
{ const h = location.hash.slice(1); if (["home", "agenda", "evals", "sante", "taches"].includes(h)) show(h); }
$("open-settings").onclick = () => { renderNotif(); $("settings").classList.add("on"); };
$("settings").onclick = e => { if (e.target.id === "settings" || e.target.closest("[data-close]")) $("settings").classList.remove("on"); };

/* ---------- ACCUEIL ---------- */
const upcomingCC = () => CC.filter(c => diffDays(c.date) >= 0 && !isOff(c));
function renderHome() {
  const t = new Date();
  $("today-str").textContent = JOURS[t.getDay()].replace(".", "") + " " + t.getDate() + " " + MOIS[t.getMonth()] + " · P2 ostéo";
  const nx = upcomingCC()[0], he = $("next-eval");
  if (nx) {
    const n = diffDays(nx.date), p = S.rev[nx.id] || 0, d = parse(nx.date);
    he.innerHTML = `<div class="lbl">Prochaine éval</div>
    <div class="row nowrap" style="align-items:flex-end;gap:14px;margin:8px 0 6px"><div class="big">${n === 0 ? "Auj." : n === 1 ? "Demain" : "J-" + n}</div>
    <div><div style="font-family:Fraunces,serif;font-size:19px">${nx.ue} · ${esc(nx.name)}</div><div style="opacity:.75" class="small">${nx.cc} · ${nx.mod} · ${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}</div></div></div>
    ${nx.note ? `<div class="small" style="background:rgba(255,255,255,.1);padding:8px 10px;border-radius:10px;margin:8px 0">📍 ${esc(nx.note)}</div>` : ""}
    <div class="row nowrap small" style="margin-top:8px"><span style="opacity:.8">Révisé</span><div class="bar" style="background:rgba(255,255,255,.15)"><i style="width:${p}%;background:#F59E77"></i></div><b>${p}%</b></div>
    <div class="small" style="opacity:.7;margin-top:10px">Ensuite : ${upcomingCC().slice(1, 4).map(c => c.ue + " (" + jx(diffDays(c.date)) + ")").join(" · ")}</div>`;
  } else he.innerHTML = `<div class="lbl">Prochaine éval</div><div class="big">🎉</div><p>Aucune éval à venir.</p>`;

  const al = [];
  NEWS.filter(n => n.date && diffDays(n.date) >= -14).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 5).forEach(n => al.push(`<div class="alert ${n.type === "cancel" || n.type === "change" ? "" : "info"}">${NEWS_ICON[n.type] || "📩"} <b>${esc(n.title)}</b>${n.body ? " — " + esc(n.body) : ""}<div class="small muted" style="margin-top:2px">${esc(n.source || "Mail de l'école")} · ${parse(n.date).getDate()} ${MC[parse(n.date).getMonth()]}</div></div>`));
  if (diffDays("2026-11-25") >= 0) al.push(`<div class="alert">🎯 <b>CC UE 5.6 PAO LP</b> — mer. 25/11, convocation <b>11h11</b> (passage 11h26), groupe E.</div>`);
  const t58 = S.tasks.find(x => /5\.8/.test(x.t) && /absence/i.test(x.t));
  if (t58 && !t58.done) al.push(`<div class="alert">📩 <b>UE 5.8 (16/11)</b> : noté <b>absent</b>. Vérifie la justification et le rattrapage.</div>`);
  const late = S.tasks.filter(x => !x.done && x.d && x.d < TODAY()).length;
  if (late) al.push(`<div class="alert">⏰ ${late} tâche${late > 1 ? "s" : ""} en retard.</div>`);
  S.events.filter(e => e.d === TODAY()).forEach(e => al.push(`<div class="alert good">🗓️ Aujourd'hui${e.h ? " " + e.h : ""} : ${esc(e.t)}</div>`));
  if (!al.length) al.push(`<div class="alert good">✨ Rien d'urgent. Profite pour avancer tes révisions.</div>`);
  $("alerts").innerHTML = al.join("");

  renderWater(day(TODAY()).water);
  renderGymSeg("gym-home", TODAY());
  renderGymWeek("gymweek-home");
  const wk = countGymWeek();
  $("gym-streak").textContent = `${wk} séance${wk > 1 ? "s" : ""} sur les 7 derniers jours.`;

  const lim = new Date(); lim.setDate(lim.getDate() + 3);
  const tt = S.tasks.filter(x => !x.done && (!x.d || x.d <= iso(lim))).sort((a, b) => (a.d || "") < (b.d || "") ? -1 : 1).slice(0, 6);
  $("home-tasks").innerHTML = tt.length ? tt.map(taskHTML).join("") : `<div class="empty">Rien dans les 3 prochains jours 👌</div>`;

  const items = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(); x.setDate(x.getDate() + i); const s = iso(x); const evs = eventsOn(s);
    if (evs.length) items.push(`<div class="item"><div style="width:62px;flex:none"><b>${i === 0 ? "Auj." : JOURS[x.getDay()] + " " + x.getDate()}</b></div><div>${evs.map(e => `<span class="tag t-${e.type}" style="margin:2px 4px 2px 0">${e.h ? e.h + " · " : ""}${esc(e.t)}</span>`).join("")}</div></div>`);
  }
  $("home-week").innerHTML = items.join("") || `<div class="empty">Rien de prévu. Ajoute tes cours dans l'Agenda.</div>`;

  const pri = upcomingCC().filter(c => diffDays(c.date) <= 21).map(c => ({ c, score: (100 - (S.rev[c.id] || 0)) / Math.max(1, diffDays(c.date)) })).sort((a, b) => b.score - a.score).slice(0, 3);
  $("home-rev").innerHTML = pri.length ? pri.map(({ c }) => {
    const n = diffDays(c.date), p = S.rev[c.id] || 0;
    const tip = c.mod === "Oral" ? "En binôme : interrogatoire → tests (méthodo à voix haute) → diagnostic → technique justifiée." : n <= 3 ? "Points faibles uniquement + QCM d'entraînement." : n <= 7 ? "QCM / Wooflash pour repérer les trous." : "Relis le CM et fais ta fiche synthèse.";
    return `<div class="item"><div style="flex:1"><div class="row"><b>${c.ue}</b><span class="pill ${n <= 3 ? "p-coral" : "p-gold"}">${jx(n)}</span><span class="small muted">${esc(c.name)}</span></div>
    <div class="small muted" style="margin:4px 0">${tip}</div><div class="row nowrap small"><div class="bar"><i style="width:${p}%"></i></div>${p}%</div></div></div>`;
  }).join("") : `<div class="empty">Pas d'éval dans les 3 prochaines semaines.</div>`;
}
function renderWater(ml) {
  $("w-val").textContent = fmtL(ml);
  const pct = Math.min(1, ml / GOAL); const rc = $("ring-c");
  rc.style.strokeDashoffset = 314.16 * (1 - pct); rc.setAttribute("stroke", pct >= 1 ? "#0F766E" : "#2563EB");
  let h = ""; for (let i = 0; i < Math.ceil(GOAL / 250); i++) h += `<div class="gl ${i < ml / 250 ? "f" : ""}"></div>`;
  $("glasses").innerHTML = h;
}
function addWater(dt, v) { const d = day(dt); const before = d.water || 0; d.water = Math.max(0, before + v); save(); renderAll(); if (before < GOAL && d.water >= GOAL) toast("Objectif d'eau atteint 💧🎉"); }
document.querySelectorAll("[data-w]").forEach(b => b.onclick = () => addWater(TODAY(), +b.dataset.w));
document.querySelectorAll("[data-hw]").forEach(b => b.onclick = () => addWater(hDate(), +b.dataset.hw));

const GYM = [["push", "Push"], ["pull", "Pull"], ["legs", "Legs"], ["full", "Full body"], ["padel", "Padel 🎾"], ["cardio", "Cardio"], ["repos", "Repos"]];
function renderGymSeg(id, dt) {
  const d = day(dt), el = $(id);
  el.innerHTML = GYM.map(([k, l]) => `<button data-g="${k}" class="${d.gym === k ? "on" : ""}">${l}</button>`).join("");
  el.onclick = e => { const b = e.target.closest("button"); if (!b) return; d.gym = d.gym === b.dataset.g ? "" : b.dataset.g; save(); renderAll(); };
}
function countGymWeek() { let c = 0; for (let i = 0; i < 7; i++) { const x = new Date(); x.setDate(x.getDate() - i); const g = S.days[iso(x)]; if (g && g.gym && g.gym !== "repos") c++; } return c; }
function renderGymWeek(id) {
  let h = "";
  for (let i = 6; i >= 0; i--) { const x = new Date(); x.setDate(x.getDate() - i); const g = S.days[iso(x)]; const on = g && g.gym && g.gym !== "repos";
    h += `<div class="${on ? "on" : ""}">${JOURS[x.getDay()].slice(0, 2).toUpperCase()}<br>${on ? "💪" : "·"}</div>`; }
  $(id).innerHTML = h;
}

/* ---------- TÂCHES ---------- */
const CAT = { etudes: ["Études", "p-blue"], perso: ["Perso", "p-violet"], sante: ["Santé", "p-teal"], admin: ["Admin", "p-gold"] };
function taskHTML(x) {
  const c = CAT[x.c] || CAT.perso, late = x.d && !x.done && x.d < TODAY();
  return `<div class="item ${x.done ? "done" : ""}"><button class="chk ${x.done ? "on" : ""}" data-tk="${x.id}" aria-label="Cocher"></button><div><div class="t">${esc(x.t)}</div>
  <div class="row small" style="margin-top:3px"><span class="pill ${c[1]}">${c[0]}</span>${x.d ? `<span class="${late ? "pill p-coral" : "muted"}">${late ? "En retard · " : ""}${parse(x.d).getDate()} ${MC[parse(x.d).getMonth()]}</span>` : ""}</div></div><button class="x" data-del="${x.id}" aria-label="Supprimer">×</button></div>`;
}
let tkF = "todo";
function renderTasks() {
  const l = S.tasks.filter(x => tkF === "done" ? x.done : !x.done).sort((a, b) => (a.d || "9") < (b.d || "9") ? -1 : 1);
  $("task-list").innerHTML = l.length ? l.map(taskHTML).join("") : `<div class="empty">${tkF === "done" ? "Aucune tâche terminée." : "Tout est fait 🎉"}</div>`;
}
document.body.addEventListener("click", e => {
  const c = e.target.closest("[data-tk]"); if (c) { const t = S.tasks.find(x => x.id === c.dataset.tk); if (t) { t.done = !t.done; save(); renderAll(); if (t.done) toast("Bien joué ✅"); } return; }
  const d = e.target.closest("[data-del]"); if (d) { S.tasks = S.tasks.filter(x => x.id !== d.dataset.del); save(); renderAll(); return; }
  const de = e.target.closest("[data-delev]"); if (de) { S.events = S.events.filter(x => x.id !== de.dataset.delev); save(); renderAll(); return; }
  const dm = e.target.closest("[data-delmeal]"); if (dm) { day(hDate()).meals.splice(+dm.dataset.delmeal, 1); save(); renderAll(); return; }
  const dr = e.target.closest("[data-delres]"); if (dr) { S.results = S.results.filter(x => x.id !== dr.dataset.delres); save(); renderAll(); }
});
$("tk-filter").onclick = e => { const b = e.target.closest("button"); if (!b) return; tkF = b.dataset.f; [...b.parentNode.children].forEach(x => x.classList.toggle("on", x === b)); renderTasks(); };
$("task-form").onsubmit = e => { e.preventDefault(); const t = $("tk-title"); S.tasks.push({ id: uid(), t: t.value.trim(), d: $("tk-date").value, c: $("tk-cat").value, done: false }); t.value = ""; save(); renderAll(); toast("Tâche ajoutée"); };
$("quick-task").onsubmit = e => { e.preventDefault(); const t = $("qt"); if (!t.value.trim()) return; S.tasks.push({ id: uid(), t: t.value.trim(), d: TODAY(), c: "perso", done: false }); t.value = ""; save(); renderAll(); };

/* ---------- AGENDA ---------- */
let calM = new Date(); calM.setDate(1); let selD = TODAY();
function eventsOn(s) {
  const a = CC.filter(c => c.date === s).map(c => ({ t: (isOff(c) ? "❌ " : "") + c.ue + " " + c.cc + " · " + c.name + (c.status ? " (" + c.status + ")" : ""), type: isOff(c) ? "autre" : "eval", h: c.id === "2026-11-25|UE 5.6|CC1" ? "11:11" : "" }));
  const b = S.events.filter(e => e.d === s).sort((x, y) => (x.h || "") < (y.h || "") ? -1 : 1).map(e => ({ t: e.t, type: e.type, h: e.h, id: e.id }));
  const k = EDT.filter(r => r[0] === s).map(r => ({ t: edtLabel(r), type: "cours", h: r[1] + "–" + r[2] }));
  return a.concat(k.concat(b).sort((x, y) => (x.h || "") < (y.h || "") ? -1 : 1));
}
function renderCal() {
  $("cal-title").textContent = MOIS[calM.getMonth()].replace(/^./, c => c.toUpperCase()) + " " + calM.getFullYear();
  let h = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].map(d => `<div class="dn">${d}</div>`).join("");
  const start = new Date(calM); start.setDate(1 - (start.getDay() + 6) % 7);
  for (let i = 0; i < 42; i++) {
    const x = new Date(start); x.setDate(start.getDate() + i); const s = iso(x); const ev = eventsOn(s);
    h += `<div class="cd ${x.getMonth() !== calM.getMonth() ? "out" : ""} ${s === TODAY() ? "today" : ""} ${s === selD ? "sel" : ""}" data-cd="${s}"><div class="n">${x.getDate()}</div>
    ${ev.slice(0, 3).map(e => `<span class="tag t-${e.type}">${esc(e.t)}</span>`).join("")}<div class="dots">${ev.slice(0, 4).map(e => `<s class="t-${e.type}"></s>`).join("")}</div></div>`;
  }
  $("cal").innerHTML = h;
  const sd = parse(selD); $("day-title").textContent = JOURS[sd.getDay()] + " " + sd.getDate() + " " + MOIS[sd.getMonth()];
  const ev = eventsOn(selD);
  $("day-list").innerHTML = ev.length ? ev.map(e => `<div class="item"><span class="tag t-${e.type}">${e.h || "—"}</span><div class="t">${esc(e.t)}</div>${e.id ? `<button class="x" data-delev="${e.id}">×</button>` : ""}</div>`).join("") : `<div class="empty">Rien ce jour-là.</div>`;
  $("ev-date").value = selD;
}
$("cal").onclick = e => { const c = e.target.closest("[data-cd]"); if (!c) return; selD = c.dataset.cd; renderCal(); };
$("prev").onclick = () => { calM.setMonth(calM.getMonth() - 1); renderCal(); };
$("next").onclick = () => { calM.setMonth(calM.getMonth() + 1); renderCal(); };
$("ev-form").onsubmit = e => {
  e.preventDefault(); const t = $("ev-title");
  S.events.push({ id: uid(), t: t.value.trim(), d: $("ev-date").value, h: $("ev-time").value, type: $("ev-type").value });
  selD = $("ev-date").value; t.value = ""; save(); renderAll(); toast("Événement ajouté");
};

/* ---------- ÉVALS ---------- */
let evF = "up";
function renderEvals() {
  let l = CC.filter(c => evF === "all" ? true : evF === "up" ? diffDays(c.date) >= 0 : diffDays(c.date) < 0);
  if (evF === "past") l = l.slice().reverse();
  $("ev-list").innerHTML = l.map(c => {
    const n = diffDays(c.date), d = parse(c.date), p = S.rev[c.id] || 0;
    const mc = c.mod === "QCM" ? "p-blue" : c.mod === "Oral" ? "p-violet" : "p-gold";
    const off = isOff(c);
    return `<div class="ev ${n >= 0 && n <= 7 && !off ? "soon" : ""} ${n < 0 || off ? "past" : ""}"><div class="d"><small>${JOURS[d.getDay()]}</small><b>${d.getDate()}</b><small>${MC[d.getMonth()]}</small></div>
    <div><div class="row"><b>${c.ue}</b><span style="${off ? "text-decoration:line-through" : ""}">${esc(c.name)}</span>${c.status ? `<span class="pill p-coral">${esc(c.status)}</span>` : ""}</div><div class="row" style="margin-top:4px"><span class="pill ${mc}">${c.mod}</span><span class="pill p-grey">${c.cc}</span>${n >= 0 ? `<span class="pill ${n <= 7 ? "p-coral" : "p-teal"}">${jx(n)}</span>` : ""}</div>
    ${c.note ? `<div class="small muted" style="margin-top:4px">📍 ${esc(c.note)}</div>` : ""}
    ${n >= 0 && !off ? `<div class="row nowrap small" style="margin-top:6px"><span class="muted">Révisé</span><input type="range" min="0" max="100" step="10" value="${p}" data-rev="${esc(c.id)}" style="flex:1;max-width:260px"><b style="width:38px">${p}%</b></div>` : ""}</div></div>`;
  }).join("") || `<div class="empty">Rien ici.</div>`;
  const all = BASE_RESULTS.concat(S.results);
  $("results").innerHTML = all.map(r => `<div class="item" style="display:block"><div class="row"><b>${esc(r.ue)}</b><span class="pill ${r.cls || "p-teal"}">${esc(r.note)}</span><span class="small muted">${esc(r.date || "")}</span>${S.results.includes(r) ? `<button class="x" data-delres="${r.id}">×</button>` : ""}</div>
   ${r.good ? `<div class="small" style="margin-top:6px;color:var(--teal)"><b>Acquis :</b> ${r.good.map(esc).join(" · ")}</div>` : ""}
   ${r.bad && r.bad.length ? `<div class="small" style="margin-top:4px;color:var(--coral)"><b>${r.good ? "À retravailler :" : "⚠️"}</b> ${r.bad.map(esc).join(" · ")}</div>` : ""}</div>`).join("");
}
$("ev-list").addEventListener("input", e => { const r = e.target.closest("[data-rev]"); if (!r) return; S.rev[r.dataset.rev] = +r.value; r.nextElementSibling.textContent = r.value + "%"; });
$("ev-list").addEventListener("change", e => { if (e.target.closest("[data-rev]")) { save(); renderHome(); } });
$("ev-filter").onclick = e => { const b = e.target.closest("button"); if (!b) return; evF = b.dataset.f; [...b.parentNode.children].forEach(x => x.classList.toggle("on", x === b)); renderEvals(); };
$("res-form").onsubmit = e => {
  e.preventDefault(); const t = new Date();
  S.results.push({ id: uid(), ue: $("res-ue").value.trim(), note: $("res-note").value.trim(), date: pad(t.getDate()) + "/" + pad(t.getMonth() + 1), bad: $("res-com").value.trim() ? [$("res-com").value.trim()] : [], cls: "p-teal" });
  ["res-ue", "res-note", "res-com"].forEach(i => $(i).value = ""); save(); renderEvals(); toast("Note ajoutée");
};

/* ---------- SANTÉ ---------- */
const hd = $("h-date"); hd.value = TODAY();
const hDate = () => hd.value || TODAY();
hd.onchange = () => renderSante(); $("h-today").onclick = () => { hd.value = TODAY(); renderSante(); };
const MOODS = ["😞", "😐", "🙂", "😄", "🔥"];
function renderSante() {
  const dt = hDate(), d = day(dt);
  $("h-water").textContent = fmtL(d.water || 0);
  renderGymSeg("gym-h", dt);
  const gd = $("gym-dur"), gn = $("gym-note"), sl = $("sleep");
  gd.value = d.dur || ""; gn.value = d.gnote || ""; sl.value = d.sleep || "";
  gd.onchange = () => { d.dur = gd.value; save(); }; gn.onchange = () => { d.gnote = gn.value; save(); }; sl.onchange = () => { d.sleep = sl.value; save(); renderWeek(); };
  $("energy").innerHTML = [1, 2, 3, 4, 5].map(i => `<button data-en="${i}" class="${d.energy >= i ? "on" : ""}">★</button>`).join("");
  $("energy").onclick = e => { const b = e.target.closest("button"); if (!b) return; d.energy = +b.dataset.en; save(); renderSante(); };
  $("mood").innerHTML = MOODS.map(m => `<button data-m="${m}" class="${d.mood === m ? "on" : ""}" style="font-size:18px;padding:4px 8px">${m}</button>`).join("");
  $("mood").onclick = e => { const b = e.target.closest("button"); if (!b) return; d.mood = b.dataset.m; save(); renderSante(); };
  $("meals").innerHTML = d.meals.length ? d.meals.map((m, i) => `<div class="meal"><span class="k">${esc(m.k)}</span><span>${esc(m.d)}</span><button class="x" data-delmeal="${i}">×</button></div>`).join("") : `<div class="empty">Aucun repas noté pour ce jour.</div>`;
  renderWeek();
}
$("meal-form").onsubmit = e => { e.preventDefault(); const i = $("meal-d"); day(hDate()).meals.push({ k: $("meal-k").value, d: i.value.trim() }); i.value = ""; save(); renderSante(); };
function renderWeek() {
  let h = "", tot = 0, ok = 0, sl = 0, sn = 0;
  for (let i = 6; i >= 0; i--) {
    const x = new Date(); x.setDate(x.getDate() - i); const g = S.days[iso(x)] || {}; const w = g.water || 0;
    tot += w; if (w >= GOAL) ok++; if (+g.sleep) { sl += +g.sleep; sn++; }
    h += `<div class="c"><em>${w ? (w / 1000).toFixed(1) : ""}</em><i class="${w >= GOAL ? "goal" : ""}" style="height:${Math.min(100, w / 3500 * 100)}%"></i><small>${JOURS[x.getDay()].slice(0, 2)}</small></div>`;
  }
  $("w-chart").innerHTML = h; renderGymWeek("gymweek");
  $("week-kpi").innerHTML = `<div><span class="lbl">Moy. eau</span><b>${fmtL(tot / 7)}</b></div><div><span class="lbl">Objectif</span><b>${ok}/7</b></div><div><span class="lbl">Séances</span><b>${countGymWeek()}</b></div><div><span class="lbl">Sommeil</span><b>${sn ? (sl / sn).toFixed(1) + " h" : "—"}</b></div>`;
}

/* ---------- NOTIFICATIONS ---------- */
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
let swReg = null;
function b64ToU8(s) { const p = "=".repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...b].map(c => c.charCodeAt(0))); }
async function renderNotif() {
  document.querySelectorAll("[data-pref]").forEach(b => b.classList.toggle("on", !!S.prefs[b.dataset.pref]));
  const st = $("notif-status");
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    st.innerHTML = isIOS && !standalone ? "📲 Sur iPhone, installe d'abord l'app sur l'écran d'accueil (voir plus bas), puis ouvre-la depuis l'icône pour activer les notifications." : "Ce navigateur ne gère pas les notifications push.";
    $("notif-on").disabled = true; return;
  }
  if (!HAS_CLOUD) { st.textContent = "Les rappels automatiques nécessitent la synchro (config.js)."; $("notif-on").disabled = true; return; }
  if (!user) { st.textContent = "Connecte-toi d'abord (section Compte)."; $("notif-on").disabled = true; return; }
  $("notif-on").disabled = false;
  const sub = swReg && await swReg.pushManager.getSubscription();
  st.innerHTML = Notification.permission === "denied" ? "🚫 Notifications bloquées dans les réglages du navigateur / téléphone." : sub ? "✅ Activées sur cet appareil." : "Pas encore activées sur cet appareil.";
  $("notif-on").textContent = sub ? "Réactiver" : "Activer sur cet appareil";
}
document.querySelectorAll("[data-pref]").forEach(b => b.onclick = () => { S.prefs[b.dataset.pref] = !S.prefs[b.dataset.pref]; save(); renderNotif(); });
$("notif-on").onclick = async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("Permission refusée");
    swReg = swReg || await navigator.serviceWorker.ready;
    let sub = await swReg.pushManager.getSubscription();
    if (!sub) sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(CFG.VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    const { error } = await sb.from("push_subs").upsert({ user_id: user.id, endpoint: j.endpoint, sub: j, device: (isIOS ? "iPhone" : navigator.platform || "appareil") }, { onConflict: "endpoint" });
    if (error) { console.warn(error); return toast("Erreur d'enregistrement"); }
    toast("Notifications activées 🔔"); renderNotif();
  } catch (e) { console.warn(e); toast("Impossible d'activer : " + e.message); }
};
$("notif-test").onclick = async () => {
  if (!sb || !user) return toast("Connecte-toi d'abord");
  const { error } = await sb.functions.invoke("reminders", { body: { test: true } });
  toast(error ? "Test impossible (fonction pas encore déployée ?)" : "Notification envoyée 📨");
};

/* ---------- Export calendrier (.ics) ---------- */
function download(name, text, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
$("ics").onclick = () => {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Assistant Thyvan//FR", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Évals P2"];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  upcomingCC().forEach(c => {
    const d = c.date.replace(/-/g, ""); const nd = iso(new Date(parse(c.date).getTime() + 864e5)).replace(/-/g, "");
    const special = c.id === "2026-11-25|UE 5.6|CC1";
    L.push("BEGIN:VEVENT", "UID:" + c.id.replace(/[^\w]/g, "") + "@assistant-thyvan", "DTSTAMP:" + stamp,
      special ? "DTSTART;TZID=Europe/Paris:" + d + "T111100" : "DTSTART;VALUE=DATE:" + d,
      special ? "DTEND;TZID=Europe/Paris:" + d + "T114000" : "DTEND;VALUE=DATE:" + nd,
      "SUMMARY:🎯 " + c.ue + " " + c.cc + " — " + c.name + " (" + c.mod + ")",
      "DESCRIPTION:" + (c.note || "Contrôle continu P2").replace(/[,;]/g, "\\$&"),
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Éval demain", special ? "TRIGGER:-PT15H11M" : "TRIGGER:-PT4H", "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Éval aujourd'hui", special ? "TRIGGER:-PT2H" : "TRIGGER:PT7H", "END:VALARM",
      "END:VEVENT");
  });
  L.push("END:VCALENDAR");
  download("evals-P2.ics", L.join("\r\n"), "text/calendar");
};

/* ---------- Sauvegarde fichier ---------- */
$("export").textContent = "Exporter (.json)";
$("export").onclick = () => download("assistant-sauvegarde-" + TODAY() + ".json", JSON.stringify(S, null, 1), "application/json");
$("import").onclick = () => {
  const i = document.createElement("input"); i.type = "file"; i.accept = "application/json,.json";
  i.onchange = async () => { try { const j = JSON.parse(await i.files[0].text()); S = Object.assign(EMPTY(), j); save(); renderAll(); toast("Données importées ✓"); } catch (e) { toast("Fichier invalide"); } };
  i.click();
};

/* ---------- Installation ---------- */
let deferred = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; $("install").style.display = "inline-block"; });
$("install").onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $("install").style.display = "none"; };

/* ---------- Démarrage ---------- */
function renderAll() { renderHome(); renderCal(); renderEvals(); renderSante(); renderTasks(); }
seed(); try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {}
renderAll();
let lastDay = TODAY();
setInterval(() => { if (TODAY() !== lastDay) { lastDay = TODAY(); hd.value = lastDay; renderAll(); } }, 60000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(r => { swReg = r; }).catch(e => console.warn(e));
initCloud();
function loadNews() { fetch("news.json?ts=" + Date.now(), { cache: "no-store" }).then(r => r.ok ? r.json() : []).then(j => { NEWS = Array.isArray(j) ? j : (j.items || []); renderAll(); }).catch(() => {}); }
loadNews();
$("refresh").onclick = async () => {
  const b = $("refresh"); b.classList.add("spin");
  try {
    if (user) { if (pushT) { clearTimeout(pushT); pushT = null; await pushRemote(); } await pullRemote(); await loadEdt(true); }
    loadNews(); if (swReg) swReg.update().catch(() => {});
  } catch (e) { console.warn(e); }
  renderAll(); setTimeout(() => b.classList.remove("spin"), 500);
  toast(user ? "À jour ✓" : "Actualisé · connecte-toi pour synchroniser");
};
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadNews(); });
