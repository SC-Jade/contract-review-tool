/* ===== 계약서 파싱 · 비교 (브라우저와 Node 테스트 공용) ===== */
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function kids(el, name){ const out = []; for(let c = el.firstChild; c; c = c.nextSibling) if(c.nodeType === 1 && c.localName === name) out.push(c); return out; }
function kid(el, name){ for(let c = el && el.firstChild; c; c = c.nextSibling) if(c.nodeType === 1 && c.localName === name) return c; return null; }
function wattr(el, name){ return el ? (el.getAttributeNS(W_NS, name) || el.getAttribute("w:" + name)) : null; }
function all(el, name){ return Array.from(el.getElementsByTagNameNS(W_NS, name)); }

const ROMAN = n => { const t=[[1000,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],[50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]]; let s=""; for(const [v,r] of t) while(n>=v){ s+=r; n-=v; } return s; };
const LETTER = n => { let s=""; while(n>0){ n--; s = String.fromCharCode(97 + n % 26) + s; n = Math.floor(n/26); } return s; };
function fmtNum(n, fmt){
  switch(fmt){
    case "lowerLetter": return LETTER(n);
    case "upperLetter": return LETTER(n).toUpperCase();
    case "lowerRoman": return ROMAN(n);
    case "upperRoman": return ROMAN(n).toUpperCase();
    case "none": case "bullet": return "";
    default: return String(n);
  }
}

/* text of a paragraph: mode "cur" drops deletions, "orig" drops insertions */
function runText(el, mode){
  let s = "";
  for(let c = el.firstChild; c; c = c.nextSibling){
    if(c.nodeType !== 1) continue;
    const n = c.localName;
    if(n === "pPr" || n === "rPr") continue;
    if((n === "del" || n === "moveFrom") && mode === "cur") continue;
    if((n === "ins" || n === "moveTo") && mode === "orig") continue;
    if(n === "t" || (n === "delText" && mode === "orig")) s += c.textContent;
    else if(n === "tab" || n === "br" || n === "cr") s += " ";
    else if(n === "noBreakHyphen") s += "-";
    else s += runText(c, mode);
  }
  return s;
}

/* numbering.xml + styles.xml → paragraph label resolver */
function makeNumbering(numDoc, styleDoc){
  const abstracts = {}, nums = {}, styles = {};
  if(numDoc){
    for(const a of all(numDoc, "abstractNum")){
      const lv = {};
      for(const l of kids(a, "lvl")) lv[wattr(l,"ilvl")] = { fmt: wattr(kid(l,"numFmt"),"val") || "decimal", text: wattr(kid(l,"lvlText"),"val") ?? "", start: +(wattr(kid(l,"start"),"val") || 1) };
      const link = wattr(kid(a, "numStyleLink"), "val");
      abstracts[wattr(a,"abstractNumId")] = { lv, link };
    }
    for(const n of all(numDoc, "num")){
      const ov = {};
      for(const o of kids(n, "lvlOverride")){ const so = kid(o, "startOverride"); if(so) ov[wattr(o,"ilvl")] = +wattr(so,"val"); }
      nums[wattr(n,"numId")] = { abs: wattr(kid(n,"abstractNumId"),"val"), ov };
    }
  }
  if(styleDoc){
    for(const s of all(styleDoc, "style")){
      const ppr = kid(s, "pPr"), np = ppr && kid(ppr, "numPr");
      styles[wattr(s,"styleId")] = { based: wattr(kid(s,"basedOn"),"val"), numId: np ? wattr(kid(np,"numId"),"val") : null, ilvl: np ? wattr(kid(np,"ilvl"),"val") : null };
    }
  }
  const counters = {}, seenNum = {}, used = {};
  function styleNum(id, depth = 0){
    const s = styles[id]; if(!s || depth > 10) return null;
    if(s.numId) return { numId: s.numId, ilvl: s.ilvl ?? "0" };
    return s.based ? styleNum(s.based, depth + 1) : null;
  }
  return function label(p){
    const ppr = kid(p, "pPr"); let numId = null, ilvl = null;
    const np = ppr && kid(ppr, "numPr");
    if(np){ numId = wattr(kid(np,"numId"),"val"); ilvl = wattr(kid(np,"ilvl"),"val"); }
    const sid = ppr && wattr(kid(ppr,"pStyle"),"val");
    if(numId == null || ilvl == null){
      const sn = sid ? styleNum(sid) : null;
      if(sn){ if(numId == null) numId = sn.numId; if(ilvl == null) ilvl = sn.ilvl; }
    }
    if(!numId || numId === "0") return null;
    const num = nums[numId]; if(!num) return null;
    const abs = abstracts[num.abs]; if(!abs) return null;
    const L = +(ilvl || 0), key = num.abs;
    const cnt = counters[key] || (counters[key] = {});
    if(!seenNum[numId]){ seenNum[numId] = true; for(const k in num.ov) cnt[k] = num.ov[k] - 1; }
    const lvdef = abs.lv[L] || { fmt:"decimal", text:"", start:1 };
    cnt[L] = (cnt[L] ?? (lvdef.start - 1)) + 1;
    for(const k in cnt) if(+k > L) delete cnt[k];
    const u = used[key] || (used[key] = {});
    for(const k in u) if(+k > L) delete u[k];
    if(lvdef.fmt === "none" || lvdef.fmt === "bullet" || !lvdef.text) return null;
    u[L] = true;
    const render = lv => (abs.lv[lv]?.text ?? "").replace(/%(\d)/g, (_, d) => { const i = +d - 1; const def = abs.lv[i] || {start:1,fmt:"decimal"}; return fmtNum(cnt[i] ?? def.start, def.fmt); });
    /* hierarchical label: a level whose text already cites parent levels (e.g. "1.%2") stands alone,
       otherwise prepend the parent chain ("5" + "(c)" + "(i)") */
    const parts = []; let full = false;
    for(let lv = L; lv >= 0; lv--){
      if(lv < L && !u[lv]) continue;
      const t = abs.lv[lv]?.text ?? ""; if(!t || abs.lv[lv].fmt === "none") continue;
      parts.unshift(render(lv).replace(/\.$/, ""));
      const refs = (t.match(/%(\d)/g) || []).map(x => +x.slice(1) - 1);
      if(lv === 0 || refs.some(r => r < lv) || !/^[(\[]/.test(t)) { full = true; break; }
    }
    return { label: parts.join(""), ilvl: L, fmt: lvdef.fmt, full };
  };
}

const SCHEDULE_RE = /^(schedule|annex|exhibit|appendix|attachment|addendum)\s*([0-9a-z]+)?\b/i;

/* .docx → {kind, paras, changes, comments, authors} */
async function parseDocx(zip, DOMParserImpl){
  const read = async name => { const f = zip.file(name); return f ? new DOMParserImpl().parseFromString(await f.async("string"), "application/xml") : null; };
  const doc = await read("word/document.xml");
  if(!doc) throw new Error("word/document.xml이 없는 파일이에요");
  const label = makeNumbering(await read("word/numbering.xml"), await read("word/styles.xml"));
  const body = all(doc, "body")[0];
  const paras = [], changes = [], commentAnchor = {};
  let schedule = "", topSchedule = "", ctx = "";
  const outline = [];                       /* last label per depth: 0 = section, 1 = letter, 2 = roman, 3 = (1) */
  const depthOf = (lab, fmt) => !/^[(\[]/.test(lab) ? 0 : /letter/i.test(fmt) ? 1 : /roman/i.test(fmt) ? 2 : 3;
  const usedLabels = {};
  for(const p of all(body, "p")){
    const cur = runText(p, "cur").replace(/\s+/g, " ").trim();
    const orig = runText(p, "orig").replace(/\s+/g, " ").trim();
    const pr = kid(kid(p, "pPr"), "rPr");
    if(pr && kid(pr, "del") && !cur) continue;
    for(const cs of all(p, "commentRangeStart")) commentAnchor[wattr(cs,"id")] = paras.length;
    const pAuthors = new Set();
    for(const tag of ["ins","del"]) for(const c of all(p, tag)){
      if(c.parentNode && c.parentNode.localName === "rPr") continue;
      const txt = (tag === "ins" ? runText(c, "cur") : runText(c, "orig")).trim();
      const a = wattr(c, "author") || "?";
      pAuthors.add(a);
      if(txt) changes.push({ a, t: tag, d: (wattr(c,"date") || "").slice(0,10), x: txt.slice(0, 160) });
    }
    const num = label(p);
    if(!cur && !orig) continue;
    const m = cur.match(SCHEDULE_RE);
    if(m && cur.length < 120 && !num){
      const id = m[2] ? m[2].toUpperCase() : "";
      const nested = topSchedule && (/\bto the\b/i.test(cur) || !/^schedule/i.test(m[1]));
      if(nested) schedule = topSchedule + "부속" + id + " ";
      else { topSchedule = "별첨" + id + " "; schedule = topSchedule; }
      outline.length = 0;
    }
    let raw = num && num.label ? num.label : null, fmt = num ? num.fmt : "decimal", full = num ? num.full : true;
    if(!raw){ const t = cur.match(/^(\d{1,2}(?:\.\d{1,2})*)\.\s+\S/) || cur.match(/^(\d{1,2}\.\d{1,2})\s+[A-Z]/); if(t && cur.length > 20 && !m) raw = t[1]; }
    let lab = null;
    if(raw){
      const d = depthOf(raw, fmt);
      if(!full || d > 0){
        const parent = [...outline.slice(0, d)].reverse().find(Boolean);
        if(!full && parent && !raw.startsWith(parent)) raw = parent + raw;
      }
      outline[d] = raw; outline.length = d + 1;
      lab = schedule + raw;
      if(usedLabels[lab]) lab = lab + "#" + (++usedLabels[lab]); else usedLabels[lab] = 1;
    }
    if(lab) ctx = lab;
    const isHead = (num && num.ilvl === 0 && cur.length < 90 && cur === cur.toUpperCase()) || (!num && m && cur.length < 120);
    paras.push({ l: lab, c: ctx || null, h: isHead ? 1 : 0, en: cur, o: orig !== cur ? orig : undefined, au: pAuthors.size ? [...pAuthors] : undefined });
  }
  const comments = [];
  const cdoc = await read("word/comments.xml");
  if(cdoc) for(const c of all(cdoc, "comment")){
    const id = wattr(c, "id");
    const text = all(c, "p").map(p => runText(p, "cur")).join("\n").trim();
    const pi = commentAnchor[id];
    comments.push({ id: commentKey(wattr(c,"author"), (wattr(c,"date") || "").slice(0,10), text), wid: id, a: wattr(c,"author") || "?", d: (wattr(c,"date") || "").slice(0,10), x: text, p: pi ?? null, cl: pi != null ? (paras[pi]?.c || null) : null, an: pi != null ? paras[pi].en.slice(0, 300) : "" });
  }
  const authors = {};
  for(const ch of changes) authors[ch.a] = (authors[ch.a] || 0) + 1;
  for(const c of comments) authors[c.a] = (authors[c.a] || 0) + 1;
  return { kind: "docx", paras, changes, comments, authors };
}

/* comments keep no stable id across saves (Word renumbers them), so key on author + date + text */
function commentKey(a, d, x){ let h = 2166136261; const s = (a||"") + "|" + (d||"") + "|" + (x||""); for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return "k" + (h >>> 0).toString(36); }

/* paragraph-level LCS diff between two versions → changed items */
const normText = s => String(s || "").replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/(\w)- (\w)/g, "$1$2").replace(/\s+/g, " ").trim().toLowerCase();
function diffParas(A, B){
  const a = A.map(p => normText(p.en)), b = B.map(p => normText(p.en)), n = a.length, m = b.length;
  const dp = Array.from({length: n + 1}, () => new Uint16Array(m + 1));
  for(let i = n - 1; i >= 0; i--) for(let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i+1][j+1] + 1 : Math.max(dp[i+1][j], dp[i][j+1]);
  const ops = []; let i = 0, j = 0;
  while(i < n && j < m){
    if(a[i] === b[j]){ ops.push(["=", i, j]); i++; j++; }
    else if(dp[i+1][j] >= dp[i][j+1]) ops.push(["-", i++, -1]);
    else ops.push(["+", -1, j++]);
  }
  while(i < n) ops.push(["-", i++, -1]);
  while(j < m) ops.push(["+", -1, j++]);
  /* pair adjacent deletions/insertions positionally (like a replace block) */
  const items = []; let k = 0;
  while(k < ops.length){
    if(ops[k][0] === "="){ k++; continue; }
    const dels = [], adds = [];
    while(k < ops.length && ops[k][0] !== "="){ (ops[k][0] === "-" ? dels : adds).push(ops[k]); k++; }
    const len = Math.max(dels.length, adds.length);
    for(let q = 0; q < len; q++){
      const oi = dels[q]?.[1] ?? -1, ni = adds[q]?.[2] ?? -1;
      const src = ni >= 0 ? B[ni] : A[oi];
      items.push({ cl: src.l || src.c || "전문", old: oi >= 0 ? A[oi].en : "", new: ni >= 0 ? B[ni].en : "", ni, oi });
    }
  }
  return items;
}

/* new tracked-change authors in this version compared to the previous one */
function newChangeAuthors(prevChanges, curChanges){
  const seen = new Map();
  for(const c of prevChanges || []){ const k = c.a + c.t + c.x; seen.set(k, (seen.get(k) || 0) + 1); }
  const out = {};
  for(const c of curChanges || []){
    const k = c.a + c.t + c.x, s = seen.get(k) || 0;
    if(s > 0) seen.set(k, s - 1); else out[c.a] = (out[c.a] || 0) + 1;
  }
  return out;
}


/* ===== PDF: text lines → paragraphs, annotations → comments ===== */
const ROMANS = new Set(["i","ii","iii","iv","v","vi","vii","viii","ix","x","xi","xii","xiii","xiv","xv"]);
function pdfDate(d){ const m = String(d || "").match(/(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; }

async function parsePdf(pdfjsLib, data){
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const lines = [], notes = [];
  for(let pn = 1; pn <= pdf.numPages; pn++){
    const page = await pdf.getPage(pn);
    const tc = await page.getTextContent();
    const rows = [];
    for(const it of tc.items){
      if(!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
      let row = rows.find(r => Math.abs(r.y - y) < Math.max(2, h * 0.3));
      if(!row){ row = { y, h, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width || 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for(const r of rows){
      r.items.sort((a, b) => a.x - b.x);
      let text = "", end = null;
      for(const it of r.items){ if(end !== null && it.x - end > r.h * 0.15 && !text.endsWith(" ")) text += " "; text += it.s; end = it.x + it.w; }
      lines.push({ pn, y: r.y, h: r.h, x0: r.items[0].x, x1: end, text: text.replace(/\s+/g, " ").trim() });
    }
    for(const a of await page.getAnnotations()){
      if(["Link","Popup","Widget"].includes(a.subtype)) continue;
      const x = (a.contentsObj && a.contentsObj.str) || a.contents || "";
      if(!x.trim() && !["Highlight","StrikeOut","Underline","Squiggly","Caret"].includes(a.subtype)) continue;
      notes.push({ pn, rect: a.rect, quad: a.quadPoints, sub: a.subtype, a: (a.titleObj && a.titleObj.str) || a.title || "?", d: pdfDate(a.modificationDate || a.creationDate), x: x.trim(), reply: a.inReplyTo || null, aid: a.id });
    }
  }
  /* lines → paragraphs */
  const MARK = /^(\d{1,2}(?:\.\d{1,2})*\.\s|\d{1,2}\.\d{1,2}\s|\([a-z]{1,4}\)|\(\d{1,2}\)|[A-Z][A-Z ,;&'-]{3,}$)/;
  const widths = lines.map(l => l.x1 - l.x0).sort((a, b) => a - b);
  const full = widths[Math.floor(widths.length * 0.8)] || 400;
  const groups = []; let g = null;
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const gap = prev && prev.pn === l.pn ? prev.y - l.y : 0;
    const brk = !g || MARK.test(l.text) || (prev.pn === l.pn && gap > Math.max(l.h, prev.h) * 1.5)
      || (prev.x1 - prev.x0 < full * 0.75 && /[.;:]$/.test(prev.text))
      || (prev.pn !== l.pn && /[.;:]$/.test(prev.text) && !/^[a-z]/.test(l.text));
    if(brk){ g = { lines: [] }; groups.push(g); }
    g.lines.push(l);
  });
  const paras = []; const outline = []; let schedule = "", topSchedule = "", ctx = "";
  const used = {};
  for(const gr of groups){
    const en = gr.lines.map(l => l.text).join(" ").replace(/\s+/g, " ").trim();
    if(!en || /^\d{1,3}$/.test(en) || /^page \d+/i.test(en)) { gr.skip = true; continue; }
    const sm = en.match(SCHEDULE_RE);
    if(sm && en.length < 120){
      const id = sm[2] ? sm[2].toUpperCase() : "";
      const nested = topSchedule && (/\bto the\b/i.test(en) || !/^schedule/i.test(sm[1]));
      if(nested) schedule = topSchedule + "부속" + id + " "; else { topSchedule = "별첨" + id + " "; schedule = topSchedule; }
      outline.length = 0;
    }
    /* leading markers: "5." / "5.1" / "(c)" / "(iv)" / "(b)(iv)" */
    let rest = en, raw = "", d = -1;
    const dm = rest.match(/^(\d{1,2}(?:\.\d{1,2})*)(?:\.\s+|\s+(?=[A-Z]))/);
    if(dm && !sm){ raw = dm[1]; d = 0; outline.length = 0; outline[0] = raw; rest = rest.slice(dm[0].length); }
    let pm;
    while((pm = rest.match(/^\(([a-z]{1,4}|\d{1,2})\)\s*/))){
      const t = pm[1];
      let depth;
      if(/^\d+$/.test(t)) depth = 3;
      else if(ROMANS.has(t) && !(t.length === 1 && outline[1] && /\(([a-z])\)$/.test(outline[1]) && String.fromCharCode(outline[1].match(/\(([a-z])\)$/)[1].charCodeAt(0) + 1) === t && !outline[2])) depth = 2;
      else depth = 1;
      const parent = [...outline.slice(0, depth)].reverse().find(Boolean) || "";
      raw = parent + "(" + t + ")"; d = depth;
      outline[depth] = raw; outline.length = depth + 1;
      rest = rest.slice(pm[0].length);
    }
    let lab = raw ? schedule + raw : null;
    if(lab){ if(used[lab]) lab += "#" + (++used[lab]); else used[lab] = 1; ctx = lab; }
    const head = (en.length < 90 && en === en.toUpperCase() && /[A-Z]{3}/.test(en)) || (sm && en.length < 120);
    gr.pi = paras.length;
    paras.push({ l: lab, c: ctx || null, h: head ? 1 : 0, en: lab && rest.trim() ? rest.trim() : en });
  }
  /* annotation → paragraph by page + vertical overlap */
  const comments = [];
  for(const n of notes){
    const [x1, y1, x2, y2] = n.rect || [0,0,0,0];
    let best = null, bestScore = -Infinity;
    for(const gr of groups){
      if(gr.skip) continue;
      const ls = gr.lines.filter(l => l.pn === n.pn); if(!ls.length) continue;
      const top = Math.max(...ls.map(l => l.y + l.h)), bot = Math.min(...ls.map(l => l.y));
      const overlap = Math.min(top, y2) - Math.max(bot, y1);
      /* overlap wins; otherwise prefer the paragraph just above the note (notes sit beside or under the text they discuss) */
      const above = bot >= y2 - 2;
      const score = overlap > 0 ? 1000 + overlap : -(above ? bot - y2 : (y1 - top) * 3 + 200);
      if(score > bestScore){ bestScore = score; best = gr; }
    }
    let an = best ? paras[best.pi].en.slice(0, 300) : "";
    if(n.quad && n.quad.length && best){
      const ys = []; for(let i = 1; i < n.quad.length; i += 2) ys.push(n.quad[i]);
      const qt = Math.max(...ys), qb = Math.min(...ys);
      const hl = best.lines.filter(l => l.pn === n.pn && l.y + l.h * 0.5 <= qt + 1 && l.y + l.h * 0.5 >= qb - 1).map(l => l.text).join(" ");
      if(hl) an = hl.slice(0, 300);
    }
    const kindKo = { Highlight:"하이라이트", StrikeOut:"취소선", Underline:"밑줄", Squiggly:"물결 밑줄", Caret:"삽입 표시", Text:"메모", FreeText:"텍스트 상자" }[n.sub] || n.sub;
    const x = n.x || `(${kindKo}만 있고 내용 없음)`;
    comments.push({ id: commentKey(n.a, n.d, x + "|" + an.slice(0, 40)), a: n.a, d: n.d, x, p: best ? best.pi : null, cl: best ? (paras[best.pi].c || null) : null, an, kind: kindKo, reply: n.reply });
  }
  const authors = {}; for(const c of comments) authors[c.a] = (authors[c.a] || 0) + 1;
  return { kind: "pdf", paras, changes: [], comments, authors };
}

if(typeof module !== "undefined") module.exports = { parseDocx, parsePdf, diffParas, newChangeAuthors, makeNumbering, commentKey };
