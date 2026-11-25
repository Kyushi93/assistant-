// Assistant Thyvan — application (données locales + synchro Supabase + notifications push)
const CFG = window.APP_CONFIG || {};
const HAS_CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
let GOAL = 2500;
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
  $("scroller").scrollTo({ top: 0 });
}
$("tabs").onclick = e => { const b = e.target.closest("button"); if (b) show(b.dataset.v); };
{ const h = location.hash.slice(1); if (["home", "agenda", "evals", "sante", "stats", "taches"].includes(h)) show(h); }
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
const CAT = { etudes: ["Études", "p-blue"], perso: ["Perso", "p-violet"], projet: ["Projets", "p-coral"], sante: ["Santé", "p-teal"], admin: ["Admin", "p-gold"] };
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
// Couleurs reprises d'Aurion : PAO rose, CM bleu foncé, TD bleu clair, clinique turquoise, éval rouge
const KCOL = { pao: "#F266CF", cm: "#111E93", td: "#0F63EE", clin: "#008080", eval: "#DC2626", perso: "#7C3AED", sante: "#0F766E", autre: "#6B746F", cours: "#0F63EE", off: "#9CA3AF" };
const KNAME = { pao: "PAO", cm: "CM", td: "TD", clin: "Clinique", eval: "Éval", perso: "Perso", sante: "Santé", autre: "Autre", cours: "Cours", off: "Annulé" };
const EKIND = { TP_PAO: "pao", CM: "cm", TD: "td", FC_I: "clin" };
function profName(p) {
  if (!p) return "";
  return p.split(/\s*,\s*/).map(x => { const m = x.match(/^([A-ZÀ-Ý' \-]+?)\s*([A-ZÀ-Ý][a-zà-ÿ].*)$/); return m ? m[2] + " " + m[1].charAt(0) + m[1].slice(1).toLowerCase() : x; }).join(", ");
}
function ueName(code) { const c = CC.find(x => x.ue === "UE " + code); return c ? c.name : ""; }
// Tous les éléments d'une journée, au même format
function dayItems(s) {
  const out = [];
  CC.filter(c => c.date === s).forEach(c => out.push({ k: isOff(c) ? "off" : "eval", s: c.id === "2026-11-25|UE 5.6|CC1" ? "11:11" : "", e: "", title: (isOff(c) ? "❌ " : "") + c.ue + " " + c.cc + " · " + c.name, sub: c.mod + (c.status ? " · " + c.status : ""), room: "", prof: "", note: c.note }));
  EDT.filter(r => r[0] === s).forEach(r => {
    const ep = r[9] === 1 || r[9] === true;
    out.push({ k: ep ? "eval" : (EKIND[r[4]] || "td"), s: r[1], e: r[2], title: (ep ? "🎯 " : "") + "UE " + r[3] + " · " + (r[7] || ueName(r[3]) || ""), sub: (KNAME[EKIND[r[4]]] || r[4]) + (r[6] ? " · " + r[6] : ""), room: r[5] || "", prof: profName(r[8] || "") });
  });
  S.events.filter(e => e.d === s).forEach(e => out.push({ k: e.type === "eval" ? "eval" : e.type === "cours" ? "td" : (e.type || "autre"), s: e.h || "", e: "", title: e.t, sub: KNAME[e.type] || "", room: "", prof: "", id: e.id }));
  return out.sort((a, b) => (a.s || "99") < (b.s || "99") ? -1 : 1);
}
// Compatibilité (accueil : 7 prochains jours)
function eventsOn(s) { return dayItems(s).map(i => ({ t: i.title + (i.room ? " · " + i.room : ""), type: i.k, h: i.s ? i.s + (i.e ? "–" + i.e : "") : "", id: i.id })); }

function card(i, big) {
  return `<div class="ecard ${big ? "lg" : ""}" style="--c:${KCOL[i.k] || KCOL.autre}">
    <div class="et">${i.s ? `<b>${i.s.replace(":", "h")}</b>${i.e ? `<span>${i.e.replace(":", "h")}</span>` : ""}` : `<b>—</b>`}</div>
    <div class="eb"><div class="ek">${KNAME[i.k] || ""}${i.sub && i.sub !== KNAME[i.k] ? ` · ${esc(i.sub.replace(KNAME[i.k] + " · ", "").replace(KNAME[i.k], ""))}` : ""}</div>
      <div class="en">${esc(i.title)}</div>
      ${i.room ? `<div class="er">📍 ${esc(i.room)}</div>` : ""}
      ${i.prof ? `<div class="ep">👤 ${esc(i.prof)}</div>` : ""}
      ${i.note ? `<div class="ep">${esc(i.note)}</div>` : ""}
    </div>${i.id ? `<button class="x" data-delev="${i.id}" aria-label="Supprimer">×</button>` : ""}</div>`;
}

let calView = "week"; let selD = TODAY();
// Le week-end, l'agenda s'ouvre directement sur la semaine suivante
if ([0, 6].includes(new Date().getDay())) selD = (() => { const d = new Date(); d.setDate(d.getDate() + (d.getDay() === 6 ? 2 : 1)); return iso(d); })();
const addD = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const monday = s => { const d = parse(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); };
function renderCal() {
  document.querySelectorAll("#cal-views button").forEach(b => b.classList.toggle("on", b.dataset.cv === calView));
  const d = parse(selD); let title = "", h = "";
  if (calView === "month") {
    title = MOIS[d.getMonth()].replace(/^./, c => c.toUpperCase()) + " " + d.getFullYear();
    h = `<div class="mgrid">` + ["L", "M", "M", "J", "V", "S", "D"].map(x => `<div class="dn">${x}</div>`).join("");
    const first = new Date(d.getFullYear(), d.getMonth(), 1); const start = new Date(first); start.setDate(1 - (first.getDay() + 6) % 7);
    for (let i = 0; i < 42; i++) {
      const x = new Date(start); x.setDate(start.getDate() + i); const s = iso(x); const it = dayItems(s);
      if (i >= 35 && x.getMonth() !== d.getMonth()) break;
      h += `<button class="mc ${x.getMonth() !== d.getMonth() ? "out" : ""} ${s === TODAY() ? "today" : ""} ${s === selD ? "sel" : ""}" data-cd="${s}"><span class="n">${x.getDate()}</span>
        <span class="bars">${it.slice(0, 5).map(e => `<i style="background:${KCOL[e.k]}"></i>`).join("")}</span>
        <span class="mt">${it.slice(0, 3).map(e => `<em style="background:${KCOL[e.k]}">${e.s ? e.s.replace(":", "h") + " " : ""}${esc(e.title.replace(/^UE /, ""))}</em>`).join("")}</span></button>`;
    }
    h += `</div><p class="small muted" style="margin-top:8px">Touche un jour pour voir le détail.</p>`;
  } else if (calView === "week") {
    const m = monday(selD); const sun = addD(m, 6);
    title = `${parse(m).getDate()} ${MC[parse(m).getMonth()]} – ${parse(sun).getDate()} ${MC[parse(sun).getMonth()]}`;
    h = `<div class="wgrid">`;
    for (let i = 0; i < 7; i++) {
      const s = addD(m, i); const it = dayItems(s); const x = parse(s);
      if ((i >= 5 && !it.length) || (m === monday(TODAY()) && s < TODAY())) continue;
      h += `<div class="wday ${s === TODAY() ? "today" : ""}"><button class="wh" data-cd="${s}">${JOURS[x.getDay()]} <b>${x.getDate()}</b>${s === TODAY() ? ' <span class="pill p-teal">Auj.</span>' : ""}</button>
        ${it.length ? it.map(e => card(e)).join("") : `<div class="empty">Rien</div>`}</div>`;
    }
    if (!h.includes("wday")) h += `<div class="empty" style="padding:24px 0;text-align:center">Plus rien cette semaine 🙌 Appuie sur → pour la suivante.</div>`;
    h += `</div>`;
  } else {
    title = JOURS[d.getDay()] + " " + d.getDate() + " " + MOIS[d.getMonth()];
    const it = dayItems(selD);
    h = it.length ? `<div class="dlist">${it.map(e => card(e, true)).join("")}</div>` : `<div class="empty" style="padding:30px 0;text-align:center">Rien de prévu ce jour-là 🙌</div>`;
  }
  $("cal-title").textContent = title.replace(/^./, c => c.toUpperCase());
  $("cal-body").innerHTML = h;
  $("ev-date").value = selD;
}
$("cal-views").onclick = e => { const b = e.target.closest("[data-cv]"); if (!b) return; calView = b.dataset.cv; renderCal(); };
$("cal-body").onclick = e => { const c = e.target.closest("[data-cd]"); if (!c) return; selD = c.dataset.cd; calView = "day"; renderCal(); $("scroller").scrollTo({ top: 0, behavior: "smooth" }); };
$("prev").onclick = () => { const d = parse(selD); if (calView === "month") { d.setDate(1); d.setMonth(d.getMonth() - 1); selD = iso(d); } else selD = addD(selD, calView === "week" ? -7 : -1); renderCal(); };
$("next").onclick = () => { const d = parse(selD); if (calView === "month") { d.setDate(1); d.setMonth(d.getMonth() + 1); selD = iso(d); } else selD = addD(selD, calView === "week" ? 7 : 1); renderCal(); };
$("cal-today").onclick = () => { selD = TODAY(); renderCal(); };
// Glisser à gauche / à droite pour changer de période
{ let x0 = null; const el = $("cal-body"); el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true }); el.addEventListener("touchend", e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 70) $(dx < 0 ? "next" : "prev").click(); x0 = null; }); }
$("ev-form").onsubmit = e => {
  e.preventDefault(); const t = $("ev-title");
  S.events.push({ id: uid(), t: t.value.trim(), d: $("ev-date").value, h: $("ev-time").value, type: $("ev-type").value });
  selD = $("ev-date").value; t.value = ""; save(); renderAll(); toast("Événement ajouté");
};

/* ---------- Cours du jour (accueil) ---------- */
function renderToday() {
  const now = new Date(); const hm = pad(now.getHours()) + ":" + pad(now.getMinutes());
  let s = TODAY(); let it = dayItems(s).filter(i => i.k !== "perso" && i.k !== "sante" && i.k !== "autre");
  let label = "Aujourd'hui";
  if (!it.length || it.every(i => (i.e || i.s || "00:00") < hm)) {
    for (let n = 1; n <= 14; n++) { const s2 = addD(TODAY(), n); const it2 = dayItems(s2).filter(i => ["pao", "cm", "td", "clin", "eval"].includes(i.k)); if (it2.length) { s = s2; it = it2; const x = parse(s2); label = n === 1 ? "Demain" : JOURS[x.getDay()].replace(".", "") + " " + x.getDate() + " " + MC[x.getMonth()]; break; } }
  }
  const box = $("today-courses");
  if (!it.length) { box.innerHTML = `<h3>📚 Mes cours</h3><div class="empty">Pas de cours dans les 2 prochaines semaines.</div>`; return; }
  const nextI = s === TODAY() ? it.findIndex(i => (i.e || i.s) >= hm) : 0;
  box.innerHTML = `<div class="row" style="justify-content:space-between"><h3 style="margin:0">📚 Mes cours · ${label}</h3><span class="small muted">${it.length} créneau${it.length > 1 ? "x" : ""}</span></div>
    <div class="tlist">${it.map((i, n) => `<div class="tc ${s === TODAY() && (i.e || i.s) < hm ? "done" : ""} ${n === nextI ? "next" : ""}" style="--c:${KCOL[i.k]}">
      <div class="th"><b>${i.s ? i.s.replace(":", "h") : "—"}</b><span>${i.e ? i.e.replace(":", "h") : ""}</span></div>
      <div class="tb"><div class="tk">${KNAME[i.k]}${n === nextI && s === TODAY() ? (i.s <= hm ? " · en cours" : " · prochain") : ""}</div>
        <div class="tn">${esc(i.title)}</div>
        ${i.room ? `<div class="troom">📍 ${esc(i.room)}</div>` : ""}
        ${i.prof ? `<div class="tprof">👤 ${esc(i.prof)}</div>` : ""}
      </div></div>`).join("")}</div>`;
}

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
  const wt = $("weight"); if (wt) { wt.value = d.weight || ""; wt.onchange = () => { const v = parseFloat(String(wt.value).replace(",", ".")); if (v > 30 && v < 250) d.weight = v; else delete d.weight; save(); renderSante(); }; }
  if ($("bulk-card")) $("bulk-card").innerHTML = bulkPanel();
  $("energy").innerHTML = [1, 2, 3, 4, 5].map(i => `<button data-en="${i}" class="${d.energy >= i ? "on" : ""}">★</button>`).join("");
  $("energy").onclick = e => { const b = e.target.closest("button"); if (!b) return; d.energy = +b.dataset.en; save(); renderSante(); };
  $("mood").innerHTML = MOODS.map(m => `<button data-m="${m}" class="${d.mood === m ? "on" : ""}" style="font-size:18px;padding:4px 8px">${m}</button>`).join("");
  $("mood").onclick = e => { const b = e.target.closest("button"); if (!b) return; d.mood = b.dataset.m; save(); renderSante(); };
  renderMeals();
  renderWeek();
}
$("meal-form").onsubmit = e => { e.preventDefault(); const i = $("meal-d"); day(hDate()).meals.push({ k: $("meal-k").value, d: i.value.trim() }); i.value = ""; save(); renderSante(); };
function renderWeek() {
  const G = goals(), GW = G.water * 1000; let wT = 0, wOk = 0, sl = 0, sn = 0, slOk = 0, gym = 0, kc = 0, kn = 0, pr = 0, st = 0, rows = "";
  for (let i = 6; i >= 0; i--) {
    const x = new Date(); x.setDate(x.getDate() - i); const s = iso(x), g = S.days[s] || {};
    const w = g.water || 0, slp = +g.sleep || 0, gy = g.gym && g.gym !== "repos" ? g.gym : (g.gym === "repos" ? "repos" : ""), mm = dayMacros(g), stu = +g.study || 0;
    wT += w; if (w >= GW) wOk++; if (slp) { sl += slp; sn++; if (slp >= G.sleep) slOk++; } if (gy && gy !== "repos") gym++; if (mm.n) { kc += mm.kcal; pr += mm.p; kn++; } st += stu;
    const cell = (ok, txt, empty) => `<td class="${txt === "" ? "na" : ok ? "ok" : "ko"}">${txt === "" ? (empty || "·") : txt}</td>`;
    rows += `<tr class="${i === 0 ? "today" : ""}"><th>${JOURS[x.getDay()].slice(0, 3)}<small>${x.getDate()}</small></th>
      <td class="wbar ${w >= GW ? "ok" : w ? "ko" : "na"}"><i style="width:${Math.min(100, w / GW * 100)}%"></i><span>${w ? (w / 1000).toFixed(1).replace(".", ",") : "·"}</span></td>
      ${cell(slp >= G.sleep, slp ? String(slp).replace(".", ",") + " h" : "")}
      ${gy === "repos" ? `<td class="na">😌 repos</td>` : cell(!!gy, gy ? "💪 " + gy : "")}
      ${cell(mm.n && mm.p >= G.prot * 0.8, mm.n ? Math.round(mm.kcal) : "")}
      ${cell(stu >= G.study, stu ? fmtMin(stu) : "")}</tr>`;
  }
  $("wk-table").innerHTML = `<table class="wkt"><thead><tr><th></th><th>💧 Eau (L)</th><th>😴</th><th>🏋️</th><th>🍽️ kcal</th><th>📚</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small muted" style="margin-top:6px">Vert = objectif atteint · rouge = en dessous · gris = rien noté.</p>`;
  const card = (ic, title, big, sub, pct, col) => `<div class="wsum"><div class="ws-h"><span>${ic} ${title}</span><b>${big}</b></div><div class="bar"><i style="width:${Math.min(100, pct)}%;background:${col}"></i></div><small>${sub}</small></div>`;
  $("wk-sum").innerHTML =
    card("💧", "Eau", fmtL(wT / 7) + "/j", `objectif ${fmtL(GW)} · atteint ${wOk} jour${wOk > 1 ? "s" : ""} sur 7`, wT / 7 / GW * 100, "#2563EB") +
    card("😴", "Sommeil", sn ? (sl / sn).toFixed(1).replace(".", ",") + " h/nuit" : "—", sn ? `objectif ${G.sleep} h · ${slOk} nuit${slOk > 1 ? "s" : ""} OK sur ${sn} notées` : "note ton sommeil chaque matin", sn ? sl / sn / G.sleep * 100 : 0, "#7C3AED") +
    card("🏋️", "Sport", gym + " séance" + (gym > 1 ? "s" : ""), `objectif ${G.sport} par semaine`, gym / G.sport * 100, "#E4572E") +
    card("🍽️", "Nutrition", kn ? Math.round(kc / kn) + " kcal/j" : "—", kn ? `${Math.round(pr / kn)} g de protéines/j · objectif ${G.kcal} kcal, ${G.prot} g` : "ajoute tes repas avec ✨", kn ? kc / kn / G.kcal * 100 : 0, "#0F766E") +
    card("📚", "Révisions", fmtMin(st), `objectif ${fmtMin(G.study * 7)} sur la semaine`, st / (G.study * 7) * 100, "#C98B12");
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
function renderAll() { renderToday(); renderStats(); renderHome(); renderCal(); renderEvals(); renderSante(); renderTasks(); }
seed(); try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {}
renderAll();
let lastDay = TODAY();
setInterval(() => { if (TODAY() !== lastDay) { lastDay = TODAY(); hd.value = lastDay; renderAll(); } else renderToday(); }, 60000);
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => { swReg = r; try { r.update(); } catch (e) {} }).catch(e => console.warn(e));
  let reloaded = false; const hadCtrl = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadCtrl && !reloaded) { reloaded = true; location.reload(); } });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && swReg) { try { swReg.update(); } catch (e) {} } });
}
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

/* ---------- v9 : objectifs, statistiques, macros, thème ---------- */
var DEF_GOALS = { water: 2.5, sleep: 8, sport: 4, kcal: 2600, prot: 110 };
function goals() { return Object.assign({ water: 2.5, sleep: 8, sport: 4, kcal: 2950, prot: 140, carb: 440, fat: 70, wrate: 0.25, study: 60 }, S.goals || {}); }
function syncGoal() { GOAL = Math.round(goals().water * 1000); const w = document.querySelector(".ring .v .small"); if (w) w.textContent = "/ " + fmtL(GOAL); const hw = $("h-goal"); if (hw) hw.textContent = fmtL(GOAL); }

/* Thème clair / sombre */
function applyTheme() {
  let t = "auto"; try { t = localStorage.getItem("thy-theme") || "auto"; } catch (e) {}
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? "#0E1413" : "#16211F";
  document.querySelectorAll("[data-theme-btn]").forEach(b => b.classList.toggle("on", b.dataset.themeBtn === t));
}
document.querySelectorAll("[data-theme-btn]").forEach(b => b.onclick = () => { try { localStorage.setItem("thy-theme", b.dataset.themeBtn); } catch (e) {} applyTheme(); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
applyTheme();

/* Base d'aliments (table Ciqual de l'ANSES) */
var FOOD = null;
const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/g, "oe").replace(/[^a-z0-9 ]/g, " ");
const ALIAS = { pates: "pates", spaghetti: "pates", spaghettis: "pates", coquillettes: "pates", steak: "boeuf steak", oeufs: "oeuf", frites: "frites", yaourt: "yaourt", whey: "proteine lactoserum" };
async function loadFood() { if (FOOD) return FOOD; const r = await fetch("ciqual.json"); FOOD = (await r.json()).map(x => ({ n: x[0], k: x[1], p: x[2], c: x[3], f: x[4], g: x[5], s: " " + norm(x[0]) + " " })); return FOOD; }
function parseQty(txt) { const m = txt.match(/(\d+(?:[.,]\d+)?)\s*(g|gr|grammes?|ml|cl|kg)\b/i); if (!m) return null; let v = parseFloat(m[1].replace(",", ".")); const u = m[2].toLowerCase(); if (u === "kg") v *= 1000; if (u === "cl") v *= 10; return { g: Math.round(v), rest: txt.replace(m[0], " ") }; }
function searchFood(q) {
  const toks = norm(q).split(/\s+/).filter(t => t.length > 1 && !["de", "du", "la", "le", "les", "au", "aux", "et", "avec", "des", "un", "une"].includes(t)).map(t => ALIAS[t] || t).join(" ").split(" ");
  if (!toks.length || !FOOD) return [];
  const wantRaw = /\bcru/.test(norm(q)), wantJuice = /jus|nectar|sauce|sirop/.test(norm(q));
  return FOOD.map(it => {
    let sc = 0, hit = 0;
    toks.forEach((t, i) => { const sg = t.length > 3 ? t.replace(/s$/, "") : t; if (it.s.includes(" " + t + " ")) { sc += 13; hit++; if (it.s.startsWith(" " + t + " ")) sc += i === 0 ? 8 : 3; } else if (it.s.includes(" " + sg)) { sc += 9; hit++; if (it.s.startsWith(" " + sg)) sc += i === 0 ? 6 : 2; } else if (it.s.includes(sg)) { sc += 4; hit++; } });
    if (hit < Math.max(1, Math.ceil(toks.length * 0.6))) return null;
    if (/ cuit/.test(it.s) && !wantRaw) sc += 3;
    if (/ cru/.test(it.s) && !wantRaw) sc -= 2;
    if (!wantJuice && /^ (jus|nectar|sauce|sirop|arome|graisse|farine)/.test(it.s)) sc -= 8;
    sc -= it.n.length / 25;
    return { it, sc };
  }).filter(Boolean).sort((a, b) => b.sc - a.sc).slice(0, 8).map(x => x.it);
}
async function searchOFF(q) {
  const r = await fetch("https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&json=1&page_size=8&fields=product_name,brands,nutriments&search_terms=" + encodeURIComponent(q));
  const j = await r.json();
  return (j.products || []).filter(p => p.nutriments && p.nutriments["energy-kcal_100g"] != null && p.product_name).map(p => ({ n: p.product_name + (p.brands ? " (" + p.brands.split(",")[0] + ")" : ""), k: Math.round(p.nutriments["energy-kcal_100g"]), p: +(p.nutriments.proteins_100g || 0).toFixed(1), c: +(p.nutriments.carbohydrates_100g || 0).toFixed(1), f: +(p.nutriments.fat_100g || 0).toFixed(1), g: "Open Food Facts" }));
}
var foodRes = [];
function showFoodRes(list, title) {
  foodRes = list;
  const g = +$("meal-g").value || 150;
  $("food-res").innerHTML = list.length ? `<div class="lbl" style="margin:10px 0 4px">${title} · pour ${g} g</div>` + list.map((it, i) => `<button class="fres" data-fi="${i}"><span><b>${esc(it.n)}</b><small>${esc(it.g)} · ${it.k} kcal/100 g</small></span><em>${Math.round(it.k * g / 100)} kcal<br><small>P ${Math.round(it.p * g / 100)} · G ${Math.round(it.c * g / 100)} · L ${Math.round(it.f * g / 100)}</small></em></button>`).join("")
    + `<div class="row" style="margin-top:8px"><button class="btn sec" id="food-off" type="button">🌐 Chercher un produit de marque</button><button class="btn sec" id="food-free" type="button">Ajouter sans macros</button></div>`
    : `<div class="empty">Aucun aliment trouvé. Essaie un mot plus simple (ex. « riz », « poulet »).</div><div class="row"><button class="btn sec" id="food-off" type="button">🌐 Chercher un produit de marque</button><button class="btn sec" id="food-free" type="button">Ajouter sans macros</button></div>`;
}
$("meal-form").onsubmit = async e => {
  e.preventDefault();
  const raw = $("meal-d").value.trim(); if (!raw) return;
  const q = parseQty(raw); if (q) $("meal-g").value = q.g;
  $("food-res").innerHTML = `<div class="empty">Recherche…</div>`;
  try { await loadFood(); showFoodRes(searchFood(q ? q.rest : raw), "Table Ciqual (ANSES)"); }
  catch (err) { $("food-res").innerHTML = `<div class="empty">Base d'aliments indisponible hors-ligne.</div>`; }
};
$("food-res").addEventListener("click", async e => {
  const b = e.target.closest("[data-fi]");
  if (b) {
    const it = foodRes[+b.dataset.fi]; const g = +$("meal-g").value || 150; const r = x => Math.round(x * g / 10) / 10;
    day(hDate()).meals.push({ k: $("meal-k").value, d: it.n, g, kcal: Math.round(it.k * g / 100), p: r(it.p), c: r(it.c), f: r(it.f) });
    $("meal-d").value = ""; $("food-res").innerHTML = ""; save(); renderSante(); toast("Repas ajouté ✓"); return;
  }
  if (e.target.id === "food-off") {
    $("food-res").innerHTML = `<div class="empty">Recherche sur Open Food Facts…</div>`;
    try { showFoodRes(await searchOFF(parseQty($("meal-d").value)?.rest || $("meal-d").value), "Open Food Facts"); } catch (err) { $("food-res").innerHTML = `<div class="empty">Pas de connexion à Open Food Facts.</div>`; }
  }
  if (e.target.id === "food-free") { day(hDate()).meals.push({ k: $("meal-k").value, d: $("meal-d").value.trim() }); $("meal-d").value = ""; $("food-res").innerHTML = ""; save(); renderSante(); }
});
$("meal-g").addEventListener("input", () => { if (foodRes.length) showFoodRes(foodRes, $("food-res").querySelector(".lbl")?.textContent.split(" · ")[0] || "Résultats"); });
function dayMacros(d) { const t = { kcal: 0, p: 0, c: 0, f: 0, n: 0 }; (d.meals || []).forEach(m => { if (m.kcal != null) { t.kcal += m.kcal; t.p += m.p || 0; t.c += m.c || 0; t.f += m.f || 0; t.n++; } }); return t; }
function renderMeals() {
  const d = day(hDate()); const t = dayMacros(d); const G = goals();
  $("meals").innerHTML = d.meals.length ? d.meals.map((m, i) => `<div class="meal"><span class="k">${esc(m.k)}</span><span style="flex:1">${esc(m.d)}${m.kcal != null ? `<br><small class="muted">${m.g} g · ${m.kcal} kcal · P ${m.p} · G ${m.c} · L ${m.f}</small>` : ""}</span><button class="x" data-delmeal="${i}">×</button></div>`).join("") : `<div class="empty">Aucun repas noté pour ce jour.</div>`;
  $("macro-tot").innerHTML = macroPanel(t, G, hDate() === TODAY());
}

/* Statistiques */
var statN = 7;
const lastDays = n => Array.from({ length: n }, (_, i) => { const x = new Date(); x.setDate(x.getDate() - (n - 1 - i)); return iso(x); });
function ringSvg(pct, col, size = 92, sw = 10) { const r = (size - sw) / 2, c = 2 * Math.PI * r; return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="track" stroke-width="${sw}" fill="none"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${col}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(1, pct / 100))}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" class="rtxt" font-size="${size / 4.2}">${Math.round(pct)}%</text></svg>`; }
function barSvg(vals, labels, goal, col, fmt) {
  const W = 320, H = 150, pb = 22, pt = 14, max = Math.max(goal || 0, ...vals, 0.0001) * 1.12, n = vals.length, bw = W / n;
  const y = v => pt + (H - pb - pt) * (1 - v / max);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="none">`;
  vals.forEach((v, i) => { const x = i * bw + bw * 0.18, w = bw * 0.64, ok = goal && v >= goal; s += `<rect x="${x}" y="${y(v)}" width="${w}" height="${Math.max(0, H - pb - y(v))}" rx="${Math.min(6, w / 3)}" fill="${ok ? col : col}" opacity="${v ? (ok ? 1 : .55) : .15}"/>`; if (n <= 10 && v) s += `<text x="${x + w / 2}" y="${y(v) - 4}" text-anchor="middle" class="ctxt">${fmt(v)}</text>`; if (n <= 10 || i % Math.ceil(n / 8) === 0) s += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" class="ctxt">${labels[i]}</text>`; });
  if (goal) s += `<line x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" class="gline"/><text x="2" y="${Math.max(10, y(goal) - 3)}" text-anchor="start" class="ctxt gtxt">🎯 ${fmt(goal)}</text>`;
  return s + `</svg>`;
}
function computeStats(n) {
  const G = goals(), ds = lastDays(n), dd = ds.map(s => S.days[s] || {});
  const water = dd.map(d => (d.water || 0) / 1000);
  const sleep = dd.map(d => +d.sleep || 0);
  const gymDays = dd.map(d => d.gym && d.gym !== "repos" ? 1 : 0);
  const mac = dd.map(dayMacros);
  const pW = water.reduce((a, v) => a + Math.min(1, v / G.water), 0) / n * 100;
  const sl = sleep.filter(v => v > 0); const pS = sl.length ? sl.reduce((a, v) => a + Math.min(1, v / G.sleep), 0) / sl.length * 100 : null;
  const sessions = gymDays.reduce((a, v) => a + v, 0); const pSp = Math.min(100, sessions / (G.sport * n / 7) * 100);
  const md = mac.filter(m => m.n); const pN = md.length ? md.reduce((a, m) => a + 0.5 * Math.min(1, m.p / G.prot) + 0.5 * Math.max(0, 1 - Math.abs(m.kcal - G.kcal) / G.kcal), 0) / md.length * 100 : null;
  const up = upcomingCC().filter(c => diffDays(c.date) <= 21);
  const study = dd.map(d => +d.study || 0), studyTot = study.reduce((a, v) => a + v, 0);
  const pRev = Math.min(100, studyTot / (G.study * n) * 100);
  const prep = up.map(c => { const e = Math.max(10, Math.min(100, (21 - diffDays(c.date)) / 21 * 100)); return Math.min(1, (S.rev[c.id] || 0) / e); });
  const pPrep = prep.length ? prep.reduce((a, v) => a + v, 0) / prep.length * 100 : null;
  const tk = S.tasks.filter(t => t.d && t.d >= ds[0] && t.d <= TODAY()); const pT = tk.length ? tk.filter(t => t.done).length / tk.length * 100 : null;
  const sc = [[pRev, .5], [pPrep, .3], [pT, .2]].filter(x => x[0] != null); const pE = sc.reduce((a, x) => a + x[0] * x[1], 0) / sc.reduce((a, x) => a + x[1], 0);
  const parts = [pW, pS, pSp, pN, pE].filter(v => v != null);
  return { G, ds, water, sleep, gymDays, mac, pW, pS, pSp, pN, pE, sessions, sl, md, up, study, studyTot, pRev, pPrep, pT, tk, global: parts.reduce((a, v) => a + v, 0) / parts.length };
}
function renderStats() {
  if (!window.__v9 || !$("v-stats")) return;
  const st = computeStats(statN), G = st.G;
  document.querySelectorAll("#stat-period button").forEach(b => b.classList.toggle("on", +b.dataset.n === statN));
  const lab = st.ds.map(s => statN <= 7 ? JOURS[parse(s).getDay()].slice(0, 2) : parse(s).getDate() + "");
  const comp = [["💧 Eau", st.pW, "#2563EB"], ["😴 Sommeil", st.pS, "#7C3AED"], ["🏋️ Sport", st.pSp, "#E4572E"], ["🍽️ Nutrition", st.pN, "#0F766E"], ["📚 Révisions", st.pE, "#C98B12"]];
  const verdict = st.global >= 85 ? "Excellent, continue comme ça 🔥" : st.global >= 65 ? "Bonne période, encore un petit effort 💪" : st.global >= 40 ? "Correct, vise un domaine à la fois 🎯" : "On relance la machine : commence par l'eau et le sommeil 🌱";
  $("stat-global").innerHTML = `<div class="sg">${ringSvg(st.global || 0, "var(--teal)", 132, 14)}<div><div class="lbl">Score global · ${statN} derniers jours</div><div style="font-family:Fraunces,serif;font-size:20px;margin-top:4px">${verdict}</div><div class="small muted" style="margin-top:4px">Moyenne de tes objectifs atteints</div></div></div>
    <div class="minirings">${comp.map(([l, v, c]) => `<div>${v == null ? `<div class="na">—</div>` : ringSvg(v, c, 52, 6)}<span>${l}</span></div>`).join("")}</div>`;
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  $("stat-water").innerHTML = `<h3>💧 Eau</h3><div class="kpi"><div><span class="lbl">Moyenne</span><b>${fmtL(avg(st.water) * 1000)}</b></div><div><span class="lbl">Objectif atteint</span><b>${st.water.filter(v => v >= G.water).length}/${statN} j</b></div></div>${barSvg(st.water, lab, G.water, "#2563EB", v => v.toFixed(1))}`;
  $("stat-sleep").innerHTML = `<h3>😴 Sommeil</h3><div class="kpi"><div><span class="lbl">Moyenne</span><b>${st.sl.length ? avg(st.sl).toFixed(1) + " h" : "—"}</b></div><div><span class="lbl">Nuits ≥ ${G.sleep} h</span><b>${st.sl.filter(v => v >= G.sleep).length}/${st.sl.length || 0}</b></div></div>${barSvg(st.sleep, lab, G.sleep, "#7C3AED", v => v.toFixed(1))}${st.sl.length ? "" : `<p class="small muted">Note ton sommeil chaque matin dans l'onglet Santé.</p>`}`;
  const weeks = Array.from({ length: 8 }, (_, i) => { const m = parse(monday(TODAY())); m.setDate(m.getDate() - 7 * (7 - i)); const s = iso(m); let c = 0, min = 0; for (let k = 0; k < 7; k++) { const d = S.days[addD(s, k)]; if (d && d.gym && d.gym !== "repos") { c++; min += +d.dur || 0; } } return { s, c, min }; });
  const types = {}; Object.values(S.days).forEach(d => { if (d.gym && d.gym !== "repos") types[d.gym] = (types[d.gym] || 0) + 1; });
  $("stat-sport").innerHTML = `<h3>🏋️ Sport</h3><div class="kpi"><div><span class="lbl">Séances (${statN} j)</span><b>${st.sessions}</b></div><div><span class="lbl">Objectif</span><b>${G.sport}/sem.</b></div><div><span class="lbl">Cette semaine</span><b>${weeks[7].c}/${G.sport}</b></div></div>${barSvg(weeks.map(w => w.c), weeks.map(w => parse(w.s).getDate() + "/" + (parse(w.s).getMonth() + 1)), G.sport, "#E4572E", v => v)}
    <div class="small muted">Séances par semaine (8 dernières).${Object.keys(types).length ? " Répartition : " + Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ") : ""}</div>`;
  const kc = st.mac.map(m => m.kcal), pr = st.mac.map(m => Math.round(m.p));
  $("stat-food").innerHTML = `<h3>🍽️ Nutrition</h3><div class="kpi"><div><span class="lbl">Calories moy.</span><b>${st.md.length ? Math.round(avg(st.md.map(m => m.kcal))) : "—"}</b></div><div><span class="lbl">Protéines moy.</span><b>${st.md.length ? Math.round(avg(st.md.map(m => m.p))) + " g" : "—"}</b></div></div>
    <div class="lbl" style="margin-top:10px">Calories / jour</div>${barSvg(kc, lab, G.kcal, "#E4572E", v => Math.round(v))}<div class="lbl">Protéines / jour (g)</div>${barSvg(pr, lab, G.prot, "#0F766E", v => Math.round(v))}${st.md.length ? "" : `<p class="small muted">Ajoute tes repas avec la recherche d'aliments (onglet Santé) pour voir tes macros.</p>`}`;
  const wk = monday(TODAY()); let hrs = 0; EDT.filter(r => r[0] >= wk && r[0] <= addD(wk, 6)).forEach(r => { const [a, b] = [r[1], r[2]].map(t => +t.slice(0, 2) + t.slice(3) / 60); hrs += b - a; });
  const done7 = S.tasks.filter(t => t.done).length, todo = S.tasks.filter(t => !t.done).length;
  const sAvg = st.studyTot / statN;
  $("stat-study").innerHTML = `<h3>📚 Études <small class="muted" style="font-weight:600">${Math.round(st.pE)}%</small></h3><div class="kpi"><div><span class="lbl">Révisé (${statN} j)</span><b>${fmtMin(st.studyTot)}</b></div><div><span class="lbl">Moyenne / jour</span><b>${fmtMin(sAvg)}</b></div><div><span class="lbl">Cours cette semaine</span><b>${Math.round(hrs)} h</b></div></div>
    ${barSvg(st.study.map(v => v / 60), lab, G.study / 60, "#C98B12", v => (Math.round(v * 10) / 10) + "h")}
    <div class="srow2"><span>⏱️ Temps de révision <small class="muted">50 %</small></span><div class="bar"><i style="width:${st.pRev}%;background:#C98B12"></i></div><b>${Math.round(st.pRev)}%</b></div>
    <div class="srow2"><span>🎯 Préparation des évals <small class="muted">30 %</small></span><div class="bar"><i style="width:${st.pPrep ?? 0}%;background:var(--teal)"></i></div><b>${st.pPrep == null ? "—" : Math.round(st.pPrep) + "%"}</b></div>
    <div class="srow2"><span>✅ Tâches à l'heure <small class="muted">20 %</small></span><div class="bar"><i style="width:${st.pT ?? 0}%;background:#7C3AED"></i></div><b>${st.pT == null ? "—" : Math.round(st.pT) + "%"}</b></div>
    <p class="small muted" style="margin-top:8px">Ta note Études = surtout ton temps de révision (note-le dans l'onglet Évals), puis ton avance sur les évals : une éval dans 3 semaines n'attend que 10 % de révision, une éval dans 1 semaine en attend ~70 %. Pas de pénalité pour une éval lointaine.</p>
    ${st.up.length ? st.up.map(c => `<div class="srow"><span><b>${c.ue}</b> ${esc(c.name)} <small class="muted">${jx(diffDays(c.date))}</small></span><div class="bar"><i style="width:${S.rev[c.id] || 0}%;background:${diffDays(c.date) <= 7 ? "#DC2626" : "var(--teal)"}"></i></div><b>${S.rev[c.id] || 0}%</b></div>`).join("") : ""}`;
  const gi = (k, label, unit, step) => `<label class="goal"><span>${label}</span><input type="number" inputmode="decimal" step="${step}" min="0" data-goal="${k}" value="${G[k]}"><em>${unit}</em></label>`;
  $("stat-goals").innerHTML = `<h3>🎯 Mes objectifs</h3><p class="small muted" style="margin-bottom:8px">Ce sont les cibles qui servent à calculer tes pourcentages. Modifie-les quand tu veux.</p>
    ${gi("study", "📚 Révision par jour", "min", "15")}${gi("water", "💧 Eau par jour", "L", "0.1")}${gi("sleep", "😴 Sommeil par nuit", "h", "0.5")}${gi("sport", "🏋️ Séances de sport", "/ semaine", "1")}${gi("kcal", "🔥 Calories par jour", "kcal", "50")}${gi("prot", "🥩 Protéines par jour", "g", "5")}${gi("carb", "🍚 Glucides par jour", "g", "10")}${gi("fat", "🧈 Lipides par jour", "g", "5")}${gi("wrate", "⚖️ Prise de poids visée", "kg / sem.", "0.05")}
    <p class="small muted" style="margin-top:8px">Prise de masse propre (≈70 kg) : protéines ~2 g/kg, lipides ~1 g/kg, glucides = le reste, léger surplus de calories pour prendre ~0,25 kg par semaine. Si ton poids ne bouge pas en 2 semaines : +150 kcal ; s'il monte plus vite que 0,4 kg/sem : −150 kcal. Révision ~1 h/jour, eau ~35 ml/kg, sommeil 7–9 h.</p>`;
}
$("stat-goals").addEventListener("change", e => { const i = e.target.closest("[data-goal]"); if (!i) return; const v = parseFloat(String(i.value).replace(",", ".")); if (!(v > 0)) return; S.goals = Object.assign({}, S.goals || {}, { [i.dataset.goal]: v }); save(); syncGoal(); renderAll(); toast("Objectif mis à jour 🎯"); });
$("stat-period").onclick = e => { const b = e.target.closest("[data-n]"); if (!b) return; statN = +b.dataset.n; renderStats(); };
window.__v9 = true; syncGoal(); renderAll();

/* ===== v10 : révisions, diagramme d'équilibre ===== */
function fmtMin(m) { m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + " h" + (m % 60 ? String(m % 60).padStart(2, "0") : "") : m + " min"; }
function renderStudy() {
  if (!$("study-card")) return;
  const d = day(TODAY()), G = goals(), m = +d.study || 0;
  $("study-today").textContent = fmtMin(m) + " / " + fmtMin(G.study);
  $("study-bar").style.width = Math.min(100, m / G.study * 100) + "%";
  const sel = $("study-ue"), cur = sel.value;
  const ues = []; upcomingCC().forEach(c => { if (!ues.find(u => u[0] === c.ue)) ues.push([c.ue, c.name]); });
  sel.innerHTML = `<option value="">Révision générale</option>` + ues.map(([u, n]) => `<option value="${esc(u)}">UE ${esc(u)} · ${esc(n)}</option>`).join("");
  if (cur) sel.value = cur;
  let wk = 0; for (let k = 0; k < 7; k++) { const x = S.days[addD(monday(TODAY()), k)]; wk += x ? +x.study || 0 : 0; }
  const per = d.sl ? Object.entries(d.sl).filter(([, v]) => v > 0).map(([u, v]) => (u ? "UE " + u : "Général") + " " + fmtMin(v)).join(" · ") : "";
  $("study-week").textContent = `Cette semaine : ${fmtMin(wk)} / ${fmtMin(G.study * 7)}` + (per ? ` — Aujourd'hui : ${per}` : "");
}
$("study-card") && $("study-card").addEventListener("click", e => {
  const b = e.target.closest("[data-sm]"); if (!b) return;
  const d = day(TODAY()), v = +b.dataset.sm, u = $("study-ue").value;
  d.study = Math.max(0, (+d.study || 0) + v); d.sl = d.sl || {}; d.sl[u] = Math.max(0, (d.sl[u] || 0) + v);
  save(); renderAll(); toast(v > 0 ? `+${v} min de révision 📚` : "Retiré");
});

/* Diagramme d'équilibre (radar) */
function radarSvg(vals) {
  const N = vals.length, cx = 160, cy = 150, R = 100, pt = (i, f) => { const a = -Math.PI / 2 + i * 2 * Math.PI / N; return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f]; };
  let s = `<svg viewBox="0 0 320 300" class="radar">`;
  [.25, .5, .75, 1].forEach(f => s += `<polygon points="${vals.map((_, i) => pt(i, f).join(",")).join(" ")}" class="rgrid"/>`);
  vals.forEach((_, i) => { const [x, y] = pt(i, 1); s += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="rgrid"/>`; });
  s += `<polygon points="${vals.map((v, i) => pt(i, Math.max(.03, (v.v || 0) / 100)).join(",")).join(" ")}" fill="var(--teal)" fill-opacity=".28" stroke="var(--teal)" stroke-width="2.5" stroke-linejoin="round"/>`;
  vals.forEach((v, i) => {
    const [x, y] = pt(i, Math.max(.03, (v.v || 0) / 100)); s += `<circle cx="${x}" cy="${y}" r="4.5" fill="${v.c}"/>`;
    const [lx, ly] = pt(i, 1.24); s += `<text x="${lx}" y="${ly - 7}" text-anchor="middle" class="rl">${v.k}</text><text x="${lx}" y="${ly + 10}" text-anchor="middle" class="rv" fill="${v.c}">${v.v == null ? "—" : Math.round(v.v) + "%"}</text>`;
  });
  return s + `</svg>`;
}
function renderRadar() {
  if (!$("stat-sys")) return;
  const st = computeStats(statN);
  $("stat-sys").innerHTML = `<h3>🕸️ Mon équilibre <small class="muted" style="font-weight:600">${statN} derniers jours</small></h3>` + radarSvg([
    { k: "💧 Eau", v: st.pW, c: "#2563EB" }, { k: "😴 Sommeil", v: st.pS, c: "#7C3AED" }, { k: "🏋️ Sport", v: st.pSp, c: "#E4572E" },
    { k: "🍽️ Nutrition", v: st.pN, c: "#0F766E" }, { k: "📚 Études", v: st.pE, c: "#C98B12" }]) +
    `<p class="small muted" style="text-align:center">Plus la forme est grande et régulière, plus tu es équilibré. Chaque pointe = % de ton objectif atteint.</p>`;
}

/* Couleurs du calendrier adaptées au mode sombre (mêmes teintes, plus lumineuses) */
const KLIGHT = Object.assign({}, KCOL);
const KDARK = { pao: "#F472D0", cm: "#6366F1", td: "#38BDF8", clin: "#14B8A6", eval: "#F04444", perso: "#A78BFA", sante: "#2DB3A3", autre: "#8A948F", cours: "#38BDF8", off: "#9CA3AF" };
function themeColors() {
  Object.assign(KCOL, document.documentElement.dataset.theme === "dark" ? KDARK : KLIGHT);
  document.querySelectorAll(".legend [data-k]").forEach(s => s.style.setProperty("--c", KCOL[s.dataset.k]));
}
new MutationObserver(() => { themeColors(); renderAll(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
themeColors();
{ const _ra = renderAll; renderAll = function () { _ra(); renderStudy(); renderRadar(); }; }
$("stat-period") && $("stat-period").addEventListener("click", () => setTimeout(renderRadar));
renderAll();

/* ===== v13 : IA (Mistral via Supabase) ===== */
async function callAI(body) {
  if (!sb || !user) throw new Error("login");
  const { data, error } = await sb.functions.invoke("ai", { body });
  if (error) { let m = String(error.message || error); try { const t = await error.context.json(); m = t.error || m; } catch (e) {} throw new Error(m); }
  if (data && data.error) throw new Error(data.error);
  return data;
}
function aiErr(e) {
  const m = String(e.message || e);
  if (m === "login") return "Connecte-toi dans Réglages pour utiliser l'IA.";
  if (/429|rate/i.test(m)) return "L'IA est un peu surchargée, réessaie dans quelques secondes.";
  return "L'IA n'a pas répondu (" + m.slice(0, 80) + ").";
}

/* Décomposition d'un plat */
var dishList = null;
/* L'IA renvoie plusieurs éléments (ex. bò bún ×2 + nems ×5), chacun pour 1 portion + un nombre */
async function analyseDish(text) {
  const r = await callAI({ mode: "dish", text });
  const els = Array.isArray(r.elements) ? r.elements : (r.ingredients ? [{ plat: r.plat, portion: r.portion, nb: r.nb, ingredients: r.ingredients }] : []);
  return els.map(el => {
    let ing = (el.ingredients || []).filter(x => x && x.nom && +x.g > 0).map(x => ({ nom: x.nom, g: Math.round(+x.g), k: +x.kcal || 0, p: +x.p || 0, c: +x.c || 0, f: +x.f || 0 }));
    const sum = ing.reduce((a, i) => a + i.k, 0), ku = +el.kcal_unite || 0;
    if (ku > 0 && sum > 0 && Math.abs(sum - ku) / ku > 0.12) { const fct = ku / sum; ing = ing.map(i => ({ ...i, k: i.k * fct, p: i.p * fct, c: i.c * fct, f: i.f * fct })); }
    return { plat: el.plat || text, portion: el.portion || "", n: Math.max(0.5, Math.round((+el.nb || 1) * 2) / 2), ing };
  }).filter(D => D.ing.length);
}
function dishTot(D) { const t = { kcal: 0, p: 0, c: 0, f: 0, g: 0 }; D.ing.forEach(i => { t.kcal += i.k * D.n; t.p += i.p * D.n; t.c += i.c * D.n; t.f += i.f * D.n; t.g += i.g * D.n; }); return t; }
function listTot() { const t = { kcal: 0, p: 0, c: 0, f: 0 }; (dishList || []).forEach(D => { const x = dishTot(D); t.kcal += x.kcal; t.p += x.p; t.c += x.c; t.f += x.f; }); return t; }
const nFmt = n => (n % 1 ? n.toFixed(1).replace(".", ",") : n);
function totHTML(t) { return `<div><b>${Math.round(t.kcal)}</b><span>kcal</span></div><div><b>${Math.round(t.p)} g</b><span>Protéines</span></div><div><b>${Math.round(t.c)} g</b><span>Glucides</span></div><div><b>${Math.round(t.f)} g</b><span>Lipides</span></div>`; }
function renderDish() {
  if (!dishList || !dishList.length) { $("food-res").innerHTML = ""; return; }
  $("food-res").innerHTML = `<div class="aibox">${dishList.map((D, d) => { const t = dishTot(D); return `<div class="delt">
      <div class="dhead"><div><b>${esc(D.plat)}</b><small>${esc(D.portion || "portion standard")} · ${Math.round(t.kcal / D.n)} kcal l'unité</small></div><button class="x" data-drm="${d}" type="button" aria-label="Retirer">×</button></div>
      <div class="pstep"><span class="small muted">Quantité mangée</span><div><button type="button" data-pn="${d}|-0.5">−</button><b>${nFmt(D.n)}</b><button type="button" data-pn="${d}|0.5">+</button></div><em class="dk">${Math.round(t.kcal)} kcal · ${Math.round(t.p)} g prot</em></div>
      <details><summary>Ingrédients pour 1 unité</summary>${D.ing.map((i, n) => `<div class="aing"><span><b>${esc(i.nom)}</b></span><label><input type="number" inputmode="numeric" min="0" value="${i.g}" data-ig="${d}|${n}"> g</label><em>${Math.round(i.k)} kcal</em><button class="x" data-irm="${d}|${n}" type="button" aria-label="Retirer">×</button></div>`).join("")}</details>
    </div>`; }).join("")}
    <div class="lbl" style="margin-top:10px">Total</div><div class="atot">${totHTML(listTot())}</div>
    <div class="row" style="margin-top:10px"><button class="btn teal" id="dish-add" type="button" style="flex:1">✓ Ajouter</button><button class="btn sec" id="dish-cancel" type="button">Annuler</button></div>
    <p class="small muted" style="margin-top:6px">Ajuste la quantité avec − / +, ou ouvre « Ingrédients » pour corriger les grammes.</p></div>`;
}
function addDish(D, k) {
  const t = dishTot(D), r = v => Math.round(v * 10) / 10;
  day(hDate()).meals.push({ k, d: (D.n !== 1 ? nFmt(D.n) + " × " : "") + D.plat, g: Math.round(t.g), kcal: Math.round(t.kcal), p: r(t.p), c: r(t.c), f: r(t.f), ing: D.ing.map(i => i.nom + " " + i.g + " g").join(", ") });
}
const ciqualSearch = $("meal-form").onsubmit;
$("meal-form").onsubmit = async e => {
  e.preventDefault();
  const raw = $("meal-d").value.trim(); if (!raw) return;
  $("food-res").innerHTML = `<div class="empty">✨ L'IA décortique ton repas…</div>`;
  try { dishList = await analyseDish(raw); if (!dishList.length) throw new Error("vide"); renderDish(); }
  catch (err) { dishList = null; $("food-res").innerHTML = `<div class="empty">${aiErr(err)}</div><div class="row"><button class="btn sec" id="meal-ciq" type="button">🔎 Chercher dans la table Ciqual</button></div>`; }
};
$("meal-search") && ($("meal-search").onclick = () => ciqualSearch({ preventDefault() {} }));
$("food-res").addEventListener("change", e => {
  const i = e.target.closest("[data-ig]"); if (!i || !dishList) return;
  const [d, n] = i.dataset.ig.split("|").map(Number), it = dishList[d].ing[n], g = Math.max(0, Math.round(+i.value || 0));
  if (it.g > 0) { const f = g / it.g; it.k *= f; it.p *= f; it.c *= f; it.f *= f; } it.g = g; renderDish();
});
$("food-res").addEventListener("click", e => {
  const pn = e.target.closest("[data-pn]"); if (pn && dishList) { const [d, v] = pn.dataset.pn.split("|").map(Number); dishList[d].n = Math.max(0.5, dishList[d].n + v); renderDish(); return; }
  const rm = e.target.closest("[data-irm]"); if (rm && dishList) { const [d, n] = rm.dataset.irm.split("|").map(Number); dishList[d].ing.splice(n, 1); if (!dishList[d].ing.length) dishList.splice(d, 1); renderDish(); return; }
  const drm = e.target.closest("[data-drm]"); if (drm && dishList) { dishList.splice(+drm.dataset.drm, 1); renderDish(); return; }
  if (e.target.id === "dish-add" && dishList) { const k = $("meal-k").value; dishList.forEach(D => addDish(D, k)); save(); renderSante(); dishList = null; $("meal-d").value = ""; $("food-res").innerHTML = ""; toast("Repas ajouté ✓"); return; }
  if (e.target.id === "dish-cancel") { dishList = null; $("food-res").innerHTML = ""; return; }
  if (e.target.id === "meal-ciq") ciqualSearch({ preventDefault() {} });
});

/* Chat avec l'assistant */
var aiHist = [];
function aiCtx() {
  const t = TODAY(), end = addD(t, 7), d = S.days[t] || {};
  const st = computeStats(7);
  return {
    cours_7_jours: EDT.filter(r => r[0] >= t && r[0] <= end).map(r => ({ date: r[0], debut: r[1], fin: r[2], type: r[4], ue: r[3], intitule: r[7], salle: r[5], prof: r[8], epreuve: !!r[9] })),
    evals_a_venir: upcomingCC().slice(0, 10).map(c => ({ date: c.date, dans_jours: diffDays(c.date), ue: c.ue, intitule: c.name, cc: c.cc, modalite: c.mod, note: c.note, revise_pct: S.rev[c.id] || 0 })),
    taches_a_faire: S.tasks.filter(x => !x.done).slice(0, 25).map(x => ({ t: x.t, d: x.d, c: x.c })),
    aujourdhui: { eau_ml: d.water || 0, sommeil_h: d.sleep || null, sport: d.gym || null, revision_min: d.study || 0, repas: (d.meals || []).map(m => m.d + (m.kcal != null ? " (" + m.kcal + " kcal, " + m.p + " g prot)" : "")) },
    objectifs: Object.assign({ programme: "prise de masse propre (muscle sans trop de gras) pour un shooting photo en Chine en août 2027 ; sèche légère à partir du 7 juin 2027", poids_moyen_7j: weightAvg(addD(TODAY(), -6), TODAY()) }, goals()),
    stats_7_jours_pct: { eau: Math.round(st.pW), sommeil: st.pS == null ? null : Math.round(st.pS), sport: Math.round(st.pSp), nutrition: st.pN == null ? null : Math.round(st.pN), etudes: Math.round(st.pE), revision_totale_min: st.studyTot },
    infos_ecole: (NEWS || []).slice(0, 6).map(n => n.date + " " + n.title + " : " + (n.body || "").slice(0, 160))
  };
}
function chatAdd(role, html) { const el = document.createElement("div"); el.className = "msg " + role; el.innerHTML = html; $("ai-log").appendChild(el); $("ai-log").scrollTop = 1e9; return el; }
async function runActions(acts) {
  const done = [];
  for (const a of acts || []) {
    try {
      const d = day(TODAY());
      if (a.type === "water" && a.ml > 0) { d.water = (d.water || 0) + Math.round(a.ml); done.push("💧 +" + Math.round(a.ml) + " ml"); }
      else if (a.type === "task" && a.t) { S.tasks.push({ id: uid(), t: String(a.t), d: /^\d{4}-\d\d-\d\d$/.test(a.d || "") ? a.d : "", c: ["etudes", "perso", "sante", "admin"].includes(a.c) ? a.c : "perso", done: false }); done.push("✅ Tâche : " + esc(a.t)); }
      else if (a.type === "sleep" && a.h > 0) { d.sleep = String(a.h); done.push("😴 Sommeil : " + a.h + " h"); }
      else if (a.type === "gym" && a.s) { d.gym = a.s; if (a.dur) d.dur = String(a.dur); done.push("🏋️ Séance : " + esc(a.s)); }
      else if (a.type === "study" && a.min > 0) { d.study = (+d.study || 0) + Math.round(a.min); d.sl = d.sl || {}; const u = (a.ue || "").replace(/^UE\s*/i, ""); const key = u ? "UE " + u : ""; d.sl[key] = (d.sl[key] || 0) + Math.round(a.min); done.push("📚 +" + Math.round(a.min) + " min de révision"); }
      else if (a.type === "meal" && a.text) { const L = await analyseDish(a.text); const k = ["Petit-déj", "Déjeuner", "Collation", "Dîner"].includes(a.k) ? a.k : (new Date().getHours() < 11 ? "Petit-déj" : new Date().getHours() < 15 ? "Déjeuner" : new Date().getHours() < 18 ? "Collation" : "Dîner"); L.forEach(D => { const t = dishTot(D); addDish(D, k); done.push("🍽️ " + (D.n !== 1 ? nFmt(D.n) + " × " : "") + esc(D.plat) + " : " + Math.round(t.kcal) + " kcal · " + Math.round(t.p) + " g prot"); }); }
    } catch (e) {}
  }
  if (done.length) { save(); renderAll(); }
  return done;
}
async function sendChat(text) {
  text = text.trim(); if (!text) return;
  chatAdd("me", esc(text)); $("ai-in").value = "";
  const w = chatAdd("bot", `<span class="dots"><i></i><i></i><i></i></span>`);
  try {
    const vo = voiceOn() && voiceKey() !== "device";
    const r = await callAI({ mode: "chat", text, today: TODAY() + " (" + JOURS[new Date().getDay()] + ") " + new Date().toTimeString().slice(0, 5), ctx: aiCtx(), history: aiHist, tts: vo ? VOICES[voiceKey()][0] : undefined });
    aiHist.push({ role: "user", content: text }, { role: "assistant", content: r.reply || "" }); aiHist = aiHist.slice(-12);
    const show = () => { w.innerHTML = esc(r.reply || "…").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>"); $("ai-log").scrollTop = 1e9; };
    if (!voiceOn()) show();
    // Les actions (ex. analyse d'un repas) tournent en parallèle : Jarvis parle tout de suite
    runActions(r.actions).then(done => { if (done.length) chatAdd("act", done.join("<br>")); }).catch(() => {});
    if (voiceOn()) speak(r.reply || "", st => { if (convo && $("ai-sheet").classList.contains("on")) listen(st); else if (st) { try { st.getTracks().forEach(t => t.stop()); } catch (e) {} } }, { audio0: r.audio0, rest: r.rest, onStart: show });
  } catch (e) { w.innerHTML = aiErr(e); if (voiceOn()) speak(aiErr(e)); convo = false; setMic(""); }
}
(function () {
  const sh = document.createElement("div"); sh.className = "sheet"; sh.id = "ai-sheet";
  sh.innerHTML = `<div class="in aiin"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2 style="font-size:22px">🤖 Jarvis <small class="muted" style="font-size:11px;font-family:inherit">v27</small></h2><button class="btn sec" data-close>Fermer</button></div>
    <div id="ai-log"><div class="msg bot">Bonjour boss. Touchez le micro et parlez-moi : planning, évals, révisions… ou dites-moi ce que vous avez mangé, bu ou révisé, je note tout.</div></div>
    <div class="chips" id="ai-chips">${["Je révise quoi ce soir ?", "J'ai cours où demain ?", "Comment s'est passée ma semaine ?", "Interroge-moi sur mon prochain CC"].map(s => `<button type="button">${s}</button>`).join("")}</div>
    <div class="micwrap"><button type="button" id="ai-mic" aria-label="Parler"><span>🎙️</span></button><div id="ai-mic-lbl" class="small muted">Touche pour parler</div><label class="jv"><input type="checkbox" id="ai-voice"> 🔊 Mode Jarvis (il te répond à voix haute et réécoute)</label><label class="jv"><input type="checkbox" id="ai-barge"> 🗣️ Je peux lui couper la parole en parlant</label><div class="row nowrap vsel"><select id="ai-vsel"></select><button type="button" class="btn sec" id="ai-vtest">▶︎ Écouter</button></div><label class="jv"><input type="checkbox" id="ai-manual"> 🖐️ C'est moi qui touche le micro quand j'ai fini de parler</label></div>
    <form id="ai-form" class="row nowrap"><input id="ai-in" placeholder="Ou écris ta question…" autocomplete="off"><button class="btn teal">➤</button></form></div>`;
  document.body.appendChild(sh);
  sh.onclick = e => { if (e.target === sh || e.target.closest("[data-close]")) { sh.classList.remove("on"); convo = false; stopListen(true); stopSpeaking(); setMic(""); } };
  $("ai-form").onsubmit = e => { e.preventDefault(); sendChat($("ai-in").value); };
  $("ai-chips").onclick = e => { const b = e.target.closest("button"); if (b) sendChat(b.textContent); };
  const btn = document.createElement("button"); btn.className = "iconbtn"; btn.id = "open-ai"; btn.setAttribute("aria-label", "Assistant IA"); btn.textContent = "🤖";
  $("refresh").parentNode.insertBefore(btn, $("refresh"));
  btn.onclick = () => { sh.classList.add("on"); setTimeout(() => $("ai-in").focus(), 250); };
})();

/* ===== v14 : voix (Jarvis) ===== */
var convo = false, rec = null, recStream = null, recCtx = null, recTimer = null, recCancel = false;
function voiceOn() { try { return localStorage.getItem("thy-voice") !== "0"; } catch (e) { return true; } }
function setMic(state, label) {
  const b = $("ai-mic"); if (!b) return;
  b.className = state || "";
  $("ai-mic-lbl").textContent = label || (state === "rec" ? "Je t'écoute… (touche pour arrêter)" : state === "busy" ? "Je réfléchis…" : state === "talk" ? "Je parle… touche pour me couper et parler" : "Touche pour parler");
}
function pickVoice() {
  const v = speechSynthesis.getVoices().filter(x => /^fr/i.test(x.lang));
  return v.find(x => /thomas|daniel|nicolas|henri|paul/i.test(x.name)) || v.find(x => /fr-FR/i.test(x.lang)) || v[0] || null;
}
const VOICES = { auto: ["auto", "Rémy · naturel (recommandé)"], henri: ["az:fr-FR-HenriNeural", "Henri · posé"], lucien: ["az:fr-FR-LucienMultilingualNeural", "Lucien · grave"], pierre: ["ref:pierre", "Pierre · voix de secours"], device: ["", "Voix du téléphone (hors ligne)"] };
function voiceKey() { try { const v = localStorage.getItem("thy-vsel"); return VOICES[v] ? v : "auto"; } catch (e) { return "auto"; } }
function bargeOn() { try { return localStorage.getItem("thy-barge") !== "0"; } catch (e) { return true; } }
var aiAudio = new Audio(), spkTok = 0, bargeStream = null, bargeTimer = null, bargeCtx = null;
aiAudio.setAttribute("playsinline", "");
const SILENT = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";
var sharedCtx = null;
function getCtx() { try { if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)(); if (sharedCtx.state === "suspended") sharedCtx.resume(); } catch (e) {} return sharedCtx; }
function unlockAudio() { getCtx(); try { aiAudio.src = SILENT; aiAudio.play().catch(() => {}); } catch (e) {} try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch (e) {} }
function cleanSpeech(t) { return String(t).replace(/\*\*/g, "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").replace(/\s+/g, " ").trim(); }
function stopSpeaking() { spkTok++; try { aiAudio.pause(); } catch (e) {} try { speechSynthesis.cancel(); } catch (e) {} stopBarge(true); }
function stopBarge(killStream) { clearInterval(bargeTimer); bargeTimer = null; try { bargeCtx && bargeCtx.disconnect(); } catch (e) {} bargeCtx = null; if (killStream && bargeStream) { try { bargeStream.getTracks().forEach(t => t.stop()); } catch (e) {} bargeStream = null; } }
async function startBarge(tok) {
  if (!bargeOn() || !convo || !navigator.mediaDevices) return;
  try { bargeStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); } catch (e) { return; }
  if (tok !== spkTok) { stopBarge(true); return; }
  try {
    const bc = getCtx(); bargeCtx = bc.createMediaStreamSource(bargeStream);
    const an = bc.createAnalyser(); an.fftSize = 2048; bargeCtx.connect(an);
    const buf = new Float32Array(an.fftSize); let floor = 0, n = 0, hot = 0; const t0 = Date.now();
    bargeTimer = setInterval(() => {
      an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; const rms = Math.sqrt(s / buf.length);
      if (Date.now() - t0 < 600) { floor = Math.max(floor, rms); n++; return; }
      if (rms > Math.max(0.03, floor * 2.2)) hot += 100; else hot = Math.max(0, hot - 50);
      if (hot >= 350) { // tu parles par-dessus : il se tait et t'écoute
        const st = bargeStream; bargeStream = null; spkTok++; try { aiAudio.pause(); } catch (e) {} try { speechSynthesis.cancel(); } catch (e) {} stopBarge(false);
        convo = true; listen(st);
      }
    }, 100);
  } catch (e) {}
}
function speakDevice(text, tok) {
  return new Promise(res => {
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = "fr-FR"; u.rate = 1.05; const v = pickVoice(); if (v) u.voice = v;
      u.onend = () => res(); u.onerror = () => res();
      if (tok !== spkTok) return res(); speechSynthesis.speak(u);
    } catch (e) { res(); }
  });
}
function playB64(b64, tok) {
  return new Promise(res => {
    if (tok !== spkTok) return res();
    aiAudio.onended = () => res(); aiAudio.onerror = () => res(); aiAudio.onpause = () => { if (tok !== spkTok) res(); };
    aiAudio.src = "data:audio/mpeg;base64," + b64; aiAudio.play().catch(() => res());
  });
}
function splitSpeech(t) { const p = (t || "").match(/[^.!?…]+[.!?…]*\s*/g) || (t ? [t] : []); return p.length > 1 ? [p[0].trim(), p.slice(1).join("").trim()].filter(Boolean) : p.map(x => x.trim()).filter(Boolean); }
async function speak(text, after, opts) {
  opts = opts || {};
  stopSpeaking(); const tok = ++spkTok;
  const clean = cleanSpeech(text); if (!clean) { opts.onStart && opts.onStart(); after && after(); return; }
  setMic("talk"); startBarge(tok);
  const vk = voiceKey(); let started = false; const go = () => { if (!started) { started = true; opts.onStart && opts.onStart(); } };
  try {
    if (vk === "device") { go(); await speakDevice(clean, tok); }
    else {
      let chunks, reqs;
      if (opts.audio0) { chunks = [null, ...splitSpeech(cleanSpeech(opts.rest || ""))]; reqs = [Promise.resolve({ audio: opts.audio0 })]; }
      else { chunks = splitSpeech(clean); reqs = []; }
      for (let k = reqs.length; k < chunks.length; k++) reqs.push(callAI({ mode: "tts", text: chunks[k], voice: VOICES[vk][0] }).catch(() => null));
      for (let k = 0; k < chunks.length; k++) {
        if (tok !== spkTok) { go(); return; }
        const rr = await reqs[k];
        if (tok !== spkTok) { go(); return; }
        go();
        if (rr && rr.audio) await playB64(rr.audio, tok); else if (chunks[k]) await speakDevice(chunks[k], tok);
      }
    }
  } catch (e) {}
  go();
  if (tok !== spkTok) return; // coupé par l'utilisateur
  const st = bargeStream; bargeStream = null; stopBarge(false);
  setMic("");
  if (after) after(st); else if (st) { try { st.getTracks().forEach(t => t.stop()); } catch (e) {} }
}
function blobToB64(b) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(b); }); }
function stopListen(cancel) {
  recCancel = !!cancel; clearInterval(recTimer);
  try { if (rec && rec.state !== "inactive") rec.stop(); } catch (e) {}
  if (cancel) { try { recStream && recStream.getTracks().forEach(t => t.stop()); } catch (e) {} setMic(""); }
}
function manualMode() { try { return localStorage.getItem("thy-manual") === "1"; } catch (e) { return false; } }
async function listen(existing) {
  if (rec && rec.state === "recording") return;
  if (!navigator.mediaDevices || !window.MediaRecorder) { setMic("", "Micro non disponible ici : utilise la dictée du clavier 🎤"); return; }
  if (existing) recStream = existing;
  else try { recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { setMic("", "Autorise le micro pour me parler (réglages du navigateur)."); convo = false; return; }
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"].find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || "";
  rec = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
  const chunks = []; recCancel = false;
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    clearInterval(recTimer);
    try { recStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { recCtx && recCtx.disconnect(); } catch (e) {}
    $("ai-mic").style.setProperty("--lv", 0);
    if (recCancel || !chunks.length) { setMic(""); return; }
    const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
    if (blob.size < 2500) { setMic(""); convo = false; return; }
    setMic("busy", "Je transcris…");
    try {
      const r = await callAI({ mode: "stt", audio: await blobToB64(blob), mime: blob.type });
      const t = (r.text || "").trim();
      if (!t) { setMic("", "Je n'ai rien entendu, réessaie 🙂"); convo = false; return; }
      if (/^(stop|merci,? c'est tout|c'est bon merci|au revoir)[.!]?$/i.test(t)) { chatAdd("me", esc(t)); convo = false; speak("Avec plaisir, à plus Thyvan !"); return; }
      setMic("busy"); await sendChat(t); if (!voiceOn()) setMic("");
    } catch (e) { setMic("", aiErr(e)); convo = false; }
  };
  rec.start(250);
  const manual = manualMode();
  setMic("rec", manual ? "Je t'écoute… touche le micro quand tu as fini" : "Je t'écoute… prends ton temps (touche pour envoyer)");
  // détection de fin de phrase : on attend un vrai silence (2,3 s) avant d'envoyer
  try {
    const cx = getCtx(); recCtx = cx.createMediaStreamSource(recStream); const an = cx.createAnalyser(); an.fftSize = 2048; recCtx.connect(an);
    const buf = new Float32Array(an.fftSize); let voiced = 0, spoke = false, quiet = 0, maxr = 0; const hist = []; const t0 = Date.now();
    recTimer = setInterval(() => {
      an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; const rms = Math.sqrt(s / buf.length);
      const el = Date.now() - t0;
      hist.push(rms); if (hist.length > 40) hist.shift(); maxr = Math.max(maxr, rms);
      const srt = hist.slice().sort((x, y) => x - y), floor = srt[Math.floor(srt.length * 0.15)] || 0;
      const on = floor * 2 + 0.004, off = floor * 1.4 + 0.003;
      $("ai-mic").style.setProperty("--lv", Math.min(1, rms / (on * 3 + 1e-6)).toFixed(2));
      if (el < 300) return;
      if (rms > on) { voiced += 100; quiet = 0; if (voiced >= 250) spoke = true; }
      else { voiced = 0; if (rms < off || !spoke) quiet += 100; }
      if (manual) { if (el > 120000) stopListen(false); return; }
      // fin de phrase : 2 s de silence après avoir parlé ; sinon on envoie quand même (la transcription tranchera)
      if ((spoke && quiet >= 2000 && el > 1500) || el > 60000) stopListen(false);
      else if (!spoke && el > 9000) { if (maxr < 0.0005) { stopListen(false); } else if (quiet >= 9000) { recCancel = true; stopListen(false); setMic("", "Je n'ai rien entendu 🙂"); convo = false; } }
    }, 100);
  } catch (e) {}
}
(function () {
  const cb = $("ai-voice"); if (cb) { cb.checked = voiceOn(); cb.onchange = () => { try { localStorage.setItem("thy-voice", cb.checked ? "1" : "0"); } catch (e) {} if (!cb.checked) { convo = false; try { speechSynthesis.cancel(); } catch (e) {} } }; }
  const bg = $("ai-barge"); if (bg) { bg.checked = bargeOn(); bg.onchange = () => { try { localStorage.setItem("thy-barge", bg.checked ? "1" : "0"); } catch (e) {} }; }
  const vs = $("ai-vsel"); if (vs) { vs.innerHTML = Object.entries(VOICES).map(([k, v]) => `<option value="${k}">🎧 ${v[1]}</option>`).join(""); vs.value = voiceKey(); vs.onchange = () => { try { localStorage.setItem("thy-vsel", vs.value); } catch (e) {} }; }
  const vt = $("ai-vtest"); if (vt) vt.onclick = () => { unlockAudio(); convo = false; speak("Bonjour boss. Jarvis, à votre service. Vous avez plusieurs évaluations cette semaine : souhaitez-vous que je vous prépare un planning de révision ?"); };
  const mc = $("ai-manual"); if (mc) { mc.checked = manualMode(); mc.onchange = () => { try { localStorage.setItem("thy-manual", mc.checked ? "1" : "0"); } catch (e) {} }; }
  const b = $("ai-mic"); if (!b) return;
  b.onclick = () => {
    unlockAudio();
    if (b.classList.contains("talk")) { stopSpeaking(); convo = voiceOn(); listen(); return; }
    if (rec && rec.state === "recording") { stopListen(false); return; }
    if (b.classList.contains("busy")) return;
    convo = voiceOn(); listen();
  };
  try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); } catch (e) {}
})();

/* ===== v21 : prise de masse propre ===== */
function macroPanel(t, G, isToday) {
  const rows = [["🔥", "Calories", t.kcal, G.kcal, "kcal", "#E4572E", 0.93, 1.08], ["🥩", "Protéines", t.p, G.prot, "g", "#0F766E", 0.9, 1.35], ["🍚", "Glucides", t.c, G.carb, "g", "#C98B12", 0.85, 1.2], ["🧈", "Lipides", t.f, G.fat, "g", "#7C3AED", 0.75, 1.3]];
  const st = (v, g, lo, hi) => v < g * lo ? ["lo", "en dessous"] : v > g * hi ? ["hi", "au-dessus"] : ["ok", "objectif ✓"];
  let html = rows.map(([ic, nm, v, g, u, col, lo, hi]) => { const [c, l] = st(v, g, lo, hi); const mx = Math.max(g * 1.35, v);
    return `<div class="mstat"><span>${ic} ${nm}</span><span><b>${Math.round(v)}</b> / ${g} ${u} ${t.n ? `<em class="${c}">${l}</em>` : ""}</span></div><div class="mbar"><i style="width:${Math.min(100, v / mx * 100)}%;background:${col}"></i><s style="left:${g / mx * 100}%"></s></div>`; }).join("");
  if (!t.n) return html + `<div class="mtips">Ajoute tes repas avec ✨ pour voir si tu atteins tes objectifs de prise de masse.</div>`;
  const tips = [], dk = G.kcal - t.kcal, dp = G.prot - t.p, dc = G.carb - t.c, df = G.fat - t.f;
  if (dp > 15) tips.push(`🥩 Il te manque <b>${Math.round(dp)} g de protéines</b> : par ex. ${dp > 45 ? "200 g de poulet ou de bœuf" : dp > 25 ? "un skyr + 2 œufs, ou 120 g de poulet" : "un skyr ou un verre de lait"}.`);
  else if (t.p >= G.prot * 0.9) tips.push(`🥩 Protéines OK, c'est le plus important pour le muscle.`);
  if (dc > 60) tips.push(`🍚 Encore <b>${Math.round(dc)} g de glucides</b> : riz, pâtes, pain, flocons d'avoine, banane… c'est ton carburant pour la salle.`);
  if (t.f > G.fat * 1.3) tips.push(`🧈 Beaucoup de lipides (${Math.round(t.f)} g) : souvent les sauces, la friture et les viennoiseries. C'est ce qui fait prendre du gras.`);
  else if (df > 25 && dk > 300) tips.push(`🧈 Il reste de la place pour ${Math.round(df)} g de bons lipides : huile d'olive, avocat, noix, œufs.`);
  if (t.kcal > G.kcal * 1.12) tips.push(`🔥 <b>${Math.round(-dk)} kcal au-dessus</b> de l'objectif : un excès ponctuel n'est pas grave, mais si ça se répète, tu prendras surtout du gras.`);
  else if (dk > 250) tips.push(isToday ? `🔥 Il te reste <b>~${Math.round(dk)} kcal</b> à manger aujourd'hui.` : `🔥 Ce jour-là, il manquait ~${Math.round(dk)} kcal : en prise de masse, manger trop peu = pas de muscle en plus.`);
  else tips.push(`🔥 Calories dans la cible, parfait pour une prise de masse propre.`);
  return html + `<div class="mtips">${tips.map(x => `<div>${x}</div>`).join("")}</div>`;
}
function weightAvg(from, to) { let s = 0, n = 0; for (let x = from; x <= to; x = addD(x, 1)) { const w = S.days[x] && +S.days[x].weight; if (w) { s += w; n++; } } return n ? s / n : null; }
function bulkPanel() {
  const G = goals(), t = TODAY(), shoot = "2027-08-01", cutStart = "2027-06-07";
  const a1 = weightAvg(addD(t, -6), t), a0 = weightAvg(addD(t, -13), addD(t, -7));
  const rate = a1 != null && a0 != null ? a1 - a0 : null;
  const phase = t < cutStart ? "bulk" : t < shoot ? "cut" : "done";
  let adv = "Pèse-toi le matin à jeun (3 à 7 fois par semaine) : je compare la moyenne de chaque semaine pour ajuster tes calories.";
  if (rate != null) {
    if (phase === "bulk") adv = rate < 0.1 ? `Ton poids stagne (${rate >= 0 ? "+" : ""}${rate.toFixed(2).replace(".", ",")} kg/sem) : ajoute <b>~150 kcal par jour</b> (un bol de riz ou une banane + des flocons d'avoine).` : rate > 0.45 ? `Tu prends vite (+${rate.toFixed(2).replace(".", ",")} kg/sem) : retire <b>~150 kcal par jour</b> pour limiter le gras.` : `+${rate.toFixed(2).replace(".", ",")} kg/sem : rythme parfait pour une prise de masse propre 👌`;
    else adv = `${rate.toFixed(2).replace(".", ",")} kg/sem : en sèche, vise environ −0,4 à −0,6 kg par semaine.`;
  }
  const weeks = Math.max(0, Math.round((parse(shoot) - parse(t)) / 864e5 / 7));
  return `<div class="bulk"><h4>📸 Objectif shooting en Chine (août 2027) · ${weeks} semaines</h4>
    <div class="bphase"><div class="${phase === "bulk" ? "on" : ""}"><b>1. Prise de masse</b>jusqu'au 6 juin · +${String(G.wrate).replace(".", ",")} kg/sem</div><div class="${phase === "cut" ? "on" : ""}"><b>2. Sèche légère</b>7 juin → fin juillet, pour être sec</div></div>
    <div class="small">${a1 != null ? `Poids moyen cette semaine : <b>${a1.toFixed(1).replace(".", ",")} kg</b>. ` : ""}${adv}</div></div>`;
}

/* ===== v22 : série, courbe 30 jours, bilan du jour (repris du projet Lock In) ===== */
// Une journée est « réussie » quand au moins 3 habitudes sur 5 sont tenues (60 %).
const HABITS = [
  ["💧", "Eau", (d, G) => (d.water || 0) / 1000 >= G.water],
  ["😴", "Sommeil", (d, G) => +d.sleep > 0 && +d.sleep >= G.sleep - 0.5],
  ["🏋️", "Sport noté", d => !!d.gym],
  ["🥩", "Protéines", (d, G) => dayMacros(d).p >= G.prot * 0.9],
  ["📚", "Révision", (d, G) => (+d.study || 0) >= G.study]
];
function habitScore(s) { const d = S.days[s] || {}, G = goals(); const ok = HABITS.map(h => h[2](d, G)); return { ok, n: ok.filter(Boolean).length, pct: ok.filter(Boolean).length / HABITS.length * 100 }; }
const dayWon = s => habitScore(s).pct >= 60;
function streakNow() {
  let x = TODAY(), n = 0;
  if (!dayWon(x)) x = addD(x, -1); // la journée en cours ne casse pas la série
  while (n < 400 && dayWon(x)) { n++; x = addD(x, -1); }
  return n;
}
function bestStreak(days) { let best = 0, cur = 0; for (let i = days - 1; i >= 0; i--) { if (dayWon(addD(TODAY(), -i))) { cur++; best = Math.max(best, cur); } else cur = 0; } return best; }
function lineSvg(vals, labels) {
  const W = 320, H = 150, pb = 22, pt = 14, n = vals.length, x = i => 8 + i * (W - 16) / Math.max(1, n - 1), y = v => pt + (H - pb - pt) * (1 - v / 100);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="none">`;
  s += `<line x1="0" x2="${W}" y1="${y(60)}" y2="${y(60)}" class="gline"/><text x="2" y="${y(60) - 3}" class="ctxt gtxt">🎯 60 %</text>`;
  s += `<polyline points="${vals.map((v, i) => x(i) + "," + y(v)).join(" ")}" fill="none" stroke="var(--teal)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  vals.forEach((v, i) => { s += `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${v >= 60 ? "var(--teal)" : "var(--coral)"}"/>`; if (i % 5 === 4 || i === n - 1) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ctxt">${labels[i]}</text>`; });
  return s + `</svg>`;
}
function bilanText() {
  const t = TODAY(), d = S.days[t] || {}, G = goals(), m = dayMacros(d), x = parse(t), hs = habitScore(t);
  const tk = S.tasks.filter(k => k.d === t), tkDone = tk.filter(k => k.done).length;
  const gym = d.gym ? (GYM.find(g => g[0] === d.gym) || [, d.gym])[1] : "rien noté";
  return [`Bilan du ${JOURS[x.getDay()]} ${x.getDate()} ${MC[x.getMonth()]} — ${hs.n}/5 habitudes, série ${streakNow()} j`,
    `💧 Eau ${fmtL(d.water || 0)} / ${String(G.water).replace(".", ",")} L`,
    `😴 Sommeil ${d.sleep ? d.sleep + " h" : "non noté"}`,
    `🏋️ Sport : ${gym}`,
    `🍽️ ${m.n ? Math.round(m.kcal) + " kcal · " + Math.round(m.p) + " g protéines" : "repas non notés"}`,
    `📚 Révision ${fmtMin(+d.study || 0)} / ${fmtMin(G.study)}`,
    `✅ Tâches du jour ${tk.length ? tkDone + "/" + tk.length : "aucune"}`].join("\n");
}
function renderStreak() {
  const el = $("stat-streak"); if (!el) return;
  const ds = lastDays(30), vals = ds.map(s => habitScore(s).pct), won = ds.filter(dayWon).length;
  const now = streakNow(), best = bestStreak(90), today = habitScore(TODAY());
  el.innerHTML = `<h3>🔥 Ma série</h3><div class="kpi"><div><span class="lbl">Série actuelle</span><b>${now} j</b></div><div><span class="lbl">Record (90 j)</span><b>${best} j</b></div><div><span class="lbl">Jours réussis (30 j)</span><b>${won}/30 · ${Math.round(won / 30 * 100)}%</b></div></div>
    <div class="row small" style="margin:10px 0 2px;gap:6px">${HABITS.map((h, i) => `<span class="pill ${today.ok[i] ? "p-teal" : "p-grey"}">${h[0]} ${h[1]}</span>`).join("")}</div>
    <div class="small muted">Aujourd'hui : ${today.n}/5. Une journée compte dans la série à partir de 3 habitudes sur 5.</div>
    <div class="lbl" style="margin-top:10px">Habitudes tenues · 30 derniers jours</div>${lineSvg(vals, ds.map(s => parse(s).getDate() + ""))}
    <div class="row" style="margin-top:8px"><button class="btn sec" id="bilan-copy" type="button">📋 Copier le bilan du jour</button></div>`;
}
document.body.addEventListener("click", async e => {
  if (!e.target.closest("#bilan-copy")) return;
  const txt = bilanText();
  try { await navigator.clipboard.writeText(txt); toast("Bilan copié 📋"); }
  catch (err) { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("Bilan copié 📋"); } catch (e2) { toast("Copie impossible"); } ta.remove(); }
});
{ const _ra2 = renderAll; renderAll = function () { _ra2(); renderStreak(); }; }
renderStreak();
