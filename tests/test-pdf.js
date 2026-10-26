const fs = require("fs");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { parsePdf } = require("../app/parse-core.js");
(async () => {
  const r = await parsePdf(pdfjsLib, new Uint8Array(fs.readFileSync(process.argv[2])));
  console.log("paras", r.paras.length, "labeled", r.paras.filter(p => p.l).length, "authors", JSON.stringify(r.authors));
  console.log("labels:", r.paras.filter(p => p.l).map(p => p.l).join(" "));
  for (const c of r.comments) console.log("comment", c.kind, c.a, c.d, "@", c.cl, "|", c.x.slice(0, 60), "| anchor:", c.an.slice(0, 70));
  for (const p of r.paras.slice(0, 6)) console.log(" para:", p.l, "|", p.en.slice(0, 90));
})().catch(e => { console.error(e); process.exit(1); });
