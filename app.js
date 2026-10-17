"use strict";
/* Test Agents Rurals — app d'estudi tipus test (sense dependències) */

const EXAM = { n: 80, minutes: 105, max: 22, pass: 11 };
const KEY = "ar-test-v1";
const LETTERS = ["A", "B", "C", "D"];

let DB = null;          // { temes, preguntes }
let OF = [];            // exàmens oficials
let BYID = {};
let S = load();         // progrés desat
let view = { name: "home" };
let quiz = null;        // sessió en curs
let timerId = null;

/* ---------------- Persistència ---------------- */
function blank() { return { q: {}, err: [], exams: [], sel: [], cfg: { n: 20, filtre: "tot" } }; }
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.q) return Object.assign(blank(), s); } catch (e) {}
  return blank();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
function saveQuiz() { try { if (quiz && quiz.mode === "exam" && !quiz.done) localStorage.setItem(KEY + "-exam", JSON.stringify(quiz)); else localStorage.removeItem(KEY + "-exam"); } catch (e) {} }
function loadQuiz() { try { return JSON.parse(localStorage.getItem(KEY + "-exam")); } catch (e) { return null; } }

/* Registre d'una resposta: [vistes, encerts, errors, ratxa, últimaData] */
function record(id, ok) {
  const r = S.q[id] || [0, 0, 0, 0, 0];
  r[0]++; if (ok) { r[1]++; r[3]++; } else { r[2]++; r[3] = 0; }
  r[4] = Date.now();
  S.q[id] = r;
  const i = S.err.indexOf(id);
  if (!ok && i < 0) S.err.push(id);
  if (ok && i >= 0 && r[3] >= 2) S.err.splice(i, 1);   // surt de "errors" després de 2 encerts seguits
}

/* ---------------- Utilitats ---------------- */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const fmt = n => n.toLocaleString("ca-ES", { maximumFractionDigits: 2 });
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
function clock(sec) { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); }
function temaNom(t) { if (t === "OF") return "Examen oficial"; const x = DB.temes.find(z => z.id === t); return x ? x.nom : t; }
function temaLabel(t) { if (t === "OF") return "Examen oficial"; return (t[0] === "G" ? "General " : "Específic ") + t.slice(1); }

function topicStats(tid) {
  const qs = DB.preguntes.filter(q => q.t === tid);
  let seen = 0, ok = 0, tot = 0, mastered = 0;
  for (const q of qs) { const r = S.q[q.id]; if (r) { seen++; ok += r[1]; tot += r[0]; if (r[3] >= 1 && r[1] > r[2]) mastered++; } }
  return { n: qs.length, seen, acc: pct(ok, tot), mastered, dom: pct(mastered, qs.length) };
}

/* ---------------- Construcció de sessions ---------------- */
function makeItem(q) { return { id: q.id, ord: shuffle([0, 1, 2, 3]), a: null, flag: false }; }

function buildExam() {
  // mostra estratificada: proporcional a la mida de cada tema
  const total = DB.preguntes.length, pick = [];
  const byT = {}; DB.preguntes.forEach(q => (byT[q.t] = byT[q.t] || []).push(q));
  const quotas = DB.temes.map(t => ({ t: t.id, exact: EXAM.n * byT[t.id].length / total }));
  quotas.forEach(x => x.k = Math.floor(x.exact));
  let rest = EXAM.n - quotas.reduce((s, x) => s + x.k, 0);
  shuffle(quotas).sort((a, b) => (b.exact - b.k) - (a.exact - a.k)).slice(0, rest).forEach(x => x.k++);
  quotas.forEach(x => pick.push(...shuffle(byT[x.t]).slice(0, x.k)));
  return { mode: "exam", title: "Simulacre d'examen", items: shuffle(pick).map(makeItem), i: 0, start: Date.now(), limit: EXAM.minutes * 60, done: false };
}

function buildOfficial(ex) {
  return { mode: "exam", oficial: ex.id, title: ex.nom + " · " + ex.torn, items: ex.ordre.map(id => ({ id, ord: [0, 1, 2, 3], a: null, flag: false })), i: 0, start: Date.now(), limit: ex.min * 60, done: false };
}

function buildPractice(temes, n, filtre) {
  let pool = DB.preguntes.filter(q => temes.includes(q.t));
  if (filtre === "noves") pool = pool.filter(q => !S.q[q.id]);
  if (filtre === "fluixes") pool = pool.filter(q => { const r = S.q[q.id]; return r && r[2] > 0; });
  // prioritza les menys vistes
  pool = shuffle(pool).sort((a, b) => ((S.q[a.id] || [0])[0]) - ((S.q[b.id] || [0])[0]));
  const take = n === "tot" ? pool : pool.slice(0, n);
  const title = temes.length === 1 ? temaLabel(temes[0]) + " · " + temaNom(temes[0]) : temes.length + " temes";
  return { mode: "practice", title, items: shuffle(take).map(makeItem), i: 0, start: Date.now(), done: false };
}

const NIVELLS = [
  { d: 1, nom: "Bàsica", desc: "Conceptes clau i dades que surten a tots els exàmens" },
  { d: 2, nom: "Mitjana", desc: "Articles, terminis, òrgans competents i classificacions" },
  { d: 3, nom: "Difícil", desc: "Detalls fins, xifres concretes i excepcions" },
  { d: 0, nom: "Barrejades", desc: "Totes les dificultats juntes, a l'atzar" }
];
function buildDif(d, n) {
  let pool = DB.preguntes.filter(q => !d || q.d === d);
  pool = shuffle(pool).sort((a, b) => ((S.q[a.id] || [0])[0]) - ((S.q[b.id] || [0])[0]));
  const take = n === "tot" ? pool : pool.slice(0, n);
  const nv = NIVELLS.find(x => x.d === d);
  return { mode: "practice", dif: d, title: "Dificultat " + nv.nom.toLowerCase(), items: shuffle(take).map(makeItem), i: 0, start: Date.now(), done: false };
}
function difStats(d) {
  const qs = DB.preguntes.filter(q => !d || q.d === d); let seen = 0, ok = 0, tot = 0;
  qs.forEach(q => { const r = S.q[q.id]; if (r) { seen++; ok += r[1]; tot += r[0]; } });
  return { n: qs.length, seen, acc: pct(ok, tot) };
}

function buildErrors() {
  const items = shuffle(S.err.filter(id => BYID[id])).map(id => makeItem(BYID[id]));
  return { mode: "errors", title: "Repàs d'errors", items, i: 0, start: Date.now(), done: false };
}

/* ---------------- Navegació ---------------- */
function go(name, extra) {
  view = Object.assign({ name }, extra || {});
  if (name !== "quiz") { clearInterval(timerId); timerId = null; }
  render();
  window.scrollTo(0, 0);
}
function startQuiz(q) {
  if (!q.items.length) { alert("No hi ha cap pregunta amb aquests filtres."); return; }
  quiz = q; saveQuiz(); go("quiz");
}

/* ---------------- Vistes ---------------- */
function render() {
  const app = $("#app");
  const v = { home: vHome, dif: vDif, oficials: vOficials, temes: vTemes, quiz: vQuiz, result: vResult, stats: vStats }[view.name];
  app.innerHTML = v();
  bind(app);
  if (view.name === "quiz" && quiz.mode === "exam" && !timerId) timerId = setInterval(tick, 1000);
}

const CONTOUR = `<svg class="contour" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2">
<path d="M-20 160 C60 120 110 170 180 130 S300 60 420 100"/><path d="M-20 140 C50 100 120 150 190 110 S290 40 420 78"/>
<path d="M-20 120 C40 82 130 128 200 92 S280 24 420 56"/><path d="M-20 182 C70 140 100 190 170 152 S310 84 420 124"/>
<path d="M250 70 c20 -18 60 -20 70 2 s-30 36 -58 24 s-28 -14 -12 -26z"/><path d="M262 70 c14 -10 40 -10 44 3 s-20 20 -38 14 s-16 -9 -6 -17z"/>
<path d="M60 40 c30 -14 70 -6 66 14 s-46 22 -70 10 s-14 -18 4 -24z"/></g></svg>`;

function vHome() {
  const seen = Object.keys(S.q).filter(id => BYID[id]).length;
  const total = DB.preguntes.length;
  const pending = loadQuiz();
  const last = S.exams[S.exams.length - 1];
  return `
  <header class="mast">${CONTOUR}<div class="wrap">
    <h1>Test<br>Agents Rurals</h1>
    <p>${total.toLocaleString("ca-ES")} preguntes dels 25 temes de la guia d'estudi oficial.</p>
  </div></header>
  <main class="wrap">
    <div class="modes">
      ${pending ? `<button class="mode primary" data-act="resume"><h3>Continuar el simulacre</h3><p>Pregunta ${pending.i + 1} de ${pending.items.length} · queden ${clock(pending.limit - (Date.now() - pending.start) / 1000)}</p><span class="side">▶</span></button>` : ""}
      <button class="mode ${pending ? "" : "primary"}" data-act="exam"><h3>Simulacre d'examen</h3><p>80 preguntes · 1 h 45 min · cada error resta ¼</p><span class="side">${last ? `${fmt(last.nota)}<small>última nota</small>` : ""}</span></button>
      ${OF.length ? `<button class="mode" data-go="oficials"><h3>Exàmens oficials</h3><p>Preguntes reals de convocatòries anteriors, amb la plantilla oficial</p><span class="side">${OF.length}</span></button>` : ""}
      <button class="mode dif" data-go="dif"><h3>Preguntes per dificultat</h3><p>Barreja de tots els temes, del nivell que triïs</p><span class="side">${"●".repeat(3)}</span></button>
      <button class="mode" data-go="temes"><h3>Practicar per temes</h3><p>Tria temes i veu la resposta correcta a l'instant</p><span class="side">${pct(seen, total)}%</span></button>
      <button class="mode" data-act="errors" ${S.err.length ? "" : "disabled"}><h3>Repassar errors</h3><p>${S.err.length ? "Cada pregunta surt de la llista quan l'encertes dues vegades seguides" : "Aquí apareixeran les preguntes que fallis"}</p><span class="side">${S.err.length}</span></button>
      <button class="mode" data-go="stats"><h3>Estadístiques</h3><p>Domini per tema i historial de simulacres</p><span class="side">${S.exams.length}</span></button>
    </div>
    <div class="note">Les preguntes s'han redactat a partir de la <em>Guia d'estudi</em> (edició de desembre de 2023). Les dades de temporades de caça i pesca, xifres i noms de departaments poden haver canviat: contrasta-les amb la normativa vigent.</div>
    <footer class="foot">Nota del simulacre: Q = (A − E/4) × 22 / 80. Per aprovar el primer exercici cal un 11.
      <br><button class="linkbtn" data-act="theme">Canviar tema clar/fosc</button></footer>
  </main>`;
}

function vOficials() {
  const list = OF.map(ex => {
    const done = S.exams.filter(e => e.of === ex.id), best = done.length ? Math.max(...done.map(e => e.nota)) : null;
    return `<button class="mode" data-official="${ex.id}"><h3>${esc(ex.nom)} · ${esc(ex.torn)}</h3>
      <p>${ex.ordre.length} preguntes · ${ex.min} min · ${done.length ? `fet ${done.length} ${done.length === 1 ? "vegada" : "vegades"}, millor nota ${fmt(best)}` : "encara no l'has fet"}</p>
      <span class="side">${ex.any}</span></button>`;
  }).join("");
  return `${bar("Exàmens oficials")}<main class="wrap">
    <p class="muted" style="margin-top:20px">Són els qüestionaris reals, en l'ordre original i amb la correcció de la plantilla oficial. Es puntuen igual que el simulacre: sobre 22, i cada error resta ¼.</p>
    <div class="modes" style="margin-top:16px">${list}</div>
    <div class="note">Aquests exàmens són del 2020. Algunes preguntes es basen en normativa que després ha canviat (per exemple, l'estructura dels departaments). L'explicació de cada pregunta ho indica quan és el cas.</div>
  </main>`;
}

function vDif() {
  const cards = NIVELLS.map(nv => { const st = difStats(nv.d); return `
    <button class="level l${nv.d}" data-dif="${nv.d}">
      <span class="dots" aria-hidden="true">${nv.d ? "●".repeat(nv.d) + "○".repeat(3 - nv.d) : "●◐○"}</span>
      <h3>${nv.nom}</h3><p>${nv.desc}</p>
      <span class="lstat">${st.n} preguntes · ${st.seen ? `${st.acc}% d'encert` : "cap de vista"}</span>
    </button>`; }).join("");
  return `${bar("Per dificultat")}<main class="wrap difpage">
    <p class="muted" style="margin-top:20px">Les preguntes surten a l'atzar de tots els temes, començant per les que has vist menys. Veuràs la correcció a l'instant.</p>
    <div class="field"><span>Nombre de preguntes</span><div class="seg" data-cfg="n">
      ${[10, 20, 40, "tot"].map(x => `<button data-v="${x}" aria-pressed="${S.cfg.n == x}">${x === "tot" ? "Totes" : x}</button>`).join("")}</div></div>
    <div class="levels">${cards}</div>
  </main>`;
}

function vTemes() {
  const sel = new Set(S.sel);
  const groups = ["General", "Específic"].map(g => {
    const ts = DB.temes.filter(t => t.grup === g);
    return `<div class="group-head"><h3>Temari ${g.toLowerCase()}</h3><button class="linkbtn" data-all="${g}">${ts.every(t => sel.has(t.id)) ? "Desmarcar tots" : "Marcar tots"}</button></div>
    <div class="topics">${ts.map(t => { const st = topicStats(t.id); return `
      <button class="topic" data-topic="${t.id}" aria-pressed="${sel.has(t.id)}">
        <span class="code">${t.id}</span><span class="name">${esc(t.nom)}</span>
        <span class="pct">${st.seen ? st.acc + "% encert" : t.n + " preg."}</span>
        <span class="meter" title="Domini ${st.dom}%"><i style="width:${st.dom}%"></i></span>
      </button>`; }).join("")}</div>`;
  }).join("");
  const n = DB.preguntes.filter(q => sel.has(q.t)).length;
  return `${bar("Practicar per temes")}
  <main class="wrap">
    <p class="muted small" style="margin-top:16px">La barra verda indica quantes preguntes del tema domines.</p>
    ${groups}
    <div class="field"><span>Nombre de preguntes</span><div class="seg" data-cfg="n">
      ${[10, 20, 40, "tot"].map(x => `<button data-v="${x}" aria-pressed="${S.cfg.n == x}">${x === "tot" ? "Totes" : x}</button>`).join("")}</div></div>
    <div class="field"><span>Quines preguntes</span><div class="seg" data-cfg="filtre">
      ${[["tot", "Totes"], ["noves", "No vistes"], ["fluixes", "Alguna vegada fallades"]].map(([k, l]) => `<button data-v="${k}" aria-pressed="${S.cfg.filtre === k}">${l}</button>`).join("")}</div></div>
    <button class="btn block" data-act="practice" ${n ? "" : "disabled"}>${n ? `Començar (${n} preguntes disponibles)` : "Tria almenys un tema"}</button>
  </main>`;
}

function bar(title, right = "") {
  return `<div class="bar"><div class="wrap"><button class="back" data-act="back" aria-label="Tornar">←</button><span class="title">${esc(title)}</span>${right}</div></div>`;
}

function vQuiz() {
  const it = quiz.items[quiz.i], q = BYID[it.id], exam = quiz.mode === "exam";
  const answered = it.a !== null;
  const reveal = !exam && answered;
  const right = exam ? `<span class="timer" id="timer">${clock(remaining())}</span>` : `<span class="count">${quiz.i + 1}/${quiz.items.length}</span>`;
  const done = quiz.items.filter(x => x.a !== null).length;
  const opts = it.ord.map((oi, k) => {
    let cls = "";
    if (reveal) { if (oi === q.c) cls = "right"; else if (oi === it.a) cls = "wrong"; }
    else if (it.a === oi) cls = "sel";
    return `<li><button class="opt ${cls}" data-opt="${oi}" ${reveal ? "disabled" : ""}><span class="l">${LETTERS[k]}</span><span>${esc(q.o[oi])}</span></button></li>`;
  }).join("");
  const ok = it.a === q.c;
  const explain = reveal ? `<div class="explain ${ok ? "" : "bad"}"><strong>${ok ? "Correcte" : "Incorrecte. La resposta és la " + LETTERS[it.ord.indexOf(q.c)]}</strong>${q.e ? `<p>${esc(q.e)}</p>` : ""}<p class="src">${temaLabel(q.t)} · ${esc(q.s)}</p></div>` : "";
  const last = quiz.i === quiz.items.length - 1;
  let nav;
  if (exam) {
    nav = `<div class="qnav"><button class="btn ghost" data-act="prev" ${quiz.i ? "" : "disabled"}>Anterior</button>
      <button class="btn ghost flagbtn" data-act="flag" aria-pressed="${it.flag}">${it.flag ? "Marcada" : "Marcar"}</button>
      ${last ? `<button class="btn" data-act="finish">Lliurar</button>` : `<button class="btn" data-act="next">Següent</button>`}</div>
      ${answered ? `<p style="text-align:center;margin:12px 0 0"><button class="linkbtn" data-act="clear">Deixar en blanc</button></p>` : ""}
      <details class="sheet"><summary>Full de respostes · ${done} de ${quiz.items.length} contestades</summary>
      <div class="grid">${quiz.items.map((x, k) => `<button data-jump="${k}" class="${x.a !== null ? "ans" : ""} ${x.flag ? "flag" : ""} ${k === quiz.i ? "cur" : ""}" aria-label="Pregunta ${k + 1}">${k + 1}</button>`).join("")}</div>
      <div class="actions"><button class="btn warn" data-act="finish">Lliurar l'examen</button></div></details>`;
  } else {
    nav = reveal ? `<div class="qnav">${last ? `<button class="btn" data-act="finish">Veure resultat</button>` : `<button class="btn" data-act="next">Següent</button>`}</div>` : "";
  }
  return `${quiz.dif !== undefined ? '<div class="dif-theme">' : "<div>"}${bar(quiz.title, right)}<div class="progress"><i style="width:${pct(exam ? done : quiz.i + (answered ? 1 : 0), quiz.items.length)}%"></i></div>
  <main class="wrap">
    <p class="q-meta">${exam ? `Pregunta ${quiz.i + 1} de ${quiz.items.length}` : `${temaLabel(q.t)} · ${esc(temaNom(q.t))}${quiz.dif !== undefined && q.d ? ` · <span class="dtag d${q.d}">${NIVELLS[q.d - 1].nom}</span>` : ""}`}</p>
    <p class="q-text">${esc(q.p)}</p>
    <ol class="opts">${opts}</ol>
    ${explain}${nav}
  </main></div>`;
}

function remaining() { return quiz.limit - (Date.now() - quiz.start) / 1000; }
function tick() {
  if (!quiz || quiz.mode !== "exam" || quiz.done) return;
  const r = remaining(), el = $("#timer");
  if (el) { el.textContent = clock(r); el.classList.toggle("low", r < 600); }
  if (r <= 0) { finish(); alert("S'ha acabat el temps. L'examen s'ha lliurat automàticament."); }
}

function score(items) {
  let A = 0, E = 0, B = 0;
  items.forEach(it => { if (it.a === null) B++; else if (it.a === BYID[it.id].c) A++; else E++; });
  return { A, E, B };
}

function finish() {
  clearInterval(timerId); timerId = null;
  const { A, E, B } = score(quiz.items);
  quiz.done = true; quiz.end = Date.now();
  if (quiz.mode === "exam") {
    quiz.items.forEach(it => { if (it.a !== null) record(it.id, it.a === BYID[it.id].c); });
    const nota = Math.max(0, (A - E / 4) * EXAM.max / quiz.items.length);
    quiz.nota = nota;
    S.exams.push({ of: quiz.oficial || undefined, d: Date.now(), A, E, B, nota: Math.round(nota * 100) / 100, t: Math.round((quiz.end - quiz.start) / 1000) });
  }
  save(); saveQuiz();
  go("result");
}

function vResult() {
  const { A, E, B } = score(quiz.items), n = quiz.items.length, exam = quiz.mode === "exam";
  const head = exam
    ? `<div class="big">${fmt(quiz.nota)} <small>/ 22</small></div><span class="verdict ${quiz.nota >= EXAM.pass ? "pass" : "fail"}">${quiz.nota >= EXAM.pass ? "Aprovat" : "No arribes a l'11"}</span>
       <p class="muted small" style="margin:10px 0 0">Temps utilitzat: ${clock((quiz.end - quiz.start) / 1000)}. ${quiz.nota < EXAM.pass ? `Et faltarien ${Math.ceil((EXAM.pass * n / EXAM.max) - (A - E / 4))} encerts nets.` : ""}</p>`
    : `<div class="big">${pct(A, n)}<small>% d'encert</small></div>`;
  const wrong = quiz.items.map((it, k) => ({ it, k, q: BYID[it.id] })).filter(x => x.it.a !== x.q.c);
  const rev = wrong.map(({ it, k, q }) => `<div class="item"><p class="small muted">${exam ? "Pregunta " + (k + 1) + " · " : ""}${temaLabel(q.t)} · ${esc(q.s)}</p>
      <p><b>${esc(q.p)}</b></p>
      ${it.a !== null ? `<p class="ans-w">${esc(q.o[it.a])}</p>` : `<p class="muted">En blanc</p>`}
      <p class="ans-r">✓ ${esc(q.o[q.c])}</p>${q.e ? `<p class="small">${esc(q.e)}</p>` : ""}</div>`).join("");
  return `${bar("Resultat")}<main class="wrap">
    <div class="score">${head}
      <div class="tally"><div class="a"><b>${A}</b>encerts</div><div class="e"><b>${E}</b>errors</div><div><b>${B}</b>en blanc</div></div></div>
    ${exam ? `<details class="sheet"><summary>Full de respostes</summary><div class="grid">${quiz.items.map((x, k) => { const q = BYID[x.id]; return `<button data-review="${k}" class="${x.a === null ? "" : x.a === q.c ? "r" : "w"}">${k + 1}</button>`; }).join("")}</div></details>` : ""}
    <div class="actions">${quiz.oficial ? `<button class="btn" data-official="${quiz.oficial}">Repetir aquest examen</button>` : `<button class="btn" data-act="${exam ? "exam" : "again"}">${exam ? "Fer un altre simulacre" : "Repetir amb preguntes noves"}</button>`}
    ${S.err.length ? `<button class="btn ghost" data-act="errors">Repassar errors (${S.err.length})</button>` : ""}
    <button class="btn ghost" data-go="home">Inici</button></div>
    ${wrong.length ? `<h2>Preguntes a revisar (${wrong.length})</h2><div class="review">${rev}</div>` : `<p class="empty">Cap error. Molt bé!</p>`}
  </main>`;
}

function vStats() {
  const ids = Object.keys(S.q).filter(id => BYID[id]);
  let tot = 0, ok = 0; ids.forEach(id => { tot += S.q[id][0]; ok += S.q[id][1]; });
  const ex = S.exams;
  const best = ex.length ? Math.max(...ex.map(e => e.nota)) : null;
  const rows = DB.temes.map(t => { const st = topicStats(t.id); return `<button class="topic" data-practice="${t.id}">
     <span class="code">${t.id}</span><span class="name">${esc(t.nom)}</span>
     <span class="pct">${st.seen ? st.acc + "%" : "—"}<br><span class="small">${st.seen}/${st.n}</span></span>
     <span class="meter"><i style="width:${st.dom}%"></i></span></button>`; }).join("");
  const sorted = DB.temes.map(t => ({ t, st: topicStats(t.id) })).filter(x => x.st.seen >= 5).sort((a, b) => a.st.acc - b.st.acc).slice(0, 3);
  return `${bar("Estadístiques")}<main class="wrap">
    <div class="kpis">
      <div class="kpi"><b>${ids.length}</b><span>de ${DB.preguntes.length} preguntes vistes</span></div>
      <div class="kpi"><b>${tot ? pct(ok, tot) + "%" : "—"}</b><span>d'encert global</span></div>
      <div class="kpi"><b>${ex.length}</b><span>simulacres fets</span></div>
      <div class="kpi"><b>${best !== null ? fmt(best) : "—"}</b><span>millor nota (de 22)</span></div>
    </div>
    ${sorted.length ? `<div class="note"><b>Temes més fluixos:</b> ${sorted.map(x => `${x.t.id} (${x.st.acc}%)`).join(", ")}. Toca un tema de la llista per practicar-lo.</div>` : ""}
    ${ex.length ? `<h2>Evolució dels simulacres</h2>${chart(ex)}
    <table class="hist"><thead><tr><th>Data</th><th>Nota</th><th>A / E / B</th><th>Temps</th></tr></thead><tbody>
    ${ex.slice().reverse().slice(0, 15).map(e => `<tr><td>${new Date(e.d).toLocaleDateString("ca-ES", { day: "numeric", month: "short" })}${e.of ? `<br><span class="small muted">oficial ${e.of === "O20L" ? "2020 lliure" : "2020 PI"}</span>` : ""}</td><td class="${e.nota >= EXAM.pass ? "pass" : "fail"}">${fmt(e.nota)}</td><td>${e.A} / ${e.E} / ${e.B}</td><td>${clock(e.t)}</td></tr>`).join("")}</tbody></table>` : ""}
    <h2>Domini per tema</h2>
    <p class="muted small">Percentatge d'encert, preguntes vistes i barra de domini. Toca un tema per practicar-lo.</p>
    <div class="topics">${rows}</div>
    <h2>Les teves dades</h2>
    <p class="muted small">El progrés es desa en aquest navegador. Per passar-lo a un altre dispositiu, exporta'l aquí i importa'l allà.</p>
    <div class="actions"><button class="btn ghost" data-act="export">Exportar progrés</button><button class="btn ghost" data-act="import">Importar progrés</button><button class="btn ghost" data-act="reset">Esborrar-ho tot</button></div>
  </main>`;
}

function chart(ex) {
  const pts = ex.slice(-20), w = 320, h = 150, pad = 22;
  const x = i => pad + (pts.length < 2 ? (w - 2 * pad) / 2 : i * (w - 2 * pad) / (pts.length - 1));
  const y = v => h - pad - v / 22 * (h - 2 * pad);
  const line = pts.map((e, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(e.nota).toFixed(1)}`).join(" ");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Notes dels últims simulacres">
    <line x1="${pad}" x2="${w - pad}" y1="${y(11)}" y2="${y(11)}" stroke="var(--amber)" stroke-dasharray="4 4"/>
    <text x="${w - pad}" y="${y(11) - 5}" text-anchor="end" font-size="10" fill="var(--amber)">aprovat 11</text>
    <line x1="${pad}" x2="${w - pad}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>
    <text x="${pad - 4}" y="${y(22) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">22</text>
    <text x="${pad - 4}" y="${y(0) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">0</text>
    <path d="${line}" fill="none" stroke="var(--pine-2)" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map((e, i) => `<circle cx="${x(i)}" cy="${y(e.nota)}" r="3.5" fill="var(--pine-2)"><title>${fmt(e.nota)}</title></circle>`).join("")}
  </svg>`;
}

/* ---------------- Esdeveniments ---------------- */
function bind(root) {
  root.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  root.querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act));
  root.querySelectorAll("[data-topic]").forEach(b => b.onclick = () => {
    const t = b.dataset.topic, i = S.sel.indexOf(t);
    i < 0 ? S.sel.push(t) : S.sel.splice(i, 1); save(); render();
  });
  root.querySelectorAll("[data-all]").forEach(b => b.onclick = () => {
    const ts = DB.temes.filter(t => t.grup === b.dataset.all).map(t => t.id);
    const all = ts.every(t => S.sel.includes(t));
    S.sel = all ? S.sel.filter(t => !ts.includes(t)) : [...new Set([...S.sel, ...ts])]; save(); render();
  });
  root.querySelectorAll("[data-cfg] button").forEach(b => b.onclick = () => {
    const k = b.parentElement.dataset.cfg, v = b.dataset.v;
    S.cfg[k] = k === "n" && v !== "tot" ? +v : v; save(); render();
  });
  root.querySelectorAll("[data-official]").forEach(b => b.onclick = () => {
    if (loadQuiz() && !confirm("Tens un simulacre a mitges. Vols descartar-lo i començar aquest examen?")) return;
    startQuiz(buildOfficial(OF.find(x => x.id === b.dataset.official)));
  });
  root.querySelectorAll("[data-dif]").forEach(b => b.onclick = () => startQuiz(buildDif(+b.dataset.dif, S.cfg.n)));
  root.querySelectorAll("[data-practice]").forEach(b => b.onclick = () => startQuiz(buildPractice([b.dataset.practice], S.cfg.n, "tot")));
  root.querySelectorAll("[data-opt]").forEach(b => b.onclick = () => answer(+b.dataset.opt));
  root.querySelectorAll("[data-jump]").forEach(b => b.onclick = () => { quiz.i = +b.dataset.jump; saveQuiz(); render(); window.scrollTo(0, 0); });
  root.querySelectorAll("[data-review]").forEach(b => b.onclick = () => {
    const k = +b.dataset.review, it = quiz.items[k], q = BYID[it.id];
    alert(`Pregunta ${k + 1}\n\n${q.p}\n\nLa teva resposta: ${it.a === null ? "en blanc" : q.o[it.a]}\nCorrecta: ${q.o[q.c]}${q.e ? "\n\n" + q.e : ""}`);
  });
}

function answer(oi) {
  const it = quiz.items[quiz.i];
  if (quiz.mode === "exam") { it.a = it.a === oi ? null : oi; saveQuiz(); render(); return; }
  if (it.a !== null) return;
  it.a = oi; record(it.id, oi === BYID[it.id].c); save(); render();
  const ex = $(".explain"); if (ex) ex.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function act(a) {
  switch (a) {
    case "back":
      if (view.name === "quiz" && !quiz.done) {
        if (quiz.mode === "exam") { saveQuiz(); go("home"); return; }   // el simulacre es pot reprendre
        const n = quiz.items.filter(x => x.a !== null).length;
        if (n && !confirm("Vols sortir? Les respostes ja contestades queden desades a les estadístiques.")) return;
      }
      go(view.name === "result" || view.name === "quiz" ? (quiz && quiz.mode === "practice" ? (quiz.dif !== undefined ? "dif" : "temes") : "home") : "home"); break;
    case "exam":
      if (loadQuiz() && !confirm("Tens un simulacre a mitges. Vols descartar-lo i començar-ne un de nou?")) return;
      startQuiz(buildExam()); break;
    case "resume": quiz = loadQuiz(); go("quiz"); break;
    case "practice": startQuiz(buildPractice(S.sel, S.cfg.n, S.cfg.filtre)); break;
    case "again": if (quiz.dif !== undefined) { startQuiz(buildDif(quiz.dif, quiz.items.length)); break; } startQuiz(buildPractice([...new Set(quiz.items.map(x => BYID[x.id].t))], quiz.items.length, "tot")); break;
    case "errors": startQuiz(buildErrors()); break;
    case "next": quiz.i = Math.min(quiz.i + 1, quiz.items.length - 1); saveQuiz(); render(); window.scrollTo(0, 0); break;
    case "prev": quiz.i = Math.max(quiz.i - 1, 0); saveQuiz(); render(); window.scrollTo(0, 0); break;
    case "flag": quiz.items[quiz.i].flag = !quiz.items[quiz.i].flag; saveQuiz(); render(); break;
    case "clear": quiz.items[quiz.i].a = null; saveQuiz(); render(); break;
    case "finish": {
      if (quiz.mode === "exam") {
        const { B } = score(quiz.items), f = quiz.items.filter(x => x.flag).length;
        if (!confirm(`Vols lliurar l'examen?${B ? `\n${B} preguntes en blanc.` : ""}${f ? `\n${f} preguntes marcades.` : ""}`)) return;
      }
      finish(); break;
    }
    case "theme": {
      const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const nxt = cur === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = nxt; try { localStorage.setItem(KEY + "-theme", nxt); } catch (e) {} break;
    }
    case "export": {
      const blob = new Blob([JSON.stringify(S)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "progres-agents-rurals-" + new Date().toISOString().slice(0, 10) + ".json"; a.click(); break;
    }
    case "import": {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json,.json";
      inp.onchange = () => { const f = inp.files[0]; if (!f) return; f.text().then(t => {
        try { const d = JSON.parse(t); if (!d.q) throw 0; S = Object.assign(blank(), d); save(); alert("Progrés importat."); render(); }
        catch (e) { alert("Aquest fitxer no és una exportació de progrés vàlida."); } }); };
      inp.click(); break;
    }
    case "reset":
      if (confirm("S'esborraran totes les estadístiques, errors i simulacres d'aquest dispositiu. Vols continuar?")) { S = blank(); save(); try { localStorage.removeItem(KEY + "-exam"); } catch (e) {} render(); }
      break;
  }
}

/* Teclat: 1-4 o A-D per respondre, Enter / fletxes per avançar */
document.addEventListener("keydown", e => {
  if (view.name !== "quiz" || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase(), idx = "1234".indexOf(k) >= 0 ? "1234".indexOf(k) : "abcd".indexOf(k);
  const it = quiz.items[quiz.i];
  if (idx >= 0 && k.length === 1) { const btn = document.querySelectorAll(".opt")[idx]; if (btn && !btn.disabled) btn.click(); }
  else if ((k === "enter" || k === "arrowright") && (quiz.mode === "exam" || it.a !== null)) { const b = $('[data-act="next"]') || (k === "enter" && $('.qnav [data-act="finish"]')); if (b) { e.preventDefault(); b.click(); } }
  else if (k === "arrowleft" && quiz.mode === "exam") { const b = $('[data-act="prev"]'); if (b && !b.disabled) b.click(); }
});

/* ---------------- Inici ---------------- */
(function init() {
  try { const t = localStorage.getItem(KEY + "-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
  Promise.all([
    fetch("data/preguntes.json").then(r => r.json()),
    fetch("data/oficials.json").then(r => r.json()).catch(() => ({ examens: [] }))
  ]).then(([d, of]) => {
    DB = d; d.preguntes.forEach(q => BYID[q.id] = q);
    OF = of.examens || []; OF.forEach(ex => ex.preguntes.forEach(q => BYID[q.id] = q));
    if (!S.sel.length) S.sel = d.temes.map(t => t.id);
    render();
  }).catch(() => { $("#app").innerHTML = `<p class="loading">No s'han pogut carregar les preguntes. Comprova la connexió i torna-ho a provar.</p>`; });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
})();
