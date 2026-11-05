// Builds the formatted source docx for app items: formatted-source/<CODE>.docx.
//
// The origin documents (the read-only folder "מסמכי DOCx מוכנים לפרסום") are only
// read, never changed. Each formatted document uses the knowledge-item template:
// header and footer, orange title, details table, editor callout, section headings,
// orange lists, yellow-highlighted missing information, an editor review section
// and a sources section.
//
//   node scripts/build-formatted-source.cjs "מסמכי DOCx מוכנים לפרסום"            all origins
//   node scripts/build-formatted-source.cjs "מסמכי DOCx מוכנים לפרסום" --only=O-40 one item
//   node scripts/build-formatted-source.cjs "<origin>.docx" --content=O-40.json     AI-formatted content
//
// Options:
//   --only=CODE        build one item code only
//   --content=FILE     use content formatted by Claude Code (JSON, see below) instead
//                      of the automatic line-by-line layout of the origin
//   --force            replace an existing formatted document. Without it existing
//                      documents are skipped, because editors may have edited them.
//   --out=DIR          output folder (default: formatted-source)
//
// Content JSON: { "subtitle": "…", "blocks": [[type, text], …], "review": ["…"] }
// Block types: h1 (section), h2 (sub-heading), p, bold, bullet, step (numbered),
// missing (yellow ⚠), note (orange box), tip (blue box), script (call script),
// table (text is an array of rows; the first row is the header).
// Links: ["h1", text, {"anchor": "step-2"}] marks a heading as a link target. A
// table cell may be {"text", "anchor"} (jumps to that heading in the document)
// or {"text", "url"} (opens a web address, e.g. an item in the app).

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = name => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const sourceArg = args.find(a => !a.startsWith('--'));
const onlyCode = option('only') ? normalizeCode(option('only')) : null;
const contentFile = option('content');
const force = args.includes('--force');
const outDir = path.resolve(root, option('out') || 'formatted-source');

const KIND_NAMES = { M: 'אבחון והכוונה למסלול טיפול', R: 'מסלול טיפול', S: 'הליך מקצועי / מומחה', O: 'מסמך תפעול', E: 'הסלמה והעברה', T: 'תסריט שיחה', I: 'מידע לעיון' };
const WORLD_NAMES = { service: 'שירות', tech: 'טכני', eng: 'הנדסה' };
// Same default the app applies when an item has no worlds (index.html: NB_CAT_TO_WORLD).
const CAT_TO_WORLD = { sim: 'tech', tech: 'tech', tech2: 'tech', intl: 'tech', billing: 'service', plans: 'service', ops: 'service' };

// ── Origin documents ────────────────────────────────────────────────────

function normalizeCode(value) {
  const text = String(value || '').replace(/[‐‑‒–—]/g, '-');
  const match = text.match(/(?:^|[^A-Z0-9])([A-Z])\s*-?\s*(\d{2,3})(?=$|[^0-9])/i);
  if (match) return `${match[1].toUpperCase()}-${match[2]}`;
  const legacy = text.match(/^0-(\d{2})/i);
  return legacy ? `O-${legacy[1]}` : null;
}

function walkDocx(target) {
  if (fs.statSync(target).isFile()) return [target];
  return fs.readdirSync(target).flatMap(name => {
    const p = path.join(target, name);
    if (fs.statSync(p).isDirectory()) return walkDocx(p);
    return /\.docx$/i.test(name) && !name.startsWith('~$') ? [p] : [];
  });
}

// The origin's state comes from where it sits in the origin folder.
function originState(filePath) {
  if (/להשלים/.test(path.basename(filePath))) return 'להשלים';
  if (/טיוטה/.test(path.dirname(filePath))) return 'טיוטה – בבדיקה';
  return 'מוכן לפרסום';
}

const decodeXml = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([\da-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const textOf = xml => decodeXml(xml.replace(/<w:tab\b[^>]*\/>/g, ' ').replace(/<w:br\b[^>]*\/>/g, ' ')
  .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, '$1').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// Reads an origin document into paragraphs ({text, list: 'bullet'|'step'|null, heading})
// and tables ({rows}). The file is opened read-only.
function readOrigin(filePath) {
  const entries = readZipEntries(filePath);
  const xml = entries.get('word/document.xml')?.toString('utf8');
  if (!xml) throw new Error(`Not a Word document: ${filePath}`);
  const numbering = entries.get('word/numbering.xml')?.toString('utf8') || '';
  const abstractFormat = {};
  for (const m of numbering.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    abstractFormat[m[1]] = (m[2].match(/<w:lvl w:ilvl="0"[\s\S]*?<w:numFmt w:val="(\w+)"/) || [])[1];
  }
  const numFormat = {};
  for (const m of numbering.matchAll(/<w:num w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g)) numFormat[m[1]] = abstractFormat[m[2]];
  const body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [])[1] || '';
  const items = [];
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const block = m[0];
    if (block.startsWith('<w:tbl')) {
      const rows = (block.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [])
        .map(row => (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(textOf))
        .filter(row => row.some(Boolean));
      if (rows.length) items.push({ rows });
      continue;
    }
    const text = textOf(block);
    if (!text) continue;
    const numId = (block.match(/<w:numId w:val="(\d+)"/) || [])[1];
    const list = numId && numId !== '0' ? (numFormat[numId] && numFormat[numId] !== 'bullet' ? 'step' : 'bullet') : null;
    const style = (block.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    items.push({ text, list, heading: /heading|כותרת|title/i.test(style) });
  }
  return items;
}

// ── Automatic layout of an origin (used without --content) ──────────────

const HEADING = /^(מטרת המסמך|מטרת האבחון|מתי משתמשים(?: בתהליך| במסמך)?\??|לפני שמתחילים:?|תהליך(?: עבודה)?:?|בדיקות סיום.*|אחרי האישור|אחרי ההעברה|לפני ההעברה ודא|מה מתעדים(?: לפני ההעברה)?\??|מקרים שמחייבים.*|מה קורה לאחר ההעברה\??|כלל מנחה(?: לנציג)?|זרימת הטיפול בקיצור|תוצאה|תוצאת האבחון|לאחר תיקון.*|מתי מעבירים למומחה\??|למי מעבירים\??|מה חובה לתעד.*|תיעוד|הערות|סדר הפעולות)$/;
const MISSING = /^(⚠\s*)?(להוסיף|להשלים|להשלמה|לבדוק מול|לאמת|חסר|חסרה|חסרים)|^\S+ להוסיף|צילום מסך|^אצל \S+/;
const NOTE = /^(⚠|חשוב:?|זהירות:?|אין לבצע|אין להעביר|שים לב:?)/;
const BRANCH = /^(כן|לא|אם כן|אם לא|נמצא|נמצאה|לא נמצא|לא נמצאה|לא קיימת|קיימת|המכשיר|השיחה|הלקוח)\b/;

function autoBlocks(items, code) {
  const out = [];
  items.forEach((it, i) => {
    if (it.rows) { out.push(['table', it.rows]); return; }
    const t = it.text.replace(/^[•▪›\-–]\s*/, '');
    if (i === 0 && normalizeCode(t) === code && t.length < 120) return; // the origin's own title line
    const next = items[i + 1];
    if (MISSING.test(t)) out.push(['missing', t]);
    else if ((/^שלב\s*\d+(?!\d)/.test(t) && t.length < 90) || HEADING.test(t) || (it.heading && t.length < 90)) out.push(['h1', t.replace(/:$/, '')]);
    else if (it.list === 'step' || /^\d+[.)]\s+/.test(t)) out.push(['step', t.replace(/^\d+[.)]\s+/, '')]);
    else if (it.list === 'bullet' || /^[•▪›]/.test(it.text)) out.push(['bullet', t]);
    else if (NOTE.test(t)) out.push(['note', t]);
    else if (/^["״“].+["״”"]$/.test(t)) out.push(['script', t]);
    else if (t.length <= 60 && !/[.:,;!?]$/.test(t) && next && !next.rows && (BRANCH.test(t) || t.length <= 40)) out.push(['h2', t]);
    else out.push(['p', t]);
  });
  return out;
}

// ── Template (copied from the knowledge-item template O-51) ─────────────

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HIGHLIGHT = '<w:highlight w:val="yellow"/>';
// Latin words and codes (R-31, eSIM, SMS) get their own left-to-right runs;
// marked right-to-left, Word reorders their characters ("R-31" shows as "31-R").
const run = (t, bold, extra = '') => String(t)
  .split(/([A-Za-z0-9](?:[A-Za-z0-9\-./:_@]*[A-Za-z0-9])?)/)
  .filter(s => s !== '')
  .map(s => {
    const ltr = /^[A-Za-z0-9]/.test(s);
    // Codes keep together at a line end: a non-breaking hyphen instead of "-".
    const text = ltr ? esc(s).replace(/-/g, '</w:t><w:noBreakHyphen/><w:t xml:space="preserve">') : esc(s);
    return `<w:r><w:rPr>${bold ? '<w:b/><w:bCs/>' : ''}${ltr ? '' : '<w:rtl/>'}${extra}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  })
  .join('');
// "Label: text" gets a bold label, as in the template's lists.
const runs = (t, extra = '') => {
  const m = t.match(/^([^:]{2,40}):\s+(.+)$/);
  return m && !/https?$/i.test(m[1]) ? run(`${m[1]}:`, true, extra) + run(` ${m[2]}`, false, extra) : run(t, false, extra);
};
const para = (style, inner, pPr = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${pPr}<w:bidi/></w:pPr>${inner}</w:p>`;
const SPACER = '<w:p><w:pPr><w:spacing w:after="0"/><w:bidi/></w:pPr></w:p>';
const listItem = (t, numId, extra) => para('ListParagraph', runs(t, extra), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`);
const BORDER = 'w:val="single" w:sz="4" w:space="0" w:color="D6D9DE"';
const TABLE_PR = `<w:tblStyle w:val="TableGrid"/><w:bidiVisual/><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top ${BORDER}/><w:left ${BORDER}/><w:bottom ${BORDER}/><w:right ${BORDER}/><w:insideH ${BORDER}/><w:insideV ${BORDER}/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>`;
const cellPara = (t, bold, extra) => `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:bidi/></w:pPr>${run(t, bold, extra)}</w:p>`;

// Links: anchors jump inside the document; urls get a relationship in the package.
let linkRels = [];
const LINK_STYLE = '<w:color w:val="1D45B4"/><w:u w:val="single"/>';
function linkRun(text, target) {
  const r = run(text, false, LINK_STYLE);
  if (target.anchor) return `<w:hyperlink w:anchor="${esc(target.anchor)}" w:history="1">${r}</w:hyperlink>`;
  const id = `rIdL${linkRels.length + 1}`;
  linkRels.push({ id, url: target.url });
  return `<w:hyperlink r:id="${id}" w:history="1">${r}</w:hyperlink>`;
}
let bookmarkId = 0;
const bookmarked = (anchor, inner) => anchor
  ? `<w:bookmarkStart w:id="${++bookmarkId}" w:name="${esc(anchor)}"/>${inner}<w:bookmarkEnd w:id="${bookmarkId}"/>`
  : inner;
// A table cell: plain text, or {text, anchor} / {text, url} for a link.
function cellContent(cell, head, extra) {
  if (cell && typeof cell === 'object' && (cell.anchor || cell.url)) {
    return `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:bidi/></w:pPr>${linkRun(cell.text, cell)}</w:p>`;
  }
  return cellPara(cell && typeof cell === 'object' ? cell.text : (cell || ''), head, extra);
}

function box(inner, color, fill) {
  return `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="9638"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="9638" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="single" w:sz="24" w:space="0" w:color="${color}"/></w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/></w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:bidi/></w:pPr>${inner}</w:p></w:tc></w:tr></w:tbl>${SPACER}`;
}

function detailsTable(rows) {
  const cell = (t, w, label, span) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span ? `<w:gridSpan w:val="${span}"/>` : ''}${label ? '<w:shd w:val="clear" w:color="auto" w:fill="F6F7F9"/>' : ''}</w:tcPr>${cellPara(t, label)}</w:tc>`;
  const trs = rows.map(r => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.length === 4
    ? cell(r[0], 1735, true) + cell(r[1], 3084) + cell(r[2], 1735, true) + cell(r[3], 3084)
    : cell(r[0], 1735, true) + cell(r[1], 7903, false, 3)}</w:tr>`).join('');
  return `<w:tbl><w:tblPr>${TABLE_PR}</w:tblPr><w:tblGrid><w:gridCol w:w="1735"/><w:gridCol w:w="3084"/><w:gridCol w:w="1735"/><w:gridCol w:w="3084"/></w:tblGrid>${trs}</w:tbl>${SPACER}`;
}

// Content table with the orange header row.
function contentTable(rows) {
  const cols = Math.max(...rows.map(r => r.length));
  const width = Math.floor(9638 / cols);
  const tr = (r, head) => `<w:tr><w:trPr><w:cantSplit/>${head ? '<w:tblHeader/>' : ''}</w:trPr>${Array.from({ length: cols }, (_, i) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="E63900"/>' : ''}</w:tcPr>${cellContent(r[i], head, head ? '<w:color w:val="FFFFFF"/>' : '')}</w:tc>`).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr>${TABLE_PR}</w:tblPr><w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(cols)}</w:tblGrid>${rows.map((r, i) => tr(r, i === 0)).join('')}</w:tbl>${SPACER}`;
}

function renderDocument({ code, title, subtitle, details, blocks, review, sources }) {
  linkRels = [];
  bookmarkId = 0;
  const out = [para('Title', run(title))];
  if (subtitle) out.push(`<w:p><w:pPr><w:spacing w:after="160"/><w:bidi/></w:pPr>${run(subtitle, false, '<w:color w:val="6B7280"/>')}</w:p>`);
  out.push(detailsTable(details));
  out.push(box(run('טיוטה לבדיקה – לא לפרסום לפני אישור.', true) + run(' עוצבה באמצעות AI ממסמך המקור (קריאה בלבד). ')
    + run('טקסט מסומן בצהוב', true) + run(' = מידע חסר שבעל/ת התחום צריך להשלים או לאמת. פרק "מקורות" בסוף מפרט מה נלקח מאיפה.'), 'E63900', 'FFF1E8'));
  const numbered = [];
  let current = null;
  for (const [type, text, opts] of blocks) {
    if (type !== 'step') current = null;
    switch (type) {
      case 'h1': out.push(para('Heading1', bookmarked(opts && opts.anchor, run(text)))); break;
      case 'h2': out.push(para('Heading2', run(text))); break;
      case 'bold': out.push(para('', run(text, true))); break;
      case 'bullet': out.push(listItem(text, 1, MISSING.test(text) ? HIGHLIGHT : '')); break;
      case 'step':
        if (!current) { current = 10 + numbered.length; numbered.push(current); }
        out.push(listItem(text, current, MISSING.test(text) ? HIGHLIGHT : ''));
        break;
      case 'missing': out.push(para('', run(/^⚠/.test(text) ? text : `⚠ ${text}`, false, HIGHLIGHT))); break;
      case 'note': out.push(box(runs(text), 'E63900', 'FFF1E8')); break;
      case 'tip': out.push(box(runs(text), '3B6FD4', 'EEF3FB')); break;
      case 'script': out.push(para('Script', run(text))); break;
      case 'table': out.push(contentTable(text)); break;
      case 'p': out.push(para('', runs(text))); break;
      default: throw new Error(`${code}: unknown block type "${type}"`);
    }
  }
  out.push(para('Heading1', run('לבדיקת העורך/ת – פערים והערות')));
  for (const note of review) out.push(listItem(note, 1, MISSING.test(note) ? HIGHLIGHT : ''));
  out.push(para('Heading1', run('מקורות')));
  for (const s of sources) out.push(listItem(s, 1));

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${out.join('')}`
    + '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>';
  return zip(packageEntries(document, code, title, numbered));
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const GREY = '<w:color w:val="6B7280"/><w:sz w:val="16"/><w:szCs w:val="16"/>';
const STYLES = `${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:color w:val="1F2937"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="he-IL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="100" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:color w:val="E63900"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="100"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="F3C2AE"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:color w:val="1F2A44"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:color w:val="E63900"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Script"><w:name w:val="Script"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F4F7"/><w:spacing w:before="40" w:after="40"/><w:ind w:left="360" w:right="360"/></w:pPr></w:style>'
  + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
  + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/></w:style></w:styles>';

function packageEntries(document, code, title, numbered) {
  const level = fmt => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${fmt === 'bullet' ? '•' : '%1.'}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="567" w:hanging="340"/></w:pPr><w:rPr>${fmt === 'bullet' ? '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' : '<w:b/><w:bCs/>'}<w:color w:val="E63900"/></w:rPr></w:lvl>`;
  const numbering = `${XML}<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${level('bullet')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${level('decimal')}</w:abstractNum>`
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    + numbered.map(n => `<w:num w:numId="${n}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('') + '</w:numbering>';
  const header = `${XML}<w:hdr xmlns:w="${W}"><w:p><w:pPr><w:pStyle w:val="Header"/><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/>${GREY}</w:rPr><w:t xml:space="preserve">wecom · מאגר ידע  |  טיוטה לבדיקה – לא לפרסום</w:t></w:r></w:p></w:hdr>`;
  const footer = `${XML}<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/>${GREY}</w:rPr><w:t xml:space="preserve">${esc(code)}  ·  עמוד </w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr>${GREY}</w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const ct = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return [
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${ct}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${ct}.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="${ct}.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="${ct}.header+xml"/><Override PartName="/word/footer1.xml" ContentType="${ct}.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ['docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>wecom מאגר ידע – טיוטה</dc:creator><dc:language>he-IL</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`],
    ['word/_rels/document.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="${rel}/numbering" Target="numbering.xml"/><Relationship Id="rIdH" Type="${rel}/header" Target="header1.xml"/><Relationship Id="rIdF" Type="${rel}/footer" Target="footer1.xml"/>`
      + linkRels.map(l => `<Relationship Id="${l.id}" Type="${rel}/hyperlink" Target="${esc(l.url)}" TargetMode="External"/>`).join('') + '</Relationships>'],
    ['word/document.xml', document],
    ['word/styles.xml', STYLES],
    ['word/numbering.xml', numbering],
    ['word/header1.xml', header],
    ['word/footer1.xml', footer]
  ];
}

// ── ZIP (DOCX) reading and writing, no dependencies ─────────────────────

function readZipEntries(filePath) {
  const archive = fs.readFileSync(filePath);
  const endOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) throw new Error(`Not a readable DOCX/ZIP package: ${filePath}`);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  let cursor = archive.readUInt32LE(endOffset + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index++) {
    if (archive.readUInt32LE(cursor) !== 0x02014B50) throw new Error(`Invalid DOCX central directory: ${filePath}`);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const dataStart = localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? zlib.inflateRawSync(compressed) : null;
    if (!data) throw new Error(`Unsupported compression method ${method} in ${name}.`);
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [fileName, content] of entries) {
    const name = Buffer.from(fileName, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

// ── Main ────────────────────────────────────────────────────────────────

function loadAppItems() {
  const items = {};
  for (const line of fs.readFileSync(path.join(root, 'index.html'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^window\.dynamicDocs\[(["'])(.*?)\1\]\s*=\s*(.*);$/);
    if (!m) continue;
    let d;
    try { d = JSON.parse(m[3]); } catch { continue; }
    const code = normalizeCode((String(d.topic || '').replace(/<[^>]+>/g, '').match(/^\s*[A-Z]-\d{2,3}(?!\d)/) || [])[0]);
    if (code && !items[code]) items[code] = d;
  }
  return items;
}

function titleFromFile(name, code) {
  const rest = name.replace(/\.docx$/i, '').replace(/_/g, ' ').replace(/^אצל \S+\s*/, '')
    .replace(/(?:^|\s)[A-Z0]\s*-?\s*\d{2,3}(?!\d)\s*-?\s*/i, ' ').replace(/\s*[-–.]?\s*להשלים\s*/, ' ').replace(/\s+/g, ' ').trim();
  return `${code} · ${rest}`;
}

function main() {
  if (!sourceArg) throw new Error('Pass the origin folder or an origin .docx file.');
  const source = path.resolve(sourceArg);
  if (path.resolve(outDir).startsWith(fs.statSync(source).isDirectory() ? source : path.dirname(source))) {
    throw new Error('The output folder must not be inside the origin folder: origin documents are read-only.');
  }
  const byCode = new Map();
  for (const file of walkDocx(source)) {
    const code = normalizeCode(path.basename(file));
    if (!code || (onlyCode && code !== onlyCode)) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(file);
  }
  if (!byCode.size) throw new Error(onlyCode ? `No origin document found for ${onlyCode}.` : 'No origin documents with an item code found.');
  if (contentFile && byCode.size !== 1) throw new Error('--content needs exactly one item: add --only=CODE.');

  const appItems = loadAppItems();
  fs.mkdirSync(outDir, { recursive: true });
  const report = { built: [], skipped: [] };
  for (const [code, files] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    const target = path.join(outDir, `${code}.docx`);
    if (fs.existsSync(target) && !force) { report.skipped.push(`${code} (exists; use --force to replace)`); continue; }
    const readable = files.filter(f => fs.statSync(f).size > 0);
    if (!readable.length) { report.skipped.push(`${code} (origin file is empty)`); continue; }

    const origins = readable.map(f => ({ file: f, name: path.basename(f), items: readOrigin(f) }));
    const originLines = origins.flatMap(o => o.items.flatMap(it => it.rows ? it.rows.flat() : [it.text])).filter(Boolean);
    if (originLines.length < 3) { report.skipped.push(`${code} (origin has almost no text)`); continue; }

    const content = contentFile ? JSON.parse(fs.readFileSync(path.resolve(contentFile), 'utf8')) : null;
    let blocks = content ? content.blocks : [];
    if (!content) {
      origins.forEach((o, i) => {
        if (i > 0) blocks.push(['h1', `מסמך מקור נוסף: ${o.name}`]);
        blocks.push(...autoBlocks(o.items, code));
      });
    }
    const missing = blocks.filter(([type, text]) => type === 'missing' || (typeof text === 'string' && /^(להוסיף|להשלים|לבדוק מול)/.test(text))).map(([, t]) => t.replace(/^⚠\s*/, ''));
    const review = content && content.review ? content.review
      : [...new Set(missing), 'לאמת הפניות לפריטים אחרים, שמות מסכים וערכים במערכות מול מסמך המקור והגורם המקצועי.'];

    const item = appItems[code] || {};
    const kind = item.kind || code[0];
    const worldIds = item.worlds && item.worlds.length ? item.worlds : (item.id ? [CAT_TO_WORLD[item.cat] || 'service'] : []);
    const state = [...new Set(readable.map(originState))].join(' / ');
    const title = item.topic ? String(item.topic).replace(/<[^>]+>/g, '').trim() : titleFromFile(origins[0].name, code);
    const names = origins.map(o => o.name).join(' + ');

    const docx = renderDocument({
      code,
      title,
      subtitle: (content && content.subtitle) || item.desc || '',
      details: [
        ['קוד', code, 'סוג פריט', `${kind} – ${KIND_NAMES[kind] || ''}`],
        ['נושא באפליקציה', title.replace(/^\s*[A-Z]-\d{2,3}\s*·\s*/, ''), 'עולם תוכן', worldIds.map(w => WORLD_NAMES[w] || w).join(' + ') || '—'],
        ['בעלים', item.owner || 'לקביעה', 'סטטוס', `מקור: ${state}`],
        ['מסמך מקור', names]
      ],
      blocks,
      review,
      sources: origins.map(o => `מסמך המקור (קריאה בלבד): ${o.name}`)
    });

    // Every line of the origin must appear in the automatic layout; with --content,
    // list what Claude Code's version does not quote verbatim, for review.
    const rendered = textOf(readZipXml(docx).replace(/<\/w:p>/g, ' ¶ '));
    const absent = originLines.map(l => l.replace(/^[•▪›\-–]\s*/, '').replace(/^\d+[.)]\s+/, '').replace(/:$/, ''))
      .filter(l => !(normalizeCode(l) === code && l.length < 120) && !rendered.includes(l));
    if (absent.length && !content) throw new Error(`${code}: origin text missing from the layout: "${absent[0].slice(0, 60)}"`);
    fs.writeFileSync(target, docx);
    report.built.push(`${code} (${state})${content && absent.length ? ` – ${absent.length} origin lines rephrased or left out; check them` : ''}`);
  }
  console.log(`Built ${report.built.length} formatted document(s) in ${path.relative(root, outDir) || '.'}:`);
  report.built.forEach(l => console.log(`  ${l}`));
  if (report.skipped.length) {
    console.log(`Skipped ${report.skipped.length}:`);
    report.skipped.forEach(l => console.log(`  ${l}`));
  }
  console.log('Origin documents were only read.');
}

function readZipXml(docx) {
  const tmp = path.join(require('node:os').tmpdir(), `wecom-kb-check-${process.pid}.docx`);
  fs.writeFileSync(tmp, docx);
  try { return readZipEntries(tmp).get('word/document.xml').toString('utf8'); } finally { fs.unlinkSync(tmp); }
}

main();
