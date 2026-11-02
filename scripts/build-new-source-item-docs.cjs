const fs = require('node:fs');
const path = require('node:path');
const {
  paragraph,
  readZipEntries,
  templateDocumentXml,
  writeDocx
} = require('./build-sharepoint-structured-docs.cjs');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const outputDir = path.join(root, 'drafts', 'new-app-items');
const definitions = {
  'O-06': 'kbnew_o06',
  'R-14': 'kbnew_r14',
  'O-37': 'kbnew_o37',
  'O-36': 'kbnew_o36',
  'R-45': 'kbnew_r45',
  'R-50': 'kbnew_r50',
  'R-51': 'kbnew_r51'
};
const sourceDirArg = process.argv.find((arg, index) => index > 1 && !arg.startsWith('--'));

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function normalizeCode(value) {
  const text = String(value || '').replace(/[‐‑‒–—]/g, '-');
  const match = text.match(/(?:^|[^A-Z0-9])([A-Z])\s*-?\s*(\d{2,3})(?=$|[^0-9])/i);
  if (match) return `${match[1].toUpperCase()}-${match[2]}`;
  const legacy = text.match(/^0-(\d{2})/i);
  return legacy ? `O-${legacy[1]}` : null;
}

function readParagraphs(documentXml) {
  return [...documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map(([, xml]) => decodeXml(
      xml
        .replace(/<w:tab\b[^>]*\/>/g, ' ')
        .replace(/<w:br\b[^>]*\/>/g, '\n')
        .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, '$1')
        .replace(/<[^>]+>/g, '')
    ).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function walkDocxFiles(directory) {
  const files = [];
  for (const name of fs.readdirSync(directory)) {
    const filePath = path.join(directory, name);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) files.push(...walkDocxFiles(filePath));
    else if (/\.docx$/i.test(name) && stats.size) files.push({ filePath, name });
  }
  return files;
}

function makeProposedContent(item, sourceName) {
  const out = [
    paragraph('טיוטת פריט חדש — לבדיקה ואישור, לא לפרסום', 'Notice'),
    paragraph(item.topic, 'Title'),
    paragraph(item.desc, 'Subtitle'),
    paragraph(`קוד: ${normalizeCode(item.topic) || ''}`, 'Normal'),
    paragraph(`סוג פריט: ${item.kind}`, 'Normal'),
    paragraph(`מסמך מקור: ${sourceName}`, 'Normal'),
    paragraph('הגרסה המוצעת באפליקציה', 'Heading1')
  ];

  if (item.kind === 'O') {
    for (const group of item.body.groups) {
      if (group.title) out.push(paragraph(group.title, 'Heading2'));
      for (const step of group.steps) out.push(paragraph(step.text, 'ListParagraph'));
    }
  } else {
    for (const stage of item.stages) {
      out.push(paragraph(stage.title, 'Heading2'));
      for (const step of stage.items || []) out.push(paragraph(step.text, 'ListParagraph'));
    }
  }

  out.push(paragraph('הערות לעורך', 'Heading1'));
  out.push(paragraph('יש להשוות את התוכן וההפניות למקור, להשלים רק מידע מאומת, ולא לפרסם לפני בדיקה ואישור.', 'Notice'));
  for (const note of item.reviewNotes || []) out.push(paragraph(note, 'Notice'));
  out.push(paragraph('המסמך המקורי מצורף בהמשך ללא שינוי.', 'Normal'));
  out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  out.push(paragraph('המקור המלא — לצורך השוואה', 'Heading1'));
  return out.join('');
}

function main() {
  if (!sourceDirArg) throw new Error('Pass the local SharePoint source folder path.');
  const sourceDir = path.resolve(sourceDirArg);
  if (!fs.statSync(sourceDir).isDirectory()) throw new Error(`Not a source folder: ${sourceDir}`);

  const appItems = new Map();
  for (const line of fs.readFileSync(indexPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^window\.dynamicDocs\[(["'])(.*?)\1\]\s*=\s*(.*);$/);
    if (!match || !Object.values(definitions).includes(match[2])) continue;
    const item = JSON.parse(match[3]);
    appItems.set(item.id, item);
  }

  const sources = new Map();
  for (const file of walkDocxFiles(sourceDir)) {
    const code = normalizeCode(file.name);
    if (!definitions[code]) continue;
    if (sources.has(code)) throw new Error(`Multiple non-empty source documents found for ${code}.`);
    sources.set(code, file);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  for (const [code, id] of Object.entries(definitions)) {
    const item = appItems.get(id);
    const source = sources.get(code);
    if (!item) throw new Error(`Could not find app item ${id} in index.html.`);
    if (!source) throw new Error(`Could not find a non-empty source document for ${code}.`);
    if (!item.draftDoc || !item.draftDoc.url.endsWith(`/drafts/new-app-items/${code}.docx`)) {
      throw new Error(`The app item ${code} does not contain its Word draft link.`);
    }

    const entries = readZipEntries(source.filePath);
    const documentXml = entries.get('word/document.xml')?.toString('utf8');
    if (!documentXml || !entries.has('word/styles.xml')) {
      throw new Error(`Invalid Word source document for ${code}.`);
    }
    const bodyMatch = documentXml.match(/<w:body>([\s\S]*?)<\/w:body>/);
    if (!bodyMatch) throw new Error(`Word source document for ${code} has no body.`);
    const sectionMatch = bodyMatch[1].match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
    if (!sectionMatch) throw new Error(`Word source document for ${code} has no section layout.`);
    const originalContent = bodyMatch[1].replace(sectionMatch[0], '');
    const originalParagraphs = readParagraphs(documentXml);
    if (!originalParagraphs.length) throw new Error(`Word source document for ${code} contains no text.`);

    const draftContent = makeProposedContent(item, source.name);
    const finalDocument = templateDocumentXml(
      `${draftContent}${originalContent}`,
      documentXml
    );
    const finalParagraphs = readParagraphs(finalDocument);
    if (JSON.stringify(finalParagraphs.slice(-originalParagraphs.length)) !== JSON.stringify(originalParagraphs)) {
      throw new Error(`The original text was not preserved in the generated draft for ${code}.`);
    }
    const outputPath = path.join(outputDir, `${code}.docx`);
    fs.writeFileSync(outputPath, writeDocx(finalDocument, entries));
    console.log(`${code}: created ${path.relative(root, outputPath)}; source content and embedded assets preserved.`);
  }
  console.log(`Created ${Object.keys(definitions).length} Word draft documents. Source DOCX files were read only.`);
}

main();
