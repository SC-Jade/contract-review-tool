/* Headless smoke test: run the artifact page in jsdom with in-memory db / sample / mcp / user mocks. */
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const JSZip = require("jszip");

const html = fs.readFileSync(process.argv[2], "utf8");
const sampleDir = process.argv[3];

/* ---- in-memory db ---- */
function makeDb(){
  const store = new Map(); const listeners = new Set(); let auto = 0; const leases = new Map();
  const clone = o => JSON.parse(JSON.stringify(o));
  const segs = p => p.split("/");
  const isChild = (col, p) => { const a = segs(col), b = segs(p); return b.length === a.length + 1 && p.startsWith(col + "/"); };
  const snapDoc = (p) => ({ id: segs(p).at(-1), exists: store.has(p), data: () => store.has(p) ? clone(store.get(p)) : undefined, metadata: { fromCache:false, hasPendingWrites:false } });
  const notify = () => queueMicrotask(() => { for(const l of [...listeners]) l(); });
  const merge = (t, s) => { for(const k in s){ if(s[k] && typeof s[k] === "object" && !Array.isArray(s[k]) && t[k] && typeof t[k] === "object" && !Array.isArray(t[k])) merge(t[k], s[k]); else t[k] = clone(s[k]); } return t; };
  const size = o => Buffer.byteLength(JSON.stringify(o));
  let writes = 0;
  function doc(p){
    if(segs(p).length % 2) throw new TypeError("doc path needs even segments: " + p);
    return {
      id: segs(p).at(-1), path: p,
      get: async () => snapDoc(p),
      set: async d => { if(size(d) > 262144) throw { code:"invalid_argument", message:"too big " + size(d) }; writes++; store.set(p, clone(d)); notify(); },
      update: async d => { if(!store.has(p)) throw { code:"invalid_argument", message:"missing " + p }; writes++; store.set(p, merge(clone(store.get(p)), d)); if(size(store.get(p)) > 262144) throw { code:"invalid_argument" }; notify(); },
      delete: async () => { store.delete(p); notify(); },
      acquire: async ({ holder, ttlMs }) => { const l = leases.get(p); const now = Date.now(); if(l && l.exp > now && l.holder !== holder) return { acquired:false }; leases.set(p, { holder, exp: now + (ttlMs || 30000) }); return { acquired:true, holder }; },
      onSnapshot(next, err){ let last; const f = () => { const s = snapDoc(p); const j = JSON.stringify(s.data()); if(j !== last){ last = j; next(s); } }; listeners.add(f); queueMicrotask(f); return () => listeners.delete(f); },
      collection: sub => collection(p + "/" + sub)
    };
  }
  function query(col, filters = [], order = null){
    const run = () => {
      let docs = [...store.keys()].filter(k => isChild(col, k)).map(snapDoc);
      for(const [f, op, v] of filters) docs = docs.filter(d => { const x = d.data()[f]; return op === "==" ? x === v : true; });
      if(order) docs.sort((a, b) => { const x = a.data()[order[0]], y = b.data()[order[0]]; const r = x < y ? -1 : x > y ? 1 : 0; return order[1] === "desc" ? -r : r; });
      else docs.sort((a, b) => a.id < b.id ? -1 : 1);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata:{} };
    };
    return {
      where: (f, op, v) => query(col, [...filters, [f, op, v]], order),
      orderBy: (f, d) => query(col, filters, [f, d || "asc"]),
      limit: () => query(col, filters, order),
      get: async () => run(),
      onSnapshot(next){ let last; const f = () => { const s = run(); const j = JSON.stringify(s.docs.map(d => [d.id, d.data()])); if(j !== last){ last = j; next(s); } }; listeners.add(f); queueMicrotask(f); return () => listeners.delete(f); }
    };
  }
  function collection(p){
    if(segs(p).length % 2 === 0) throw new TypeError("collection path needs odd segments: " + p);
    return Object.assign(query(p), { path: p, doc: id => doc(p + "/" + (id || "auto" + (++auto))), add: async d => { const r = doc(p + "/auto" + (++auto)); await r.set(d); return r; } });
  }
  return { api: { doc, collection }, store, stats: () => ({ writes, docs: store.size }) };
}

/* ---- sample mock ---- */
const calls = { tr: 0, history: 0, check: 0, copies: 0 };
const sample = {
  json: async (prompt, opts) => {
    await new Promise(r => setTimeout(r, 1));
    if(Buffer.byteLength(prompt) > 262144) throw { code: "prompt_too_large" };
    if(globalThis.__company && !prompt.startsWith("너는 영문") && !prompt.includes(globalThis.__company)) throw new Error("prompt without company name");
    if(prompt.startsWith("너는 영문 광고 계약서를")){
      calls.tr++;
      const arr = JSON.parse(prompt.slice(prompt.lastIndexOf("입력:\n") + 4));
      const out = {}; for(const x of arr) out[x.i] = "[번역] " + x.t.slice(0, 24); return out;
    }
    if(prompt.includes('"threads"')){
      calls.history++;
      const seg = prompt.slice(prompt.lastIndexOf("[이번 라운드 변경] v"));
      const items = JSON.parse(seg.split("\n")[1]);
      const comments = JSON.parse(prompt.slice(prompt.lastIndexOf("[문서 코멘트]\n") + "[문서 코멘트]\n".length));
      const byCl = {}; for(const c of comments) (byCl[c.cl] = byCl[c.cl] || []).push(c.id);
      return { items: items.map(x => ({ idx: x.idx, clause: x.cl + " 테스트 조항", ko: "요약 " + x.cl, v: ["good","warn","bad","info"][x.idx % 4] })),
        comments: comments.map((c, i) => ({ id: c.id, ko: "번역된 코멘트 " + i, internal: /[一-鿿]/.test(c.text), note: /[一-鿿]/.test(c.text) ? "내부 메모" : "" })),
        threads: Object.entries(byCl).map(([cl, ids]) => ({ clause: cl, title: cl + " 쟁점", context: "맥락", commentIds: ids, steps: [{ to: 2, what: "v2 단계" }, { to: 3, what: "v3 단계" }], v: "warn", verdict: "판정", suggest: "제안" })) };
    }
    if(prompt.includes('"check"')){
      calls.check++;
      return { check: [{ g:"정산", k:"여신일", std:"Net 30", now:"15일", v:"good", ref:["5(a)(v)","없는라벨"] }, { g:"책임", k:"로고", std:"사전 동의", now:"동의 없음", v:"bad", ref:["12(g)"] }, { g:"기준표 밖 · AI 판단", k:"임의해지", std:"–", now:"없음", v:"bad", ref:["8(b)"] }],
        meta: { title:"Advertising Inventory Agreement", legalName:"Example Pte. Ltd.", effectiveDate:"" } };
    }
    if(prompt.includes("'파트너 DB'의 업체 속성값")){
      calls.partner = (calls.partner || 0) + 1;
      /* 설정 파일의 PARTNER_FIELDS에 맞춰 일부러 섞은 값: 선택지 대소문자 차이, 없는 선택지, 100 기준 비율 */
      const props = {};
      for(const f of globalThis.__fields || []){
        if(f.t === "multi") props[f.k] = [f.opts[0], "없는값"];
        else if(f.t === "select") props[f.k] = f.def ? "" : (f.k.length % 2 ? "엉뚱한값" : f.opts.at(-1).toLowerCase());
        else if(f.t === "pct") props[f.k] = 85;
        else if(f.t === "text") props[f.k] = "$100 미만 이월";
      }
      return { props, notes: ["임의해지 30일 통지"], payNotes: ["지급 보류 60일 | 상계 가능", "통화 USD"] };
    }
    if(prompt.includes('"lexusRequest"')){
      calls.copies++;
      return { lexusRequest:"계약명 : X\n계약상대방 : ⟦확인 필요⟧", lexusComment:"회신 공유", flex:"문서 이름 : 기타 계약 품의서_Acme Ads\n계약 논의 링크 : ⟦노션 링크⟧",
        notion:[{ h:"기본 정보", rows:[["상대 법인","Example | Pte"]] }, { h:"정산", rows:[["여신일","15일"]] }, { h:"리스크 · 책임", rows:[["로고","동의 없음"]] }] };
    }
    throw { code: "invalid_request", message: "unknown prompt" };
  },
  limits: async () => ({ maxPromptBytes: 262144 })
};
let notionCalls = [], searchHit = null;
const mcp = { callTool: async (server, tool, input) => {
  notionCalls.push({ server, tool, input });
  if(tool === "notion-search") return { content: [], payload: { results: searchHit ? [searchHit] : [{ type: "page", title: "Other Co", url: "https://app.notion.com/p/zzz?pvs=204" }], type: "workspace_search" } };
  if(tool === "notion-update-page") return { content: [], payload: { page_id: input.page_id } };
  const isPartner = input.parent.data_source_id === globalThis.__partnerDs;
  return { content: [], payload: { pages: [{ id: "x", url: isPartner ? "https://app.notion.com/p/partner111?pvs=204" : "https://app.notion.com/p/abc123def" }] } };
} };
const user = { me: async () => ({ id: "u_me", name: "제이드", avatarUrl: "data:,", color: "#000", email: null, isOwner: true, canEdit: true }), can: async () => true, profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: i === "u_me" ? "제이드" : "", avatarUrl: "data:,", color: "#000", email: null, isMe: i === "u_me", guest: false }])), id: async () => "u_me" };

(async () => {
  const DB = makeDb();
  const errors = [];
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.test/", beforeParse(w){
    w.JSZip = JSZip; w.TextEncoder = TextEncoder;
    w.claude = { use: async n => ({ db: DB.api, sample, mcp, user })[n] || null };
    w.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){} });
    w.HTMLElement.prototype.scrollIntoView = function(){};
    w.navigator.clipboard = { writeText: async () => {} };
    w.addEventListener("error", e => errors.push("error: " + (e.error && e.error.stack || e.message)));
    w.addEventListener("unhandledrejection", e => errors.push("rejection: " + JSON.stringify(e.reason) + (e.reason && e.reason.stack || "")));
  }});
  const w = dom.window, d = w.document;
  const vcon = []; w.console.error = (...a) => vcon.push(a.join(" "));
  const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, label, ms = 20000) => { const t0 = Date.now(); while(Date.now() - t0 < ms){ try{ if(fn()) return; }catch(_){} await tick(25); } throw new Error("timeout: " + label); };
  await tick(100);
  const S = () => w.eval("S");
  globalThis.__partnerDs = w.eval("PARTNER_DS"); globalThis.__fields = w.eval("PARTNER_FIELDS"); globalThis.__company = w.eval("COMPANY.ko");
  const textField = globalThis.__fields.filter(f => f.t === "text").at(-1).k;
  console.log("list placeholder:", d.querySelector("#deal-list").textContent.trim().slice(0, 40));

  /* create deal */
  d.querySelector("#new-deal").click(); await tick();
  d.querySelector("#nd-partner").value = "Acme Ads"; d.querySelector("#nd-title").value = "Publisher Placement Agreement";
  d.querySelector('[data-act="nd-save"]').click();
  await waitFor(() => S().deal && d.querySelector("#drop"), "deal opened + upload modal");
  console.log("deal:", S().deal.partner, "hash:", w.location.hash);

  const files = fs.readdirSync(sampleDir).filter(f => f.endsWith(".docx")).sort();
  for(let i = 0; i < files.length; i++){
    if(i > 0){ d.querySelector("#upload-version").click(); await tick(); }
    const buf = fs.readFileSync(path.join(sampleDir, files[i]));
    const fileLike = { name: files[i], arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    await w.handleFile(fileLike);
    await waitFor(() => !d.querySelector("#up-save").disabled, "parsed " + i);
    if(i === 0){ /* mark our authors on first file that has them is v2; v1 has none */ }
    if(i === 1){ /* OUR_AUTHORS=이름1,이름2 로 우리 쪽 작성자를 지정할 수 있어요 */
      for(const a of (process.env.OUR_AUTHORS || "").split(",").map(x => x.trim()).filter(Boolean)) { const b = d.querySelector(`[data-author-seg="${a}"] [data-s="us"]`); if(b) b.click(); }
    }
    const side = S().ui.up.side;
    d.querySelector("#up-save").click();
    await waitFor(() => { const v = S().versions.find(x => x.n === i + 1); return v && v.status && (v.status.stage === "done" || v.status.stage === "error"); }, "pipeline v" + (i + 1), 60000);
    const v = S().versions.find(x => x.n === i + 1);
    console.log(`v${i + 1}: side=${side} stage=${v.status.stage} ${v.status.error || ""} comments=${v.comments.length} chunks=${v.chunks}`);
  }
  if(process.argv[4]){
    d.querySelector("#upload-version").click(); await tick();
    w.pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js"); globalThis.pdfjsWorker = require("pdfjs-dist/legacy/build/pdf.worker.js");
    const buf = fs.readFileSync(process.argv[4]);
    await w.handleFile({ name: "6. partner-markup.pdf", arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
    await waitFor(() => !d.querySelector("#up-save").disabled || d.querySelector("#up-result .notice"), "parsed pdf", 30000);
    console.log("pdf parsed:", d.querySelector("#up-result").textContent.replace(/\s+/g, " ").trim().slice(0, 220));
    d.querySelector("#up-save").click();
    await waitFor(() => { const v = S().versions.find(x => x.n === 6); return v && v.status && /done|error/.test(v.status.stage); }, "pipeline v6", 60000);
    const v6 = S().versions.find(x => x.n === 6);
    console.log("v6:", v6.kind, v6.side, v6.status.stage, v6.status.error || "", "comments:", v6.comments.map(c => c.cl).join(","), "diff items:", (await (async () => { await tick(300); return (S().history[6] || []).length; })()));
  }
  await tick(200);
  console.log("ai calls:", JSON.stringify(calls), "db:", JSON.stringify(DB.stats()));

  /* tabs */
  for(const t of ["t-check","t-rounds","t-comments","t-copy","t-notion"]){
    d.getElementById(t).click(); await tick(50);
    const p = d.getElementById(d.getElementById(t).getAttribute("aria-controls"));
    const vis = [...d.querySelectorAll('[role="tabpanel"]')].filter(x => !x.hidden).map(x => x.id);
    console.log(t, "visible:", vis.join(","), "| text:", p.textContent.replace(/\s+/g, " ").trim().slice(0, 140));
  }
  d.getElementById("t-check").click(); await tick(30);
  console.log("check rows:", d.querySelectorAll("#p-check tbody tr").length, "refs:", d.querySelectorAll("#p-check .ref[data-ref]").length, "doc rows:", d.querySelectorAll("#fulldoc .drow").length, "pending ko:", d.querySelectorAll("#fulldoc .ko.pending").length);
  d.querySelector('#p-check [data-filter] [data-v="bad"]').click(); await tick(30);
  console.log("bad filter rows:", [...d.querySelectorAll("#p-check tbody tr:not(.group)")].length);
  d.querySelector('#p-check .ref[data-ref]').click(); await tick(30);
  console.log("jump hit:", d.querySelectorAll(".drow.hit").length);
  d.getElementById("t-rounds").click(); await tick(30);
  console.log("round buttons:", d.querySelectorAll("#p-rounds [data-round]").length, "changes shown:", d.querySelectorAll("#p-rounds .change").length);
  d.querySelector('#p-rounds [data-round="2"]').click(); await tick(30);
  console.log("round v2 changes:", d.querySelectorAll("#p-rounds .change").length, "ko:", d.querySelectorAll("#p-rounds .kotr").length);
  d.getElementById("t-comments").click(); await tick(30);
  console.log("threads:", d.querySelectorAll(".thread").length, "flagged:", d.querySelectorAll(".comment.flag").length, "steps:", d.querySelectorAll(".step").length, "steps w/ compare:", d.querySelectorAll(".step .cmp").length);
  console.log("verdict label:", [...d.querySelectorAll(".thread .label")].map(e => e.textContent).find(t => t.startsWith("결과 판정")));
  d.getElementById("t-copy").click(); await tick(30);
  console.log("copy cards:", d.querySelectorAll(".copy").length, "holes:", d.querySelectorAll(".copy .hole").length);
  d.querySelector("[data-copy]").click(); await tick(30);
  const before = calls.copies; d.querySelector('[data-act="regen-copies"]').click();
  await tick(1200); d.querySelector('[data-act="regen-copies"]')?.click(); await waitFor(() => calls.copies > before && S().versions.at(-1).status.stage === "done", "regen copies");
  await tick(1500); await waitFor(() => w.eval("S.running.size") === 0, "regen settled");
  console.log("regen copies only:", JSON.stringify(calls));
  d.getElementById("t-notion").click(); await tick(30);
  console.log("partner form fields:", d.querySelectorAll("#pdb-form [data-pf]").length, "| partner prompts:", calls.partner);
  const pf = k => [...d.querySelectorAll("#pdb-form [data-pf]")].find(e => e.dataset.pf === k);
  console.log("cleaned:", globalThis.__fields.filter(f => f.t !== "multi").map(f => f.k + "=" + pf(f.k).value).join(" | "), "| multi checked:", [...d.querySelectorAll('#pdb-form input[type=checkbox]:checked')].map(e => e.value).join(","));
  pf(textField).value = "월 매출 $50K 이상 3%"; pf(textField).dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick(80);
  const an = [...DB.store.entries()].filter(([k]) => k.endsWith("/parts/analysis")).map(([, v]) => v).find(v => v.partnerDb?.editedAt);
  console.log("form edit saved:", an?.partnerDb?.props?.[textField], "| field still in DOM:", d.contains(pf(textField)));
  d.querySelector('[data-act="notion-create"]').click();
  await waitFor(() => S().deal.notionUrl && S().deal.partnerUrl, "notion urls saved");
  console.log("notion calls:", notionCalls.map(c => c.tool + (c.input.parent ? (c.input.parent.data_source_id === globalThis.__partnerDs ? ":partner" : ":contract") : "")).join(" → "));
  const pc = notionCalls.find(c => c.tool === "notion-create-pages" && c.input.parent.data_source_id === globalThis.__partnerDs).input.pages[0];
  const cc = notionCalls.filter(c => c.tool === "notion-create-pages").at(-1).input.pages[0];
  console.log("partner props:", JSON.stringify(pc.properties));
  console.log("partner md:", pc.content.split("\n").filter(Boolean).slice(1, 8).join(" / "));
  console.log("contract props:", JSON.stringify(cc.properties), "| urls:", S().deal.partnerUrl, S().deal.notionUrl);
  console.log("notion md head:", cc.content.split("\n").slice(0, 8).join(" / "));
  console.log("bar:", d.querySelector("#p-notion .nbar").textContent.replace(/\s+/g, " ").trim());
  /* existing partner: contract page exists, partner page missing → link to the existing one */
  await DB.api.doc("deals/" + S().dealId).update({ partnerUrl: "" }); await tick(80);
  searchHit = { type: "page", title: "acme ads", url: "https://app.notion.com/p/exist999?pvs=204", parent_data_source_url: "collection://" + globalThis.__partnerDs };
  notionCalls = [];
  d.querySelector('[data-act="notion-create"]').click();
  await waitFor(() => d.querySelector('[data-act="notion-link"]'), "link confirm");
  console.log("confirm:", d.querySelector("#notion-confirm").textContent.replace(/\s+/g, " ").trim().slice(0, 60));
  d.querySelector('[data-act="notion-link"]').click();
  await waitFor(() => S().deal.partnerUrl, "linked");
  console.log("link calls:", notionCalls.map(c => c.tool).join(" → "), "| update:", JSON.stringify(notionCalls.at(-1).input), "| partnerUrl:", S().deal.partnerUrl);
  d.getElementById("t-copy").click(); await tick(50);
  console.log("flex has notion url:", d.querySelector("#p-copy").textContent.includes("abc123def"));
  /* version select, criteria, delete flow */
  d.querySelector('[data-ver="1"]').click(); await tick(100);
  d.getElementById("t-check").click(); await tick(30);
  console.log("v1 selected:", S().selN, "doc rows:", d.querySelectorAll("#fulldoc .drow").length);
  d.querySelector("#open-criteria").click(); await tick(30);
  console.log("criteria rows:", d.querySelectorAll("#modal tr[data-ci]").length);
  d.querySelector('[data-act="crit-add"]').click(); await tick(10);
  d.querySelector('[data-act="crit-save"]').click(); await tick(100);
  console.log("criteria saved:", DB.store.has("config/criteria"), "modal hidden:", d.querySelector("#modal").hidden);
  d.querySelector("#go-home").click(); await tick(100);
  console.log("list rows:", d.querySelectorAll(".deal-row").length, "| row:", d.querySelector(".deal-row")?.textContent.replace(/\s+/g, " ").trim());
  console.log("\nerrors:", errors.length ? errors.join("\n") : "none");
  console.log("console.error:", vcon.length ? vcon.slice(0, 5).join("\n") : "none");
  process.exit(0);
})().catch(e => { console.error("TEST FAIL", e); process.exit(1); });
