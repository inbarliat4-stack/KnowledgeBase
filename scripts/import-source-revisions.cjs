const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const markerStart = '// BEGIN GENERATED SOURCE REVISIONS';
const markerEnd = '// END GENERATED SOURCE REVISIONS';
const newItemsMarkerStart = '// BEGIN GENERATED SOURCE ITEMS';
const newItemsMarkerEnd = '// END GENERATED SOURCE ITEMS';
const sharePointRoot = '/personal/liat_i_we-com_co_il/Documents/שולחן העבודה/Kira/KnowledgeBase/';
const directO51Url = 'https://marathon051-my.sharepoint.com/:w:/r/personal/liat_i_we-com_co_il/_layouts/15/Doc.aspx?sourcedoc=%7B3035015F-BBF4-4E26-A9AB-94067AA7616B%7D&file=O-51%20%25u05d4%25u05e4%25u05e2%25u05dc%25u05ea%20eSIM%20%25u05d1%25u05d0%25u05de%25u05e6%25u05e2%25u05d5%25u05ea%20%25u05e7%25u05d5%25u05d3%20QR.docx&action=default&mobileredirect=true';
const newSourceItems = {
  'O-06': {
    id: 'kbnew_o06', kind: 'O', cat: 'sim', topicIds: [9],
    desc: 'בדיקת תאימות מכשירים לשימוש בארה״ב.',
    tags: ['תאימות מכשיר', 'ארה״ב'],
    reviewNotes: ['שם המקור מתחיל ב־0-06; יש לאמת את הקוד מול הגורם המקצועי.']
  },
  'R-14': {
    id: 'kbnew_r14', kind: 'R', cat: 'tech', topicIds: [14],
    desc: 'מסלול טיפול במקרה של אין קליטה או אין שירות בארץ.',
    tags: ['קליטה', 'אין שירות', 'ישראל'], reviewNotes: []
  },
  'O-37': {
    id: 'kbnew_o37', kind: 'O', cat: 'tech', topicIds: [11],
    desc: 'בדיקות גלישה כאשר שני קווים פעילים במכשיר.',
    tags: ['גלישה', 'שני קווים'], reviewNotes: []
  },
  'O-36': {
    id: 'kbnew_o36', kind: 'O', cat: 'tech', topicIds: [19],
    desc: 'בדיקות ותפעול כאשר נקודת הגישה האישית אינה פועלת.',
    tags: ['Hotspot', 'נקודת גישה אישית'],
    reviewNotes: ['יש לאמת אם התוכן שייך להוראת O-36 או למסלול הטיפול R-36; לא לשנות סיווג ללא אישור.']
  },
  'R-45': {
    id: 'kbnew_r45', kind: 'R', cat: 'intl', topicIds: [46],
    desc: 'מסלול טיפול בתקלה בחיוג בינלאומי.',
    tags: ['חו״ל', 'שיחות', 'חיוג בינלאומי'],
    reviewNotes: ['יש לאמת את הקוד ואת ההפניות מול R-150 לפני אישור.']
  },
  'R-50': {
    id: 'kbnew_r50', kind: 'R', cat: 'sim', topicIds: [4],
    desc: 'מסלול טיפול לאחר הפעלת SIM או eSIM.',
    tags: ['SIM', 'eSIM', 'הפעלה'], reviewNotes: []
  },
  'R-51': {
    id: 'kbnew_r51', kind: 'R', cat: 'sim', topicIds: [5],
    desc: 'מסלול טיפול כאשר קוד QR של eSIM לא מתקבל או לא נסרק.',
    tags: ['eSIM', 'QR'], reviewNotes: []
  }
};
const applyChanges = process.argv.includes('--write');
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

function readDocxParagraphs(filePath) {
  const archive = fs.readFileSync(filePath);
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = archive.lastIndexOf(endSignature);
  if (endOffset < 0) throw new Error(`Not a readable DOCX/ZIP package: ${filePath}`);

  const entryCount = archive.readUInt16LE(endOffset + 10);
  let cursor = archive.readUInt32LE(endOffset + 16);
  let documentXml = null;

  for (let index = 0; index < entryCount; index++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Invalid DOCX central directory: ${filePath}`);
    }

    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    if (name === 'word/document.xml') {
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) documentXml = compressed.toString('utf8');
      else if (method === 8) documentXml = require('node:zlib').inflateRawSync(compressed).toString('utf8');
      else throw new Error(`Unsupported compression method ${method} in ${name}.`);
      break;
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  if (!documentXml) throw new Error(`DOCX has no word/document.xml: ${filePath}`);

  const paragraphs = [];
  for (const match of documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const xml = match[1];
    const style = (xml.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/) || [])[1] || '';
    const bold = /<w:b(?:\s[^>]*)?(?:\/>|>)/.test(xml);
    const text = decodeXml(
      xml
        .replace(/<w:tab\b[^>]*\/>/g, ' ')
        .replace(/<w:br\b[^>]*\/>/g, '\n')
        .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, '$1')
        .replace(/<[^>]+>/g, '')
    ).replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push({ text, style, bold });
  }
  return paragraphs;
}

function normalizeCode(value) {
  const text = String(value || '').replace(/[‐‑‒–—]/g, '-');
  const match = text.match(/(?:^|[^A-Z0-9])([A-Z])\s*-?\s*(\d{2,3})(?=$|[^0-9])/i);
  if (match) return `${match[1].toUpperCase()}-${match[2]}`;
  const legacy = text.match(/^0-(\d{2})/i);
  return legacy ? `O-${legacy[1]}` : null;
}

function cleanHeading(value) {
  return value.replace(/[:：\s]+$/g, '').trim();
}

function isHeading(paragraph, kind) {
  const text = cleanHeading(paragraph.text);
  if (kind === 'O' && /(?:תת דגם|החל מגרסה|גרסת מפעיל|גרסת תוכנה)/i.test(text)) return false;
  if (/^(כן|לא|אולי|אחר)$/i.test(text)) return false;
  if (/^(?:heading|title|subtitle|[123]|a[123])$/i.test(paragraph.style)) return true;
  if (/^שלב\s*\d+\b/i.test(text)) return true;
  if (/^(?:מטרת המסמך|מטרת האבחון|מתי משתמשים(?: במסמך)?|לפני שמתחילים|סדר הפעולות|תהליך(?: עבודה)?|בדיקת סיום|אם התהליך לא הושלם|לאחר שינוי במערכת|כלל מנחה(?: לנציג)?|חשוב|זהירות|תיעוד|מה מתעדים|למי מעבירים|מתי מעבירים|תנאים לפני העברה|בדיקות נוספות|המשך טיפול|פתרון משלים|תסריט|אחרי האישור|אחרי ההעברה|לפני ההעברה)/i.test(text)) {
    return true;
  }
  if (/^(?:iPhone|Android|Samsung|Google Pixel|Xiaomi|Redmi|POCO|OnePlus|Oppo|Realme|HyperOS)(?:\b|\s|\/)/i.test(text)) return true;
  if (kind === 'O' && /^(?:מכשירי Apple|יתר המכשירים)$/i.test(text)) return true;
  if (kind === 'M' && /^(?:בחירת מסלול|מפת הפניות|לא ברור מה|אין שירות|יש רשת|הבעיה בשליחה|הלקוח אומר|סדר העבודה)/i.test(text)) return true;
  if (kind === 'E' && /^(?:מקרים שמחייבים|מה חובה לתעד|מה קורה לאחר ההעברה|לאחר ההעברה)/i.test(text)) return true;
  return paragraph.bold && text.length <= 90 && !/[.!?]$/.test(text);
}

function makeSections(paragraphs, kind) {
  const sections = [];
  let current = null;
  const addSection = (title) => {
    current = { title: cleanHeading(title), lines: [] };
    sections.push(current);
  };

  for (const paragraph of paragraphs) {
    if (isHeading(paragraph, kind)) {
      addSection(paragraph.text);
      continue;
    }
    if (!current) addSection('מידע כללי');
    current.lines.push(paragraph.text);
  }
  return sections;
}

function makeStages(sections) {
  return sections.map((section, index) => ({
    num: String(index + 1),
    title: section.title || `שלב ${index + 1}`,
    items: section.lines.map(text => ({ text, img: null })),
    images: []
  }));
}

function sourceUrl(sourceDir, filePath, code) {
  if (code === 'O-51') return directO51Url;
  const relative = path.relative(sourceDir, filePath).split(path.sep).join('/');
  const fullPath = `${sharePointRoot}מסמכי DOCx מוכנים לפרסום/${relative}`;
  return `https://marathon051-my.sharepoint.com/my?id=${encodeURIComponent(fullPath)}&ga=1`;
}

function sharePointDraftUrl(code) {
  const pathSegments = [
    'Documents',
    'שולחן העבודה',
    'Kira',
    'KnowledgeBase',
    'drafts',
    'new-app-items',
    `${code}.docx`
  ];
  return `https://marathon051-my.sharepoint.com/personal/liat_i_we-com_co_il/${pathSegments.map(encodeURIComponent).join('/')}?web=1`;
}

function buildItem(target, code, paragraphs, images) {
  const content = paragraphs.slice(1);
  const item = {
    kind: target.kind,
    topic: target.topic,
    desc: target.desc || '',
    tags: Array.isArray(target.tags) ? target.tags : [],
    stages: []
  };
  const sourceTitle = paragraphs[0].text
    .replace(/^[A-Z]\s*[-‐‑‒–—]?\s*\d{2,3}\s*/i, '')
    .replace(/^0-\d{2}\s*/i, '')
    .replace(/^[·:：\s-]+/, '')
    .trim();
  if (sourceTitle) item.topic = `${code} · ${sourceTitle}`;
  const issues = ['יש להשוות את כל התוכן וההפניות למקור לפני אישור.'];

  if (images > 0) {
    issues.push(`המקור מכיל ${images} תמונה/ות שלא הוטמעו בטיוטה; יש לבדוק אותן במסמך המקור.`);
  }

  if (target.kind === 'O') {
    item.body = { groups: makeSections(content, target.kind).map(section => ({
      title: section.title,
      ordered: /^שלב\s*\d+/i.test(section.title),
      steps: section.lines.map(text => ({ text, img: null }))
    })) };
  } else if (target.kind === 'R' || target.kind === 'S') {
    item.stages = makeStages(makeSections(content, target.kind));
  } else if (target.kind === 'E') {
    const body = { when: [], to: [], conditions: [], document: [], extra: [] };
    for (const section of makeSections(content, target.kind)) {
      const title = section.title;
      const lines = section.lines;
      if (/מתי|באילו מקרים/.test(title)) body.when.push(...lines);
      else if (/למי|לאן/.test(title)) body.to.push(...lines);
      else if (/תנאי|מה לוודא|לפני ההעברה/.test(title)) body.conditions.push(...lines);
      else if (/תיעוד|לתעד|מה מתעדים/.test(title)) body.document.push(...lines);
      else body.extra.push({ title, lines });
    }
    item.body = body;
  } else if (target.kind === 'T') {
    item.body = { scripts: makeSections(content, target.kind).map(section => ({
      situation: section.title,
      lines: section.lines
    })) };
  } else if (target.kind === 'M') {
    const intro = [];
    const stepSections = [];
    let current = null;
    for (const paragraph of content) {
      const match = paragraph.text.match(/^שלב\s*(\d+)\b/i);
      if (match) {
        current = { title: paragraph.text, lines: [] };
        stepSections.push(current);
      } else if (current) current.lines.push(paragraph.text);
      else intro.push(paragraph.text);
    }
    if (!stepSections.length) stepSections.push({ title: target.topic, lines: content.map(p => p.text) });

    item.body = {
      intro,
      questions: stepSections.map((section, index) => {
        const promptIndex = section.lines.findIndex(line => /[?؟]/.test(line) || /^["״“].+["״”"]$/.test(line));
        const prompt = promptIndex >= 0 ? section.lines[promptIndex] : section.title;
        const targetCodes = [...new Set(section.lines.flatMap(line => {
          const found = [];
          for (const match of line.replace(/[‐‑‒–—]/g, '-').matchAll(/\b([A-Z])\s*-\s*(\d{2,3})\b/gi)) {
            found.push(`${match[1].toUpperCase()}-${match[2]}`);
          }
          return found;
        }))].filter(routeCode => routeCode !== code && codeToId.has(routeCode));
        const answers = targetCodes.map(routeCode => {
          const routeLine = section.lines.find(line => line.replace(/[‐‑‒–—]/g, '-').includes(routeCode));
          return {
            text: `המשך למסלול ${routeCode}`,
            note: routeLine || '',
            go: `item:${codeToId.get(routeCode)}`
          };
        });
        if (!answers.length) {
          answers.push(index + 1 < stepSections.length
            ? { text: 'המשך לבירור הבא', note: '', go: `q:${index + 1}` }
            : { text: 'סיום אבחון', note: '', go: '' });
        }
        return {
          q: prompt,
          hint: section.lines.filter((_, lineIndex) => lineIndex !== promptIndex).join('\n'),
          answers
        };
      }),
      outro: []
    };
    issues.push('מבנה האבחון הומר לשאלות לפי שלבי המקור; יש לבדוק ולערוך את הסתעפויות התשובה וההפניות לפני אישור.');
  } else {
    throw new Error(`Unsupported app item type ${target.kind} for ${code}.`);
  }

  return { item, issues };
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function main() {
  if (!sourceDirArg) throw new Error('Pass the local SharePoint source folder path.');
  const sourceDir = path.resolve(sourceDirArg);
  if (!fs.statSync(sourceDir).isDirectory()) throw new Error(`Not a source folder: ${sourceDir}`);

  const index = fs.readFileSync(indexPath, 'utf8');
  const appItems = new Map();
  for (const line of index.split(/\r?\n/)) {
    const match = line.match(/^window\.dynamicDocs\[(["'])(.*?)\1\]\s*=\s*(.*);$/);
    if (!match) continue;
    let doc;
    try { doc = JSON.parse(match[3]); } catch { continue; }
    const code = normalizeCode(doc.topic);
    if (!code) continue;
    if (appItems.has(code)) throw new Error(`Multiple existing app items have code ${code}.`);
    appItems.set(code, doc);
    codeToId.set(code, doc.id);
  }

  const files = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory)) {
      const filePath = path.join(directory, name);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) walk(filePath);
      else if (/\.docx$/i.test(name)) files.push({ filePath, name, size: stats.size });
    }
  }
  walk(sourceDir);

  const candidates = new Map();
  const newItemCandidates = new Map();
  const skippedEmpty = [];
  const unmatched = [];
  for (const file of files) {
    if (!file.size) {
      skippedEmpty.push(file.name);
      continue;
    }
    const code = normalizeCode(file.name);
    const target = code && appItems.get(code);
    const newItemDefinition = code && newSourceItems[code];
    const isExistingRevisionTarget = target && (!newItemDefinition || target.id !== newItemDefinition.id);
    if (!isExistingRevisionTarget && !newItemDefinition) {
      unmatched.push({ name: file.name, code });
      continue;
    }
    const paragraphs = readDocxParagraphs(file.filePath);
    if (!paragraphs.length) throw new Error(`No readable text in ${file.filePath}.`);
    const archive = fs.readFileSync(file.filePath);
    const endOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let cursor = archive.readUInt32LE(endOffset + 16);
    const entryCount = archive.readUInt16LE(endOffset + 10);
    let imageCount = 0;
    for (let index = 0; index < entryCount; index++) {
      const nameLength = archive.readUInt16LE(cursor + 28);
      const extraLength = archive.readUInt16LE(cursor + 30);
      const commentLength = archive.readUInt16LE(cursor + 32);
      const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      if (name.startsWith('word/media/')) imageCount++;
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    const entry = {
      ...file,
      code,
      target: isExistingRevisionTarget ? target : newItemDefinition,
      paragraphs,
      imageCount,
      score: paragraphs.reduce((sum, p) => sum + p.text.length, 0)
    };
    const collection = isExistingRevisionTarget ? candidates : newItemCandidates;
    if (!collection.has(code)) collection.set(code, []);
    collection.get(code).push(entry);
  }

  const records = [];
  const duplicates = [];
  for (const [code, choices] of candidates) {
    choices.sort((a, b) => b.score - a.score);
    if (choices.length > 1) {
      if (choices[0].score === choices[1].score
        && choices[0].paragraphs.map(p => p.text).join('\n') !== choices[1].paragraphs.map(p => p.text).join('\n')) {
        throw new Error(`Ambiguous duplicate source documents for ${code}: ${choices.map(x => x.name).join(' | ')}`);
      }
      duplicates.push({ code, selected: choices[0].name, scores: choices.map(x => ({ name: x.name, characters: x.score })) });
    }
    records.push(choices[0]);
  }

  records.sort((a, b) => a.code.localeCompare(b.code));
  const timestamp = Math.floor(
    Math.max(...files.map(file => fs.statSync(file.filePath).mtimeMs)) / 60000
  ) * 60000;
  const generated = records.map(record => {
    const { item, issues } = buildItem(record.target, record.code, record.paragraphs, record.imageCount);
    if (candidates.get(record.code).length > 1) {
      issues.push(`נבחר הקובץ המפורט יותר מבין ${candidates.get(record.code).length} מקורות בעלי אותו קוד.`);
    }
    const relative = path.relative(sourceDir, record.filePath);
    const source = {
      name: record.name,
      url: sourceUrl(sourceDir, record.filePath, record.code)
    };
    return {
      id: record.target.id,
      revision: { item, issues, source, createdAt: timestamp },
      sourceName: record.name,
      paragraphCount: record.paragraphs.length,
      sourceTextCharacters: record.score,
      relative,
      code: record.code
    };
  });
  const newItems = [];
  for (const [code, choices] of newItemCandidates) {
    choices.sort((a, b) => b.score - a.score);
    if (choices.length > 1
      && choices[0].score === choices[1].score
      && choices[0].paragraphs.map(p => p.text).join('\n') !== choices[1].paragraphs.map(p => p.text).join('\n')) {
      throw new Error(`Ambiguous duplicate source documents for new item ${code}: ${choices.map(x => x.name).join(' | ')}.`);
    }
    const record = choices[0];
    const { item } = buildItem(record.target, code, record.paragraphs, record.imageCount);
    const source = {
      name: record.name,
      url: sourceUrl(sourceDir, record.filePath, code)
    };
    const reviewNotes = [
      'יש להשוות את התוכן וההפניות למסמך המקור לפני אישור ופרסום.',
      ...record.target.reviewNotes,
      ...(record.imageCount
        ? [`המקור מכיל ${record.imageCount} תמונה/ות שלא הוטמעו בטיוטה; יש לבדוק אותן במסמך המקור.`]
        : [])
    ];
    item.id = record.target.id;
    item.cat = record.target.cat;
    item.topicIds = record.target.topicIds;
    item.worlds = ['tech'];
    item.status = 'pending';
    item.source = source;
    item.draftDoc = {
      name: `${code} – טיוטת Word לעורך`,
      url: sharePointDraftUrl(code)
    };
    item.reviewNotes = reviewNotes;
    item.track = {
      state: 'טיוטה חדשה',
      source: record.name,
      gap: reviewNotes.join(' ')
    };
    item.createdAt = timestamp;
    newItems.push({
      id: record.target.id,
      item,
      sourceName: record.name,
      paragraphCount: record.paragraphs.length,
      sourceTextCharacters: record.score,
      code
    });
  }
  newItems.sort((a, b) => a.code.localeCompare(b.code));

  const lines = [
    markerStart,
    ...generated.map(({ id, revision }) => (
      `window.dynamicDocs[${JSON.stringify(id)}].revision = ${safeJson(revision)};`
    )),
    markerEnd
  ];
  const generatedBlock = lines.join('\n');
  const oldBlockMatch = index.match(new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`));
  let revisionsChanged = !oldBlockMatch;
  let nextIndex = index;
  if (oldBlockMatch) {
    revisionsChanged = oldBlockMatch[0] !== generatedBlock;
    nextIndex = nextIndex.replace(oldBlockMatch[0], generatedBlock);
  } else {
    const assignments = [...nextIndex.matchAll(/^window\.dynamicDocs\[[^\n]+\]\s*=\s*.*;$/gm)];
    if (!assignments.length) throw new Error('Could not find dynamicDocs seed declarations in index.html.');
    const insertAt = assignments[assignments.length - 1].index + assignments[assignments.length - 1][0].length;
    nextIndex = `${nextIndex.slice(0, insertAt)}\n\n${generatedBlock}${nextIndex.slice(insertAt)}`;
  }
  const oldNewItemsBlockMatch = nextIndex.match(new RegExp(`${newItemsMarkerStart}[\\s\\S]*?${newItemsMarkerEnd}`));
  let newItemsChanged = newItems.length > 0 && !oldNewItemsBlockMatch;
  if (newItems.length) {
    const newItemLines = [
      newItemsMarkerStart,
      ...newItems.map(({ id, item }) => (
        `window.dynamicDocs[${JSON.stringify(id)}] = ${safeJson(item)};`
      )),
      newItemsMarkerEnd
    ];
    const generatedNewItemsBlock = newItemLines.join('\n');
    if (oldNewItemsBlockMatch) {
      newItemsChanged = oldNewItemsBlockMatch[0] !== generatedNewItemsBlock;
      nextIndex = nextIndex.replace(oldNewItemsBlockMatch[0], generatedNewItemsBlock);
    } else {
      const revisionEnd = nextIndex.indexOf(markerEnd);
      if (revisionEnd < 0) throw new Error('Could not find the generated source revisions block.');
      const insertAt = revisionEnd + markerEnd.length;
      nextIndex = `${nextIndex.slice(0, insertAt)}\n\n${generatedNewItemsBlock}${nextIndex.slice(insertAt)}`;
    }
  }

  const versionMatch = nextIndex.match(/var NB_SEED_VERSION = (\d+);/);
  if (!versionMatch) throw new Error('Could not find NB_SEED_VERSION in index.html.');
  const changed = nextIndex !== index;
  const nextSeedVersion = Number(versionMatch[1]) + (revisionsChanged || newItemsChanged ? 1 : 0);
  if (changed) {
    nextIndex = nextIndex.replace(
      /var NB_SEED_VERSION = \d+;[^\r\n]*/,
      `var NB_SEED_VERSION = ${nextSeedVersion}; // proposed source revisions from DOCX`
    );
    nextIndex = nextIndex.replace(
      /var NB_SEED_CONTENT_FIELDS=\[([^\]]*)\];/,
      (_, fields) => {
        const additions = ['revision', 'draftDoc', 'reviewNotes'].filter(field => !fields.includes(`'${field}'`));
        return `var NB_SEED_CONTENT_FIELDS=[${[fields, ...additions.map(field => `'${field}'`)].filter(Boolean).join(',')}];`;
      }
    );
  }

  const existingNewItems = Object.entries(newSourceItems)
    .filter(([code, definition]) => appItems.get(code)?.id === definition.id).length;
  console.log(`Source DOCX files: ${files.length} (${files.length - skippedEmpty.length} non-empty; ${skippedEmpty.length} empty skipped).`);
  console.log(`Proposed revisions: ${generated.length} existing app items.`);
  console.log(`New app items: ${newItems.length} prepared; ${existingNewItems} already in the seed.`);
  console.log(`Unmatched source documents: ${unmatched.length}.`);
  console.log(`Duplicate codes: ${JSON.stringify(duplicates)}.`);
  console.log(`Image-bearing sources: ${generated.filter(entry => entry.revision.issues.some(issue => issue.includes('תמונה'))).map(entry => entry.code).join(', ') || 'none'}.`);
  console.log(`Source text accounted for: ${generated.reduce((sum, entry) => sum + entry.paragraphCount, 0)} paragraphs across ${generated.reduce((sum, entry) => sum + entry.sourceTextCharacters, 0)} characters.`);
  console.log(`Seed version: ${nextSeedVersion}.`);
  if (unmatched.length) console.log(`Unmatched: ${unmatched.map(entry => `${entry.code || 'no code'}: ${entry.name}`).join(' | ')}`);
  if (skippedEmpty.length) console.log(`Empty files skipped: ${skippedEmpty.join(' | ')}`);
  if (newItems.length) console.log(`New item codes: ${newItems.map(entry => entry.code).join(', ')}.`);
  const sample = generated.find(entry => entry.code === 'O-51');
  if (sample) {
    const body = sample.revision.item.body;
    console.log(`O-51 preview: ${body.groups.length} groups, ${body.groups.reduce((n, group) => n + group.steps.length, 0)} steps, source "${sample.sourceName}".`);
    console.log(`O-51 groups: ${body.groups.map(group => group.title).join(' | ')}`);
  }

  if (!applyChanges) {
    console.log('Dry run only. Re-run with --write to update index.html.');
    return;
  }
  if (!changed) {
    console.log('No changes needed.');
    return;
  }
  fs.writeFileSync(indexPath, nextIndex, 'utf8');
  console.log(`Updated ${path.relative(root, indexPath)}. Original DOCX files were read only.`);
}

const codeToId = new Map();
try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
