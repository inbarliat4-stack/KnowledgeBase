const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const batchPrefix = 'sharepoint-2026-11-01-';
const outDir = path.join(root, 'drafts', 'sharepoint-structured');
const importDir = process.argv[2] && path.resolve(process.argv[2]);
const kindNames = {
  M: 'אבחון והכוונה למסלול טיפול',
  R: 'טיפול בתקלה',
  S: 'הליך מקצועי / מומחה',
  O: 'הוראות מערכת או תהליך',
  E: 'הסלמה והעברה',
  T: 'תסריט שיחה',
  I: 'מידע לעיון'
};
const reviewNotes = {
  'o-06': 'שם קובץ המקור מתחיל ב־0-06, ואילו קוד הפריט במערכת הוא O-06. יש לאמת את הקוד לפני אישור.',
  'o-36': 'יש לבדוק מול הגורם המקצועי אם התוכן שייך להוראת O-36 או למסלול הטיפול R-36. אין לשנות סיווג ללא אישור.',
  'r-45': 'יש לאמת את הקוד וההפניה מול R-150 לפני אישור, בשל חשש לחפיפה בין הפריטים.'
};

function parseJson(text, context) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse ${context}: ${error.message}`);
  }
}

function loadAppItems() {
  const lines = fs.readFileSync(path.join(root, 'index.html'), 'utf8').split(/\r?\n/);
  const docs = new Map();
  for (const line of lines) {
    let match = line.match(/^window\.dynamicDocs\[(["'])(.*?)\1\]\s*=\s*(.*);$/);
    if (match) {
      try {
        docs.set(match[2], parseJson(match[3], `item ${match[2]}`));
      } catch (error) {
        if (match[3].includes(batchPrefix)) throw error;
      }
    }

    match = line.match(/^window\.dynamicDocs\[(["'])(.*?)\1\]\.revision\s*=\s*(.*);$/);
    if (match) {
      const doc = docs.get(match[2]) || { id: match[2] };
      doc.revision = parseJson(match[3], `revision ${match[2]}`);
      docs.set(match[2], doc);
    }

    match = line.match(/^window\.dynamicDocs\[(["'])(.*?)\1\]\._seedImportId\s*=\s*("(?:\\.|[^"])*");$/);
    if (match) {
      const doc = docs.get(match[2]) || { id: match[2] };
      doc._seedImportId = parseJson(match[3], `import ID ${match[2]}`);
      docs.set(match[2], doc);
    }
  }

  return docs;
}

function normalizeFilename(value) {
  return clean(value).normalize('NFC')
    .replace(/\.txt$/i, '')
    .replace(/\.docx$/i, '')
    .replace(/[_\s]+/g, ' ')
    .replace(/[‐–—]/g, '-')
    .trim()
    .toLowerCase();
}

function loadImportedItems() {
  if (!importDir) {
    throw new Error('Pass the local SharePoint import folder as the first argument.');
  }
  const reportPath = path.join(importDir, 'import-report.json');
  const textDir = path.join(importDir, 'text');
  const report = parseJson(fs.readFileSync(reportPath, 'utf8'), reportPath);
  const textFiles = fs.readdirSync(textDir)
    .filter(name => name.toLowerCase().endsWith('.txt'))
    .map(name => ({ name, normalized: normalizeFilename(name) }));
  const docs = loadAppItems();
  const imported = report.byCode.map(entry => {
    const importId = `${batchPrefix}${entry.code.toLowerCase()}`;
    const doc = docs.get(entry.target);
    if (!doc) throw new Error(`Could not find app item ${entry.target} for ${entry.code}.`);
    const item = (doc.revision && doc.revision.item) || doc;
    if (!item.kind || !kindNames[item.kind]) {
      throw new Error(`Imported item ${entry.code} has no supported type.`);
    }

    const sourceFiles = entry.source.map(sourceName => {
      const expected = normalizeFilename(sourceName);
      const matches = textFiles.filter(file => file.normalized === expected || file.normalized.endsWith(` ${expected}`));
      if (matches.length !== 1) {
        throw new Error(`Expected one extracted text file for "${sourceName}", found ${matches.length}.`);
      }
      const sourceText = fs.readFileSync(path.join(textDir, matches[0].name), 'utf8');
      if (!clean(sourceText)) throw new Error(`Extracted text is empty for "${sourceName}".`);
      return { name: sourceName, text: sourceText };
    });

    return {
      importId,
      doc,
      item,
      sourceName: sourceFiles.map(file => file.name).join(' + '),
      sourceText: sourceFiles.map((file, index) => {
        const label = sourceFiles.length > 1 ? `מסמך מקור נוסף ${index + 1}: ${file.name}\n` : '';
        return `${label}${file.text}`;
      }).join('\n\n'),
      isRevision: entry.mode === 'revision'
    };
  });

  imported.sort((a, b) => a.importId.localeCompare(b.importId));
  if (imported.length !== 62 || report.revisions !== 55 || report.newItems !== 7) {
    throw new Error(`Expected 62 imports (55 revisions and 7 new items); report contains ${imported.length}.`);
  }
  return imported;
}

function clean(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}

function xmlEscape(value) {
  return clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function paragraph(text, style = 'Normal') {
  const displayText = style === 'ListParagraph' && !/^(?:•|›|▪|\d+[.)])\s*/.test(clean(text))
    ? `• ${text}`
    : text;
  const safe = xmlEscape(displayText);
  if (!safe) return '';
  const templateStyles = ['Title', 'Heading1', 'Heading2', 'ListParagraph', 'Script'];
  const styleMarkup = templateStyles.includes(style) ? `<w:pStyle w:val="${style}"/>` : '';
  const keepNext = /^Heading/.test(style) ? '<w:keepNext/>' : '';
  const emphasis = style === 'Notice' ? '<w:highlight w:val="yellow"/><w:b/>' : style === 'Branch' ? '<w:b/>' : style === 'Subtitle' ? '<w:i/>' : '';
  return `<w:p><w:pPr>${styleMarkup}<w:bidi/><w:jc w:val="right"/>${keepNext}</w:pPr><w:r><w:rPr><w:rtl/>${emphasis}</w:rPr><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
}

function tableCell(text, width, header) {
  const bold = header ? '<w:b/>' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rtl/>${bold}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p></w:tc>`;
}

function metadataTable(rows) {
  const tableRows = rows.map(([label, value]) => `<w:tr>${tableCell(label, 2400, true)}${tableCell(value, 7000, false)}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9400" w:type="dxa"/><w:bidiVisual/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="7000"/></w:tblGrid>${tableRows}</w:tbl>`;
}

function isSourceHeading(text, kind) {
  const normalized = clean(text);
  if (/^שלב\s*\d+\b/.test(normalized)) return true;
  const common = /^(מטרת המסמך|מטרת האבחון|מתי משתמשים(?: בתהליך| במסמך)?\??|לפני שמתחילים:?|תהליך(?: עבודה)?(?: \(.+\))?:?|מה הלקוח עושה לאחר ההפעלה\??|בדיקות סיום.*|אחרי האישור|אחרי ההעברה|לפני ההעברה ודא|מה מתעדים(?: לפני ההעברה)?\??|מקרים שמחייבים.*|מה קורה לאחר ההעברה\??|כלל מנחה(?: לנציג)?|זרימת הטיפול בקיצור|חשוב:?|זהירות:?|תסריט|הפניה:?|פתרון משלים|תנאים לפני העברה)$/i;
  if (common.test(normalized)) return true;
  if (kind === 'M') {
    return /^(שאלת פתיחה|בדיקות בסיס|בדיקות מערכת|בדיקות במכשיר|לאן ממשיכים|תוצאת האבחון|סוג התקלה|האם .+\?)$/i.test(normalized);
  }
  if (kind === 'E') {
    return /^(מתי מעבירים למומחה\??|למי מעבירים\??|מה חובה לתעד.*|לאחר ההעברה\??|מקרים שמחייבים המשך טיפול מקצועי)$/i.test(normalized);
  }
  if (kind === 'T') {
    return normalized.length <= 70 && !/[.!?״”"]$/.test(normalized)
      && !/^(אם |כאשר |הלקוח שואל|הלקוח אומר|אין לומר)/.test(normalized);
  }
  if (kind === 'I') {
    return /^(הגדרה|הסבר|משמעות|מונחים|כללים|דוגמאות|השוואה|מקור|הערות)(?:[: ].*)?$/i.test(normalized);
  }
  return /^(בדיקת .+|הפעלת .+|הגדרת .+|תפעול .+|מעבר ל.+|סיום .+)$/i.test(normalized);
}

function splitSourceLines(sourceText) {
  return clean(sourceText).split('\n').flatMap(line => {
    const text = clean(line);
    if (!text) return [];
    return text.replace(/\s*•\s*/g, '\n• ').split('\n').map(part => clean(part)).filter(Boolean);
  });
}

function sourceLineStyle(text, kind) {
  if (isSourceHeading(text, kind)) return 'Heading2';
  if (kind === 'T' && (/^["״“].+["״”"]$/.test(text) || /^תסריט/.test(text))) return 'Script';
  if (/^(כן|לא|אם כן|אם לא|תוצאה:|המשך לשלב|עבור למסלול|הפנה ל|העבר ל|הפניה:)/i.test(text)) return 'Branch';
  if (/^(⚠|חשוב:|זהירות:|אין לבצע|אין לה)/.test(text)) return 'Notice';
  if (/^(?:•\s*|\d+[.)]\s+)/.test(text)) return 'ListParagraph';
  if (/^["״“].+["״”"]$/.test(text)) return 'Script';
  return 'Normal';
}

function renderTypeContent(record) {
  const { item } = record;
  const kind = item.kind;
  const title = {
    M: 'מסלול אבחון, שאלות והפניה',
    R: 'מסלול טיפול, בדיקות ותוצאות',
    S: 'הליך מקצועי, פעולות והעברה',
    O: 'תהליך עבודה והוראות ביצוע',
    E: 'תנאי הסלמה, תיעוד והעברה',
    T: 'תרחישים ונוסחי שיחה',
    I: 'מידע, הגדרות והפניות'
  }[kind];
  const out = [paragraph(title, 'Heading1')];
  let listMode = false;
  for (const line of splitSourceLines(record.sourceText)) {
    const style = sourceLineStyle(line, kind);
    if (style === 'Heading2') {
      listMode = kind === 'E' && /^(לפני ההעברה ודא|מה מתעדים|מקרים שמחייבים|תנאים לפני העברה|מה חובה לתעד)/.test(line);
    }
    out.push(paragraph(line, listMode && style === 'Normal' ? 'ListParagraph' : style));
  }
  return out;
}

function buildDocument(record) {
  const { item, doc, importId, sourceName, isRevision } = record;
  const out = [];
  const code = (item.topic || '').match(/[A-Z]-\d+/i);
  out.push(paragraph('טיוטה מובנית לעורך — לא לפרסום', 'Notice'));
  out.push(paragraph(item.topic || 'פריט ידע ללא כותרת', 'Title'));
  if (item.desc) out.push(paragraph(item.desc, 'Subtitle'));
  out.push(metadataTable([
    ['קוד פריט', code ? code[0] : 'לא צוין'],
    ['סוג ומבנה', `${item.kind} — ${kindNames[item.kind]}`],
    ['מצב במערכת', isRevision ? 'הצעת עדכון — ממתינה לבדיקה ואישור' : 'פריט חדש — ממתין לבדיקה ואישור'],
    ['מסמך/י מקור', sourceName],
    ['מזהה חבילת ייבוא', importId]
  ]));
  out.push(paragraph('הערת עריכה: המסמך נבנה כדי להציג את התוכן במבנה המתאים לסוג הפריט. יש להשוות למקור, להשלים רק מידע מאומת, ולא לפרסם לפני בדיקה ואישור.', 'Notice'));
  out.push(...renderTypeContent(record));
  out.push(paragraph('בדיקת עורך לפני אישור', 'Heading1'));
  out.push(paragraph('לאמת הפניות לפריטים אחרים, שמות מסכים וערכים במערכות, תנאי טיפול ופרטי העברה מול מסמך המקור והגורם המקצועי.', 'Bullet'));
  out.push(paragraph('המקור נשאר ללא שינוי; הטיוטה אינה מחליפה תוכן שפורסם עד לאישור עורך.', 'Bullet'));
  const specificReviewNote = reviewNotes[importId.slice(batchPrefix.length)];
  if (specificReviewNote) out.push(paragraph(`נקודה ממוקדת לאימות: ${specificReviewNote}`, 'Notice'));
  if (item.kind === 'M') {
    out.push(paragraph('יש לוודא שכל צומת אבחון כולל שאלה, תשובות אפשריות ויעד ברור להמשך או לסיום.', 'Notice'));
  }
  if (item.kind === 'E') {
    out.push(paragraph('יש להשלים רק פרטי יעד, תור או זמני טיפול שאושרו על ידי הגורם המקצועי; אין להסיק אותם מהמסמך.', 'Notice'));
  }
  out.push(paragraph(`מסמך/י מקור: ${sourceName}`, 'Meta'));

  return documentXml(out.join(''));
}

function templateDocumentXml(contents, templateXml) {
  const bodyMatch = templateXml.match(/<w:body>([\s\S]*?)<\/w:body>/);
  if (!bodyMatch) throw new Error('The O-50 template has no Word document body.');
  const sectionMatch = bodyMatch[1].match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
  if (!sectionMatch) throw new Error('The O-50 template has no section layout.');
  return templateXml.replace(bodyMatch[0], `<w:body>${contents}${sectionMatch[0]}</w:body>`);
}

function readZipEntries(filePath) {
  const archive = fs.readFileSync(filePath);
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = archive.lastIndexOf(endSignature);
  if (endOffset < 0) throw new Error(`Not a readable DOCX/ZIP package: ${filePath}`);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  let cursor = archive.readUInt32LE(endOffset + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index++) {
    if (archive.readUInt32LE(cursor) !== 0x02014B50) throw new Error('Invalid DOCX central directory.');
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? zlib.inflateRawSync(compressed) : null;
    if (!data) throw new Error(`Unsupported compression method ${method} in ${name}.`);
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const crcTable = (() => {
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
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const date = 0x21;
  for (const [fileName, content] of entries) {
    const name = Buffer.from(fileName, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function writeDocx(document, templateEntries) {
  const entries = Array.from(templateEntries.entries()).map(([name, content]) => [
    name,
    name === 'word/document.xml' ? document : content
  ]);
  return zip(entries);
}

function main() {
  const imported = loadImportedItems();
  const templatePath = process.argv[3] && path.resolve(process.argv[3]);
  if (!templatePath || !fs.existsSync(templatePath)) {
    throw new Error('Pass the O-50 middle-template DOCX path as the second argument.');
  }
  const templateEntries = readZipEntries(templatePath);
  const templateDocument = templateEntries.get('word/document.xml');
  if (!templateDocument || !templateEntries.has('word/styles.xml')) {
    throw new Error('The provided DOCX does not contain a valid Word document and styles.');
  }
  const templateDocumentText = templateDocument.toString('utf8');
  fs.mkdirSync(outDir, { recursive: true });
  const counts = {};
  for (const record of imported) {
    const sourceBaseName = record.sourceName.split(' + ')[0].replace(/\.docx$/i, '');
    const fileName = `${sourceBaseName} - טיוטה מובנית.docx`;
    const document = templateDocumentXml(buildDocument(record), templateDocumentText);
    for (const line of splitSourceLines(record.sourceText)) {
      if (!document.includes(xmlEscape(line))) {
        throw new Error(`Source text was not preserved in ${fileName}: "${line.slice(0, 80)}".`);
      }
    }
    fs.writeFileSync(path.join(outDir, fileName), writeDocx(document, templateEntries));
    counts[record.item.kind] = (counts[record.item.kind] || 0) + 1;
  }
  console.log(`Created ${imported.length} SharePoint-ready middle templates in ${path.relative(root, outDir)}.`);
  console.log(`Types: ${Object.entries(counts).map(([kind, count]) => `${kind}=${count}`).join(', ')}`);
}

module.exports = {
  buildDocument,
  metadataTable,
  paragraph,
  readZipEntries,
  splitSourceLines,
  templateDocumentXml,
  writeDocx,
  xmlEscape
};

if (require.main === module) main();
