// IA de l'assistant (Gemini, Mistral en secours) — clés gardées dans les secrets Supabase
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function mistral(messages: unknown[], json = true) {
  let last = "";
  for (const model of ["mistral-medium-latest", "mistral-large-2512", "mistral-small-2603", "ministral-14b-2512", "ministral-8b-2512", "mistral-small-latest"]) {
    const r = await call(model, messages, json);
    if (r.ok) { const j = await r.json(); return j.choices[0].message.content as string; }
    last = "mistral " + r.status + " " + (await r.text()).slice(0, 200);
    if (r.status === 401) break;
  }
  throw new Error(last);
}
// ---- Gemini (gratuit) ----
// Testé le 25/11/2026 avec la clé gratuite : 3-flash-preview répond en ~1 s ; 3.5-flash / 3.6-flash / flash-latest = quota gratuit épuisé (429) ;
// les flash-lite sont souvent saturés (503). Réflexion "minimal" = quasi pas de réflexion = rapide.
const GEM_FAST = ["gemini-3-flash-preview", "gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-flash-latest"];
const GEM_LITE = GEM_FAST;
const MINIMAL_OK = new Set(["gemini-3-flash-preview", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3.5-flash-lite"]);
const DEAD = new Set<string>(); // modèles introuvables (404) : on ne les retente plus
const COOL: Record<string, number> = {}; // quota épuisé (429) : on saute le modèle 10 min
let LAST_OK = ""; // dernier modèle qui a répondu : essayé en premier
async function gemini(messages: any[], json = true, extraParts: unknown[] = [], lite = false) {
  const key = Deno.env.get("GEMINI_API_KEY"); if (!key) throw new Error("no gemini");
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content ?? "") }] }));
  if (extraParts.length) contents.push({ role: "user", parts: extraParts as any });
  const base = lite ? GEM_LITE : GEM_FAST;
  const all = (LAST_OK && base.includes(LAST_OK) ? [LAST_OK, ...base.filter((m) => m !== LAST_OK)] : base).filter((m) => !DEAD.has(m));
  const fresh = all.filter((m) => !(COOL[m] > Date.now()));
  const order = fresh.length ? fresh : all;
  let last = "";
  const t0 = Date.now();
  for (let pass = 0; pass < 2; pass++) {
    let busy = false;
    for (const model of order) {
      if (Date.now() - t0 > 25000) throw new Error(last || "gemini trop lent");
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 10000);
      let r: Response;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", signal: ctl.signal,
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
            contents,
            generationConfig: { ...(json ? { responseMimeType: "application/json" } : {}), ...(MINIMAL_OK.has(model) ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}) },
          }),
        });
      } catch (_e) { last = "gemini " + model + " délai dépassé"; busy = true; continue; } finally { clearTimeout(tm); }
      if (r.ok) {
        const j = await r.json();
        const t = (j.candidates?.[0]?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || "").join("");
        if (t && json) { try { JSON.parse(t); LAST_OK = model; return t as string; } catch (_e) { last = "gemini json invalide"; continue; } }
        if (t) { LAST_OK = model; return t as string; }
        last = "gemini vide " + JSON.stringify(j).slice(0, 200);
        continue;
      }
      last = "gemini " + r.status + " " + (await r.text()).slice(0, 200);
      if (r.status === 404) { DEAD.add(model); continue; }
      if (r.status === 400 && /API key/i.test(last)) throw new Error(last);
      if (r.status === 401 || r.status === 403) throw new Error(last);
      if (r.status === 429 && /quota/i.test(last)) { COOL[model] = Date.now() + 600000; if (LAST_OK === model) LAST_OK = ""; continue; }
      if (r.status === 429 || r.status >= 500) busy = true;
    }
    if (!busy) break; // erreurs définitives : inutile de refaire un tour
    await new Promise((res) => setTimeout(res, 800));
  }
  throw new Error(last);
}
// Essaie Gemini, puis Mistral
async function llm(messages: any[], json = true) {
  try { return await gemini(messages, json); }
  catch (e) { try { return await mistral(messages, json); } catch (e2) { throw new Error(String(e) + " | " + String(e2)); } }
}
async function call(model: string, messages: unknown[], json: boolean) {
  return await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + Deno.env.get("MISTRAL_API_KEY") },
    body: JSON.stringify({ model, temperature: 0.2, messages, ...(json ? { response_format: { type: "json_object" } } : {}) }),
  });
}

const REFS: Record<string, string> = {};
async function refVoice(name: string) {
  if (!/^[a-z0-9_-]+$/.test(name)) throw new Error("voix inconnue");
  if (!REFS[name]) {
    const r = await fetch("https://raw.githubusercontent.com/Kyushi93/assistant-/main/voices/" + name + ".wav");
    if (!r.ok) throw new Error("voix introuvable");
    const u = new Uint8Array(await r.arrayBuffer()); let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    REFS[name] = btoa(s);
  }
  return REFS[name];
}
const EL_VOICE = Deno.env.get("ELEVEN_VOICE_ID") || "pNInz6obpgDQGcFmaJgB";
async function elevenTTS(text: string, voice: string) {
  const key = Deno.env.get("ELEVEN_API_KEY"); if (!key) throw new Error("no eleven");
  const r = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voice + "?output_format=mp3_44100_64", {
    method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", language_code: "fr", voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 1.03 } }),
  });
  if (!r.ok) throw new Error("eleven " + r.status + " " + (await r.text()).slice(0, 200));
  const u = new Uint8Array(await r.arrayBuffer()); let s = "";
  for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode(...u.subarray(k, k + 0x8000));
  return btoa(s);
}
async function mistralTTS(text: string, voice: string) {
  let last = "";
  for (const model of ["voxtral-mini-tts-2603", "voxtral-mini-tts-3-0"]) {
    const body: Record<string, unknown> = { model, input: text, response_format: "mp3" };
    if (voice.startsWith("ref:")) body.ref_audio = await refVoice(voice.slice(4)); else body.voice_id = voice;
    const r = await fetch("https://api.mistral.ai/v1/audio/speech", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + Deno.env.get("MISTRAL_API_KEY") }, body: JSON.stringify(body) });
    if (r.ok) { const j = await r.json(); return j.audio_data as string; }
    last = "tts " + r.status + " " + (await r.text()).slice(0, 200);
    if (r.status === 401) break;
  }
  throw new Error(last);
}
async function azureTTS(text: string, vname?: string) {
  const key = Deno.env.get("AZURE_SPEECH_KEY"), region = Deno.env.get("AZURE_SPEECH_REGION") || "francecentral";
  if (!key) throw new Error("no azure");
  const voice = (vname && /^fr-FR-[A-Za-z]+Neural$/.test(vname)) ? vname : (Deno.env.get("AZURE_VOICE") || "fr-FR-RemyMultilingualNeural");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="fr-FR"><voice name="${voice}"><lang xml:lang="fr-FR"><prosody rate="+4%">${esc(text)}</prosody></lang></voice></speak>`;
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "jarvis-app" }, body: ssml });
  if (!r.ok) throw new Error("azure " + r.status + " " + (await r.text()).slice(0, 200));
  const u = new Uint8Array(await r.arrayBuffer()); let s = "";
  for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode(...u.subarray(k, k + 0x8000));
  return btoa(s);
}
async function speakText(text: string, voice?: string) {
  const v = String(voice || "auto");
  if (v === "auto" || v === "azure" || v.startsWith("az:")) {
    try { return { audio: await azureTTS(text, v.startsWith("az:") ? v.slice(3) : undefined), engine: "azure" }; } catch (_e) { /* pas de clé Azure ou quota : on essaie la suite */ }
  }
  if (v === "auto" || v === "azure" || v.startsWith("el:")) {
    try { return { audio: await elevenTTS(text, v.startsWith("el:") ? v.slice(3) : EL_VOICE), engine: "elevenlabs" }; } catch (_e) { /* quota épuisé ou pas de clé : voix Mistral */ }
    return { audio: await mistralTTS(text, "ref:pierre"), engine: "mistral" };
  }
  return { audio: await mistralTTS(text, v), engine: "mistral" };
}
const GLOSS = `Le texte peut venir d'une DICTÉE VOCALE en français avec des fautes phonétiques : devine toujours le sens le plus probable au lieu de le prendre au pied de la lettre. Thyvan mange souvent asiatique. Correspondances fréquentes (orthographe phonétique → vrai nom) : "ban sao / ban xeo / banh seo / bain de serre / ban seo" → bánh xèo ; "feu / fo / pho" → phở ; "boboon / bobun / bo boun / bo bun / bobune" → bò bún (vermicelles, bœuf sauté, crudités, cacahuètes) ; "boun bo / bun bo hue" (seulement si "Huế" est dit) → bún bò Huế ; "boun / bun" → bún (bò bún, bún chả, bún thịt nướng) ; "ban mi" → bánh mì ; "ban cuon" → bánh cuốn ; "com tam" → cơm tấm ; "hu tieu / hou tiou" → hủ tiếu ; "mi sao" → mì xào ; "goi cuon / rouleau de printemps" → gỏi cuốn ; "nem / cha gio" → chả giò ; "lap / larb / laab" → larb (laotien) ; "khao piak / kao piak" → khao piak sen ; "tam mak hong / papaye" → salade de papaye ; "khao niao / riz gluant" → riz gluant ; "lok lak" → bœuf lok lak ; "pad thai" → pad thaï ; "bibimbap", "tteokbokki", "ramen", "gyoza", "dim sum", "bo bun".`;
const DISH = `Tu es nutritionniste en France. On te décrit ce qu'une personne a mangé (souvent par DICTÉE VOCALE, donc avec des fautes : devine le sens le plus probable, ex. "5 midi pancakes" = 5 mini pancakes, "boboon" = bò bún).
RÈGLES :
1) Sépare chaque aliment ou plat distinct en un élément à part (ex. "2 bò bún avec 5 nems" = 2 éléments : bò bún nb=2 ET nems nb=5). N'invente JAMAIS d'aliment qui n'a pas été dit.
2) "nb" = le nombre d'unités/portions de CET élément uniquement. "Un peu de" = nb 0.5. Sans précision, nb = 1.
3) PRIORITÉ ABSOLUE AUX CHIFFRES DONNÉS : si la personne donne elle-même des valeurs (kcal, protéines, glucides, lipides, pour la portion, pour 100 g, pour le paquet…), recopie-les EXACTEMENT, sans les arrondir ni les « corriger ». Mets "source": "utilisateur" et un seul ingrédient (le produit). Si elle donne des valeurs pour 100 g et un poids, mets g = ce poids et les valeurs dans k100/p100/c100/f100. Si elle donne des valeurs pour la portion, mets-les dans kcal/p/c/f et g = le poids indiqué (ou 100 si inconnu). Une valeur non donnée = estime-la, mais ne touche pas à celles qui sont données.
4) PRODUIT DE MARQUE / DU COMMERCE (ex. "skyr Danone", "Pépito", "Big Mac", "Lipton Ice Tea", "barre Kinder Bueno", "poulet Herta") sans chiffres donnés : mets "source": "marque", "marque": "nom exact de recherche (marque + produit)", un seul ingrédient (le produit), g = poids consommé pour 1 unité (1 pot, 1 barre, 1 burger…), et tes meilleures valeurs pour 100 g. Elles seront remplacées par les vraies valeurs de l'étiquette.
5) Sinon "source": "estimation". Ingrédients pour UNE SEULE unité/portion standard d'un adulte, plutôt MOYENNE que généreuse (en cas de doute, prends le bas de la fourchette). Pas d'eau, pas d'épices négligeables. Ce qui est listé à part (ex. les nems) n'est pas compté dans le plat. Grammes = poids tel que mangé (féculents CUITS). Pour chaque ingrédient, donne les valeurs POUR 100 g selon la table Ciqual (k100, p100, c100, f100), pas le total.
6) Repères par unité : pain au chocolat ≈ 70 g / 290 kcal ; mini pancake ≈ 25 g / 60 kcal ; nem frit ≈ 35 g / 85 kcal ; bò bún (assiette sans nem) ≈ 450-550 kcal ; phở (grand bol) ≈ 450-550 kcal ; bánh mì ≈ 400-500 kcal ; sandwich poulet-crudités ≈ 400-500 kcal ; kebab ≈ 700 kcal ; assiette de pâtes ≈ 450-550 kcal ; riz cuit ≈ 130 kcal/100 g ; blanc de poulet cuit ≈ 150 kcal/100 g, 30 g de protéines/100 g ; œuf ≈ 50 g / 70 kcal.
${GLOSS}
Réponds UNIQUEMENT en JSON : {"elements": [{"plat": "vrai nom bien orthographié", "portion": "ce que représente 1 unité", "nb": nombre, "source": "utilisateur|marque|estimation", "marque": "texte de recherche ou vide", "ingredients": [{"nom": "aliment", "g": grammes_pour_1_unite, "k100": kcal_pour_100g, "p100": prot_pour_100g, "c100": gluc_pour_100g, "f100": lip_pour_100g, "kcal": total_si_donne, "p": total_si_donne, "c": total_si_donne, "f": total_si_donne}]}]}
1 à 8 ingrédients par élément.`;

const num = (v: unknown) => { const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : Number(v); return isFinite(n) && n >= 0 ? n : NaN; };
// Open Food Facts : valeurs réelles de l'étiquette (recherche rapide puis fiche produit)
const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/xx:/g, "");
async function getJSON(u: string, ms = 4000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(u, { headers: { "User-Agent": "AssistantThyvan/1.0 (perso)" }, signal: ctl.signal }); return r.ok ? await r.json() : null; }
  catch (_e) { return null; } finally { clearTimeout(t); }
}
async function offLookup(q: string) {
  const words = norm(q).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (!words.length) return null;
  const s = await getJSON("https://search.openfoodfacts.org/search?page_size=12&langs=fr&q=" + encodeURIComponent(q));
  const hits = (s?.hits || []).map((p: any) => {
    const name = norm(String(p.product_name || "")), brand = norm(Array.isArray(p.brands) ? p.brands.join(" ") : String(p.brands || ""));
    const nameW = name.split(/[^a-z0-9]+/).filter((w: string) => w.length > 2);
    const match = words.filter((w) => name.includes(w) || brand.includes(w)).length;
    const extra = nameW.filter((w: string) => !words.some((x) => w.includes(x) || x.includes(w))).length;
    return { p, sc: match - 0.3 * extra + Math.min(1, (p.unique_scans_n || 0) / 500) * 0.2 };
  }).filter((h: any) => h.p.code && h.sc >= Math.min(2, words.length) - 0.5).sort((a: any, b: any) => b.sc - a.sc).slice(0, 3);
  const ds = await Promise.all(hits.map((h: any) => getJSON(`https://world.openfoodfacts.org/api/v2/product/${h.p.code}?fields=product_name,brands,nutriments,serving_quantity`, 3500)));
  for (const d of ds) {
    const n = d?.product?.nutriments; if (!n) continue;
    const k = num(n["energy-kcal_100g"]); if (isNaN(k)) continue;
    const pr = d.product;
    const br = String(pr.brands || "").split(",")[0].trim(), pn = String(pr.product_name || "");
    return { name: br && !norm(pn).includes(norm(br)) ? br + " " + pn : pn || br, k100: k, p100: num(n.proteins_100g) || 0, c100: num(n.carbohydrates_100g) || 0, f100: num(n.fat_100g) || 0, serving: num(pr.serving_quantity), src: "Open Food Facts" };
  }
  return null;
}
// Nombres donnés explicitement dans le texte (garde-fou)
function statedMacros(text: string) {
  const t = text.toLowerCase().replace(",", ".");
  const grab = (re: RegExp) => { const m = t.match(re); return m ? parseFloat(m[1]) : NaN; };
  return {
    kcal: grab(/(\d+(?:\.\d+)?)\s*(?:kcal|cal\b|calories)/),
    p: grab(/(\d+(?:\.\d+)?)\s*g?\s*(?:de\s+)?prot/),
    c: grab(/(\d+(?:\.\d+)?)\s*g?\s*(?:de\s+)?glu/),
    f: grab(/(\d+(?:\.\d+)?)\s*g?\s*(?:de\s+)?(?:lip|gras|mati)/),
    per100: /pour\s*100|\/\s*100\s*g|aux?\s*100/.test(t),
  };
}
const r1 = (v: number) => Math.round(v * 10) / 10;
async function analyseDish(text: string) {
  const out = JSON.parse(await llm([{ role: "system", content: DISH }, { role: "user", content: text }]));
  const els: any[] = Array.isArray(out.elements) ? out.elements : [];
  const stated = statedMacros(text);
  const res = await Promise.all(els.map(async (el) => {
    let src = String(el.source || "estimation");
    let ing = (el.ingredients || []).filter((x: any) => x && x.nom).map((x: any) => {
      const g = num(x.g) > 0 ? num(x.g) : 100;
      const has100 = !isNaN(num(x.k100));
      let k = has100 ? num(x.k100) * g / 100 : num(x.kcal);
      let p = has100 ? (num(x.p100) || 0) * g / 100 : num(x.p) || 0;
      let c = has100 ? (num(x.c100) || 0) * g / 100 : num(x.c) || 0;
      let f = has100 ? (num(x.f100) || 0) * g / 100 : num(x.f) || 0;
      if (isNaN(k)) k = 4 * p + 4 * c + 9 * f;
      // cohérence kcal / macros pour les estimations (évite les kcal gonflées)
      const kc = 4 * p + 4 * c + 9 * f;
      if (src === "estimation" && kc > 0 && Math.abs(k - kc) / kc > 0.2) k = kc;
      return { nom: x.nom, g: Math.round(g), kcal: k, p, c, f };
    });
    let note = "";
    // garde-fou : chiffres écrits par l'utilisateur, un seul aliment
    if (els.length === 1 && !isNaN(stated.kcal) && ing.length) {
      src = "utilisateur";
      const g = ing.length === 1 ? ing[0].g : 100;
      const m = stated.per100 ? g / 100 : 1;
      const base = ing.length === 1 ? ing[0] : { nom: el.plat || text, g, kcal: 0, p: 0, c: 0, f: 0 };
      ing = [{ nom: base.nom, g, kcal: stated.kcal * m, p: isNaN(stated.p) ? base.p : stated.p * m, c: isNaN(stated.c) ? base.c : stated.c * m, f: isNaN(stated.f) ? base.f : stated.f * m }];
    }
    if (src === "utilisateur") note = "tes chiffres";
    else if (src === "marque" && el.marque) {
      const L = await offLookup(el.marque);
      if (L) {
        const g = (!/\d+\s*g\b/i.test(text) && L.serving > 0 && L.serving < 1500) ? L.serving : (ing[0]?.g || 100);
        ing = [{ nom: L.name, g: Math.round(g), kcal: L.k100 * g / 100, p: L.p100 * g / 100, c: L.c100 * g / 100, f: L.f100 * g / 100 }];
        note = "étiquette · " + L.src;
      } else note = "estimation (produit non trouvé)";
    } else note = "estimation";
    ing = ing.map((i: any) => ({ ...i, kcal: Math.round(i.kcal), p: r1(i.p), c: r1(i.c), f: r1(i.f) }));
    const tot = ing.reduce((a: number, i: any) => a + i.kcal, 0);
    return { plat: el.plat || text, portion: [el.portion, note].filter(Boolean).join(" · "), nb: num(el.nb) > 0 ? num(el.nb) : 1, source: src, kcal_unite: tot, ingredients: ing };
  }));
  return { elements: res.filter((e) => e.ingredients.length) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const b = await req.json();
    if (b.mode === "dish") {
      return J(await analyseDish(String(b.text).slice(0, 400)));
    }
    if (b.mode === "voices") {
      const r = await fetch("https://api.mistral.ai/v1/audio/voices?limit=100&type=all", { headers: { Authorization: "Bearer " + Deno.env.get("MISTRAL_API_KEY") } });
      return J({ status: r.status, body: await r.json().catch(() => null) });
    }
    if (b.mode === "tts") {
      return J(await speakText(String(b.text || "").slice(0, 1200), b.voice));
    }
    if (b.mode === "stt") {
      const bin = Uint8Array.from(atob(String(b.audio)), (ch) => ch.charCodeAt(0));
      const ext = /mp4|m4a|aac/.test(b.mime || "") ? "m4a" : /ogg/.test(b.mime || "") ? "ogg" : /wav/.test(b.mime || "") ? "wav" : "webm";
      try {
        const t = await gemini([{ role: "system", content: "Transcris exactement cet audio en français, sans rien ajouter. Vocabulaire possible : plats vietnamiens/laotiens (bánh xèo, phở, bò bún, bún bò Huế, bánh mì, larb, khao piak), ostéo, PAO, UE, CC, TD, CM, Aurion, Thyvan. Réponds UNIQUEMENT par le texte transcrit." }], false, [{ inline_data: { mime_type: (b.mime || "audio/webm").split(";")[0], data: String(b.audio) } }], true);
        if (t.trim()) return J({ text: t.trim(), model: "gemini" });
      } catch (_e) { /* on tente Mistral */ }
      let last = "";
      const BIAS = ["bánh xèo", "phở", "bún bò Huế", "bò bún", "bánh mì", "bún chả", "cơm tấm", "hủ tiếu", "gỏi cuốn", "larb", "khao piak", "lok lak", "pad thaï", "ostéo", "PAO", "UE", "CC", "TD", "CM", "Aurion", "Thyvan"];
      const tries: [string, boolean][] = [["voxtral-mini-latest", true], ["voxtral-mini-latest", false], ["voxtral-mini-transcribe-3", false], ["voxtral-mini-2602", false]];
      for (const [model, bias] of tries) {
        const fd = new FormData();
        fd.append("model", model); fd.append("language", "fr");
        if (bias) for (const w of BIAS) fd.append("context_bias", w);
        fd.append("file", new Blob([bin], { type: b.mime || "audio/webm" }), "voix." + ext);
        const r = await fetch("https://api.mistral.ai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + Deno.env.get("MISTRAL_API_KEY") }, body: fd });
        if (r.ok) { const j = await r.json(); return J({ text: (j.text || "").trim(), model, bias }); }
        last = "stt " + r.status + " " + (await r.text()).slice(0, 200);
        if (r.status === 401) break;
      }
      throw new Error(last);
    }
    if (b.mode === "chat") {
      const sys = `Tu es JARVIS, l'assistant personnel de Thyvan (étudiant en 2e année d'ostéopathie, P2, à l'ESO Paris). Thyvan est ton boss : tu l'appelles « boss » naturellement (pas à chaque phrase). Tu es son majordome : tu le VOUVOIES, avec un français impeccable, élégant mais naturel, comme un vrai humain qui parle à l'oral ; dévoué, posé, attentionné, avec une pointe d'humour pince-sans-rire à la Jarvis. Phrases courtes et naturelles (ex. « Bien, boss. », « C'est noté. », « Puis-je vous suggérer… »). Tes réponses sont LUES À VOIX HAUTE : 1 à 4 phrases, pas de listes, pas de markdown, pas d'emoji, heures écrites comme on les dit (« 8 h 30 »). Va droit au but, puis propose la suite si utile (« Souhaitez-vous que je vous prépare un planning de révision ? »). Aujourd'hui : ${b.today}.
Contexte de son app (JSON) : ${JSON.stringify(b.ctx).slice(0, 12000)}
Tu peux proposer des actions que l'app exécutera. Réponds UNIQUEMENT en JSON : {"reply": "ta réponse", "actions": [ ... ]}
Actions possibles :
- {"type":"water","ml":nombre} quand il dit avoir bu (conversions : 1 cl = 10 ml, 25 cl = 250 ml, 50 cl = 500 ml, 1 L = 1000 ml, un verre ≈ 250 ml, une bouteille ≈ 500 ml, une gourde ≈ 750 ml)
- {"type":"task","t":"texte","d":"AAAA-MM-JJ ou vide","c":"etudes|perso|sante"} pour ajouter une tâche
- {"type":"meal","text":"ce qu'il a mangé, en recopiant MOT POUR MOT les quantités, la marque et les chiffres (kcal, protéines, glucides, lipides) qu'il a donnés","k":"Petit-déj|Déjeuner|Collation|Dîner"} quand il dit avoir mangé
- {"type":"sleep","h":nombre} quand il dit combien il a dormi
- {"type":"gym","s":"push|pull|legs|full|cardio|repos","dur":minutes}
- {"type":"study","min":nombre,"ue":"code UE ou vide"} quand il dit avoir révisé
${GLOSS}
Si le message semble coupé ou incompréhensible, demande gentiment de répéter au lieu d'inventer.
N'invente pas de cours ni d'évals : utilise seulement le contexte. Si aucune action, "actions": [].`;
      const msgs = [{ role: "system", content: sys }, ...(b.history || []).slice(-10), { role: "user", content: String(b.text).slice(0, 2000) }];
      const out = JSON.parse(await llm(msgs));
      if (b.tts && out.reply) {
        const clean = String(out.reply).replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
        const parts = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean];
        const first = parts[0].trim(), rest = parts.slice(1).join("").trim();
        try { const sp = await speakText(first, b.tts); out.audio0 = sp.audio; out.engine = sp.engine; out.rest = rest; } catch (_e) { /* le client lira lui-même */ }
      }
      return J(out);
    }
    return J({ error: "mode inconnu" }, 400);
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
