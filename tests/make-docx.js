/* 실제 계약서 없이 테스트할 수 있게 가짜 계약서 Word 파일 세 버전을 만들어요.
   v1 업체 원본 → v2 우리 측 수정(변경 추적 + 코멘트) → v3 업체 회신(변경 추적 + 코멘트)
   사용: node make-docx.js <출력 폴더> */
const fs = require("fs"), path = require("path");
const JSZip = require("jszip");

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = t => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const ins = (t, a, id) => `<w:ins w:id="${id}" w:author="${a}" w:date="2026-10-01T00:00:00Z">${run(t)}</w:ins>`;
const del = (t, a, id) => `<w:del w:id="${id}" w:author="${a}" w:date="2026-10-01T00:00:00Z"><w:r><w:delText xml:space="preserve">${esc(t)}</w:delText></w:r></w:del>`;
const para = inner => `<w:p>${inner}</w:p>`;

const BASE = [
  "EXAMPLE ADVERTISING SERVICES AGREEMENT",
  "1. Definitions. \"Services\" means the advertising services provided by Partner to Publisher.",
  "2. Term. This Agreement shall take effect on the Effective Date and continue until terminated by either party.",
  "3. Revenue Share. Partner shall pay Publisher seventy percent (70%) of net revenue.",
  "4. Payment. Partner shall pay all amounts within sixty (60) days after the end of each calendar month.",
  "5. Discrepancies. Partner's reporting shall govern in case of any discrepancy.",
  "6. Withholding. Partner may withhold any payment it suspects is related to invalid traffic.",
  "7. Publicity. Partner may use Publisher's name and logo in its marketing materials.",
  "8. Audit. Partner may audit Publisher's records upon ten (10) days notice.",
  "9. Governing Law. This Agreement is governed by the laws of Singapore."
];

/* each version: list of paragraphs; a paragraph is either a string or a function returning inner XML */
function v2(){
  const a = "Our Legal";
  return BASE.map((t, i) => {
    if(i === 4) return () => run("4. Payment. Partner shall pay all amounts within ") + del("sixty (60)", a, 11) + ins("thirty (30)", a, 12) + run(" days after the end of each calendar month.");
    if(i === 7) return () => run("7. Publicity. Partner may use Publisher's name and logo ") + ins("only with Publisher's prior written consent ", a, 13) + run("in its marketing materials.");
    return t;
  });
}
function v3(){
  const a = "Partner Legal";
  return BASE.map((t, i) => {
    if(i === 4) return () => run("4. Payment. Partner shall pay all amounts within ") + del("thirty (30)", a, 21) + ins("forty-five (45)", a, 22) + run(" days after the end of each calendar month.");
    if(i === 7) return "7. Publicity. Partner may use Publisher's name and logo only with Publisher's prior written consent in its marketing materials.";
    if(i === 6) return () => run("6. Withholding. Partner may withhold any payment it ") + del("suspects is", a, 23) + ins("reasonably determines, with evidence, is", a, 24) + run(" related to invalid traffic.");
    return t;
  });
}
const COMMENTS = {
  2: [{ id: 1, p: 4, a: "Our Legal", x: "Our standard payment term is Net 30." }, { id: 2, p: 7, a: "Our Legal", x: "Logo use requires prior written consent." }],
  3: [{ id: 1, p: 4, a: "Partner Legal", x: "We can meet in the middle at 45 days." }, { id: 2, p: 6, a: "Partner Legal", x: "Added an evidence requirement as requested." }]
};

async function write(file, paras, comments = []){
  const zip = new JSZip();
  const hasC = comments.length > 0;
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${hasC ? `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>` : ""}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hasC ? `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>` : ""}</Relationships>`);
  const body = paras.map((p, i) => {
    const inner = typeof p === "function" ? p() : run(p);
    const cs = comments.filter(c => c.p === i);
    return para(cs.map(c => `<w:commentRangeStart w:id="${c.id}"/>`).join("") + inner + cs.map(c => `<w:commentRangeEnd w:id="${c.id}"/><w:r><w:commentReference w:id="${c.id}"/></w:r>`).join(""));
  }).join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  if(hasC) zip.file("word/comments.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${comments.map(c => `<w:comment w:id="${c.id}" w:author="${c.a}" w:date="2026-10-0${c.id}T00:00:00Z" w:initials="X"><w:p>${run(c.x)}</w:p></w:comment>`).join("")}</w:comments>`);
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
}

(async () => {
  const out = process.argv[2];
  if(!out){ console.error("사용: node make-docx.js <출력 폴더>"); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  await write(path.join(out, "1. Example Agreement.docx"), BASE);
  await write(path.join(out, "2. Example Agreement_ours.docx"), v2(), COMMENTS[2]);
  await write(path.join(out, "3. Example Agreement_partner.docx"), v3(), COMMENTS[3]);
  console.log("wrote 3 files to", out);
})().catch(e => { console.error(e); process.exit(1); });
