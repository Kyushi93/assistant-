// IA de l'assistant (Mistral) — clé gardée dans les secrets Supabase
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
1) Sépare chaque aliment ou plat distinct en un élément à part (ex. "2 bò bún avec 5 nems" = 2 éléments : bò bún nb=2 ET nems nb=5 ; "un pain au chocolat et 5 mini pancakes" = 2 éléments). N'invente JAMAIS d'aliment qui n'a pas été dit.
2) "nb" = le nombre d'unités/portions de CET élément uniquement. Un nombre qui se rapporte à un autre aliment ne compte pas (dans "2 bò bún avec 5 nems", le bò bún a nb=2, pas 5). "Un peu de" = nb 0.5. Sans précision, nb = 1.
3) Les ingrédients, grammes et macros sont pour UNE SEULE unité/portion standard d'un adulte (1 viennoiserie, 1 mini pancake, 1 sandwich, 1 assiette normale), pas une grosse portion. Pas d'eau, pas d'épices négligeables. Ce qui est listé à part (ex. les nems) n'est pas compté dans le plat.
4) Grammes = poids tel que mangé (féculents CUITS ; pâtes, riz ou vermicelles cuits ≈ 110 à 150 kcal/100 g). Macros réalistes (table Ciqual).
5) Repères par unité : pain au chocolat ≈ 70 g / 290 kcal ; mini pancake ≈ 25 g / 60 kcal ; nem frit ≈ 35 g / 85 kcal ; bò bún (assiette sans nem) ≈ 450-550 kcal ; sandwich poulet-mayo ≈ 500-650 kcal ; kebab ≈ 750 kcal ; assiette de pâtes ≈ 500-600 kcal ; portion de pommes de terre ≈ 150 g / 150-250 kcal.
6) "kcal_unite" = total kcal pour 1 unité : vérifie qu'il est cohérent avec les repères avant de répondre.
${GLOSS}
Réponds UNIQUEMENT en JSON : {"elements": [{"plat": "vrai nom bien orthographié", "portion": "ce que représente 1 unité", "nb": nombre, "kcal_unite": nombre, "ingredients": [{"nom": "aliment simple façon Ciqual", "g": grammes_pour_1_unite, "kcal": kcal, "p": proteines_g, "c": glucides_g, "f": lipides_g}]}]}
1 à 8 ingrédients par élément.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const b = await req.json();
    if (b.mode === "dish") {
      const out = JSON.parse(await mistral([{ role: "system", content: DISH }, { role: "user", content: String(b.text).slice(0, 300) }]));
      return J(out);
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
- {"type":"meal","text":"description du plat","k":"Petit-déj|Déjeuner|Collation|Dîner"} quand il dit avoir mangé
- {"type":"sleep","h":nombre} quand il dit combien il a dormi
- {"type":"gym","s":"push|pull|legs|full|cardio|repos","dur":minutes}
- {"type":"study","min":nombre,"ue":"code UE ou vide"} quand il dit avoir révisé
${GLOSS}
Si le message semble coupé ou incompréhensible, demande gentiment de répéter au lieu d'inventer.
N'invente pas de cours ni d'évals : utilise seulement le contexte. Si aucune action, "actions": [].`;
      const msgs = [{ role: "system", content: sys }, ...(b.history || []).slice(-10), { role: "user", content: String(b.text).slice(0, 2000) }];
      const out = JSON.parse(await mistral(msgs));
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
