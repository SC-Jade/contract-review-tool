/* Build a test PDF from the parsed v5 docx (numbers typed into the text, as a PDF export would show them)
   and add reviewer annotations: a highlight with a comment, a sticky note, and a reply-free FreeText. */
const fs = require("fs");
const JSZip = require("jszip");
const { DOMParser } = require("@xmldom/xmldom");
const { PDFDocument, StandardFonts, PDFName, PDFString, PDFArray, PDFNumber } = require("pdf-lib");
const { parseDocx } = require("../app/parse-core.js");

const ascii = s => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");

(async () => {
  const r = await parseDocx(await JSZip.loadAsync(fs.readFileSync(process.argv[2])), DOMParser);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const size = 10, lh = 13, W = 612, H = 792, M = 60, maxW = W - 2 * M;
  let page = pdf.addPage([W, H]), y = H - M;
  const placed = [];
  for (const p of r.paras.slice(0, 200)) {
    const mark = p.l && !p.l.startsWith("별첨") ? (/^\d+$/.test(p.l) ? p.l + ". " : p.l.replace(/^\d+/, "") + " ") : "";
    const text = ascii(mark + p.en);
    const words = text.split(/\s+/); let line = "", lines = [];
    for (const w of words) { const t = line ? line + " " + w : w; if (font.widthOfTextAtSize(t, size) > maxW) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    if (y - lines.length * lh < M) { page = pdf.addPage([W, H]); y = H - M; }
    const top = y;
    for (const l of lines) { page.drawText(l, { x: M, y, size, font }); y -= lh; }
    placed.push({ p, page, top, bottom: y + lh - 3, lines: lines.length });
    y -= lh * 0.8;
  }
  const annot = (pg, dict) => {
    const ref = pdf.context.register(pdf.context.obj(dict));
    let annots = pg.node.lookup(PDFName.of("Annots"), PDFArray);
    if (!annots) { annots = pdf.context.obj([]); pg.node.set(PDFName.of("Annots"), annots); }
    annots.push(ref);
  };
  const find = start => placed.find(x => x.p.en.startsWith(start));
  /* 1) highlight on 5(c) with a comment from the partner */
  const a = find("Withhold, Adjust, or Offset Payments");
  annot(a.page, { Type: "Annot", Subtype: "Highlight", Rect: [M, a.bottom, W - M, a.top + 10],
    QuadPoints: [M, a.top + 10, W - M, a.top + 10, M, a.top - 2, W - M, a.top - 2],
    T: PDFString.of("Partner Legal"), M: PDFString.of("D:20261021090000Z"),
    Contents: PDFString.of("We cannot accept a 60-day final determination period. Fraud investigations by advertisers often take longer."), C: [1, 1, 0] });
  /* 2) sticky note on 12(g) Publicity from our side */
  const b = find("Publicity.");
  annot(b.page, { Type: "Annot", Subtype: "Text", Rect: [W - M + 4, b.top - 4, W - M + 22, b.top + 14],
    T: PDFString.of("Our Legal"), M: PDFString.of("D:20261022010000Z"),
    Contents: PDFString.of("Please change to prior written consent for each specific use of Publisher's name and logo."), Name: "Comment" });
  /* 3) free text box on 2 TERM */
  const c = find("This Agreement shall take effect");
  annot(c.page, { Type: "Annot", Subtype: "FreeText", Rect: [M, c.bottom - 30, M + 300, c.bottom - 4],
    T: PDFString.of("Partner Legal"), M: PDFString.of("D:20261021091500Z"),
    Contents: PDFString.of("Termination for convenience is not acceptable for us."), DA: PDFString.of("/Helv 9 Tf 0 g") });
  fs.writeFileSync(process.argv[3], await pdf.save());
  console.log("pages", pdf.getPageCount(), "paras", placed.length);
})().catch(e => { console.error(e); process.exit(1); });
