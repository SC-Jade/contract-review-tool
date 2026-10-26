const fs = require("fs"), path = require("path");
const JSZip = require("jszip");
const { DOMParser } = require("@xmldom/xmldom");
const { parseDocx, diffParas, newChangeAuthors } = require("../app/parse-core.js");

const dir = process.argv[2];
(async () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".docx")).sort();
  let prev = null;
  for(const f of files){
    const r = await parseDocx(await JSZip.loadAsync(fs.readFileSync(path.join(dir, f))), DOMParser);
    const labels = r.paras.filter(p => p.l).map(p => p.l);
    console.log(`\n## ${f}\n paras=${r.paras.length} labeled=${labels.length} changes=${r.changes.length} comments=${r.comments.length} authors=${JSON.stringify(r.authors)}`);
    if(!prev){
      console.log(" labels:", labels.join(" "));
      console.log(" heads:", r.paras.filter(p => p.h).map(p => (p.l||"") + ":" + p.en.slice(0,30)).join(" | "));
    } else {
      const d = diffParas(prev.paras, r.paras);
      console.log(" diff items:", d.length, d.map(x => x.cl).join(", "));
      console.log(" new authors:", JSON.stringify(newChangeAuthors(prev.changes, r.changes)));
    }
    console.log(" comments:", r.comments.map(c => `${c.id}@${c.cl}`).join(", "));
    prev = r;
  }
  const dup = {}; for(const p of prev.paras) if(p.l) dup[p.l] = (dup[p.l]||0)+1;
  console.log("\nduplicate labels in last:", Object.entries(dup).filter(([,v]) => v > 1).map(([k,v]) => k+"×"+v).join(" ") || "none");
})().catch(e => { console.error(e); process.exit(1); });
