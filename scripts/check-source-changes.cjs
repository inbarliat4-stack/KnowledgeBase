// Changes check for the formatted source documents (formatted-source/<CODE>.docx).
//
// Compares every formatted document with its snapshot from the last check, shows
// what changed, and turns each change into a proposed version of the app item
// (doc.revision), shown to editors beside the published version until approved.
// Nothing is published without approval, and nothing is committed by this script.
//
//   node scripts/check-source-changes.cjs                 check: report changes and the proposed versions (writes nothing)
//   node scripts/check-source-changes.cjs --write         add the proposed versions to index.html and update the snapshot
//   node scripts/check-source-changes.cjs --publish=O-50  publish an approved proposed version in index.html
//   node scripts/check-source-changes.cjs --baseline      snapshot all documents as they are now (no proposals)
//
// Proposed versions apply only the lines that changed, so the rest of the item
// (structure, images, links) stays as it is. Lines that cannot be placed
// automatically are listed in the proposal's notes for the editor.
// After --write or --publish, run node wordpress/build.cjs before committing.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const docsDir = path.join(root, 'formatted-source');
const snapshotFile = path.join(docsDir, '.changes-check-snapshot.json');
const indexPath = path.join(root, 'index.html');
const args = process.argv.slice(2);
const write = args.includes('--write');
const baseline = args.includes('--baseline');
const publishCode = (args.find(a => a.startsWith('--publish=')) || '').slice('--publish='.length).toUpperCase();

// ── Reading documents ───────────────────────────────────────────────────

function readEntry(file, name) {
  const a = fs.readFileSync(file);
  const end = a.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error(`Not a Word document: ${file}`);
  let cur = a.readUInt32LE(end + 16);
  for (let i = 0; i < a.readUInt16LE(end + 10); i++) {
    const method = a.readUInt16LE(cur + 10), size = a.readUInt32LE(cur + 20);
    const nl = a.readUInt16LE(cur + 28), xl = a.readUInt16LE(cur + 30), cl = a.readUInt16LE(cur + 32), off = a.readUInt32LE(cur + 42);
    if (a.subarray(cur + 46, cur + 46 + nl).toString('utf8') === name) {
      const s = off + 30 + a.readUInt16LE(off + 26) + a.readUInt16LE(off + 28);
      const c = a.subarray(s, s + size);
      return (method === 8 ? zlib.inflateRawSync(c) : c).toString('utf8');
    }
    cur += 46 + nl + xl + cl;
  }
  return '';
}
const decode = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
function paragraphs(file) {
  return [...readEntry(file, 'word/document.xml').matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map(m => decode(m[1].replace(/<w:noBreakHyphen\/>/g, '-').replace(/<w:tab\b[^>]*\/>/g, ' ').replace(/<w:br\b[^>]*\/>/g, ' ')
      .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, '$1').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
// The part of a formatted document that mirrors the app item (not its header,
// editor notes, sources or the copy of the origin).
const START = [/^טיוטה לבדיקה – לא לפרסום לפני אישור/, /^הגרסה המוצעת באפליקציה$/, /^התוכן במבנה מאוחד$/];
const STOP = [/^לבדיקת העורך\/ת/, /^הערות לעורך$/, /^מידע להשלמה ידנית$/, /^המקור המלא — לצורך השוואה$/, /^בדיקת עורך לפני אישור$/];
function contentLines(all) {
  let from = 0;
  for (const re of START) { const i = all.findIndex(l => re.test(l)); if (i >= 0) { from = i + 1; break; } }
  let to = all.length;
  for (let i = from; i < all.length; i++) if (STOP.some(re => re.test(all[i]))) { to = i; break; }
  return all.slice(from, to);
}

// ── Diff ────────────────────────────────────────────────────────────────

// Hunks between two line lists: {before: last unchanged new-line index or -1, removed: [], added: []}.
function diff(A, B) {
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const hunks = [];
  let i = 0, j = 0, cur = null;
  const flush = () => { if (cur && (cur.removed.length || cur.added.length)) hunks.push(cur); cur = null; };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { flush(); i++; j++; continue; }
    cur = cur || { anchor: j - 1 >= 0 ? B[j - 1] : null, removed: [], added: [] };
    if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) cur.added.push(B[j++]);
    else cur.removed.push(A[i++]);
  }
  flush();
  return hunks;
}

// ── Item text slots ─────────────────────────────────────────────────────

const norm = s => String(s == null ? '' : s).replace(/<[^>]+>/g, ' ').replace(/[‐‑‒–—]/g, '-').replace(/[״“”„]/g, '"').replace(/[׳‘’]/g, "'")
  .replace(/^[\s•▪›\-]*(\d+[.)]\s+)?/, '').replace(/\s+/g, ' ').replace(/\s*([:.,;])\s*/g, '$1').replace(/[:.]+$/, '').trim().toLowerCase();

// Every editable text of an item, with how to change it.
function slots(item) {
  const out = [];
  const line = (arr, idx, key, wrap) => ({
    type: 'line', get: () => (key ? arr[idx][key] : arr[idx]),
    set: v => { if (key) arr[idx][key] = v; else arr[idx] = v; },
    remove: () => { arr.splice(idx, 1); },
    insertAfter: v => { arr.splice(idx + 1, 0, wrap(v)); }
  });
  const title = (obj, key, list, wrap) => ({
    type: 'title', get: () => obj[key], set: v => { obj[key] = v; },
    insertFirst: list ? v => { list.unshift(wrap(v)); } : null
  });
  const b = item.body;
  const stepWrap = v => ({ text: v, img: null });
  if (b && b.groups) b.groups.forEach(g => {
    out.push(title(g, 'title', g.steps, stepWrap));
    g.steps.forEach((s, i) => out.push(line(g.steps, i, 'text', stepWrap)));
  });
  (item.stages || []).forEach(s => {
    s.items = s.items || [];
    const wrap = v => (s.items.some(x => typeof x === 'object') ? { text: v, img: null } : v);
    out.push(title(s, 'title', s.items, wrap));
    s.items.forEach((x, i) => out.push(typeof x === 'object' ? line(s.items, i, 'text', wrap) : line(s.items, i, null, wrap)));
  });
  if (b && b.questions) {
    ['intro', 'outro'].forEach(f => (b[f] || []).forEach((l, i) => out.push(line(b[f], i, null, v => v))));
    b.questions.forEach(q => {
      ['title', 'q'].forEach(k => q[k] && out.push(title(q, k, null)));
      const hint = String(q.hint || '').split('\n');
      hint.forEach((h, i) => h && out.push({ type: 'title', get: () => hint[i], set: v => { hint[i] = v; q.hint = hint.join('\n'); }, insertFirst: null }));
      q.answers.forEach(a => { out.push(title(a, 'text', null)); if (a.note) out.push(title(a, 'note', null)); });
    });
  }
  if (b && (b.when || b.extra)) {
    ['when', 'to', 'conditions', 'document'].forEach(f => (b[f] || []).forEach((l, i) => out.push(line(b[f], i, null, v => v))));
    (b.extra || []).forEach(x => { out.push(title(x, 'title', x.lines, v => v)); x.lines.forEach((l, i) => out.push(line(x.lines, i, null, v => v))); });
  }
  if (b && b.scripts) b.scripts.forEach(s => {
    out.push(title(s, 'situation', s.lines, v => v));
    s.lines.forEach((l, i) => out.push(line(s.lines, i, null, v => v)));
  });
  if (b && typeof b.html === 'string') {
    // Rich text: each text run between tags can be replaced (not moved or deleted).
    const parts = b.html.split(/(<[^>]+>)/);
    parts.forEach((p, i) => {
      if (!p || p.startsWith('<') || !p.trim()) return;
      out.push({ type: 'title', get: () => decode(parts[i]), set: v => { parts[i] = v.replace(/&/g, '&amp;').replace(/</g, '&lt;'); b.html = parts.join(''); }, insertFirst: null });
    });
  }
  return out;
}
const find = (list, text) => { const k = norm(text); return k ? list.find(s => norm(s.get()) === k) : null; };

// Applies one document's hunks to a copy of the item. Returns {item, applied, notes}.
function applyHunks(base, hunks) {
  const item = JSON.parse(JSON.stringify(base));
  const applied = [], notes = [];
  for (const h of hunks) {
    const pairs = Math.min(h.removed.length, h.added.length);
    for (let k = 0; k < pairs; k++) {
      const s = find(slots(item), h.removed[k]);
      if (s) { s.set(h.added[k]); applied.push(`שונה: "${h.removed[k]}" ← "${h.added[k]}"`); }
      else notes.push(`לא שובץ אוטומטית — יש לעדכן ידנית: "${h.removed[k]}" ← "${h.added[k]}"`);
    }
    for (const old of h.removed.slice(pairs)) {
      const s = find(slots(item), old);
      if (s && s.type === 'line') { s.remove(); applied.push(`נמחק: "${old}"`); }
      else notes.push(`לא נמחק אוטומטית — יש לבדוק: "${old}"`);
    }
    let anchor = h.anchor;
    for (const add of h.added.slice(pairs)) {
      const s = anchor != null ? find(slots(item), anchor) : null;
      if (s && s.type === 'line') { s.insertAfter(add); applied.push(`נוסף: "${add}"`); anchor = add; }
      else if (s && s.insertFirst) { s.insertFirst(add); applied.push(`נוסף: "${add}"`); anchor = add; }
      else notes.push(`לא נוסף אוטומטית — יש לשבץ ידנית: "${add}"`);
    }
  }
  return { item, applied, notes };
}

// ── index.html items ────────────────────────────────────────────────────

function loadIndex() {
  const raw = fs.readFileSync(indexPath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const items = {};
  lines.forEach((l, i) => {
    const m = l.match(/^(window\.dynamicDocs\[(["'])(.*?)\2\]\s*=\s*)(.*);$/);
    if (!m) return;
    let d; try { d = JSON.parse(m[4]); } catch { return; }
    const code = (/formatted-source\/([A-Z]-\d{2,3})\.docx/.exec((d.source && d.source.url) || '') || [])[1];
    if (code && !items[code]) items[code] = { d, line: i, prefix: m[1] };
  });
  return { raw, eol, lines, items };
}
function saveIndex(ix, note) {
  let out = ix.lines.join(ix.eol);
  const ver = out.match(/var NB_SEED_VERSION = (\d+);[^\r\n]*/);
  out = out.replace(ver[0], `var NB_SEED_VERSION = ${Number(ver[1]) + 1}; // ${note}`);
  fs.writeFileSync(indexPath, out);
  return Number(ver[1]) + 1;
}
const itemFields = d => ({ kind: d.kind, topic: d.topic, desc: d.desc, tags: d.tags, stages: d.stages, body: d.body || null });

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  const ix = loadIndex();
  if (publishCode) {
    const e = ix.items[publishCode];
    if (!e) throw new Error(`No app item links to formatted-source/${publishCode}.docx.`);
    const d = e.d, r = d.revision;
    if (!r) throw new Error(`${publishCode} has no proposed version to publish.`);
    ['kind', 'topic', 'desc', 'tags', 'stages'].forEach(f => { if (r.item[f] !== undefined) d[f] = r.item[f]; });
    if (r.item.body) d.body = r.item.body; else delete d.body;
    d.status = 'published'; d.publishedAt = Date.now(); d.updatedAt = Date.now();
    delete d.revision;
    ix.lines[e.line] = e.prefix + JSON.stringify(d) + ';';
    const v = saveIndex(ix, `${publishCode}: approved proposed version published`);
    console.log(`${publishCode}: the approved version is now the published item (NB_SEED_VERSION ${v}).`);
    return;
  }

  const files = fs.readdirSync(docsDir).filter(n => /^[A-Z]-\d{2,3}\.docx$/.test(n)).sort();
  const snapshot = fs.existsSync(snapshotFile) ? JSON.parse(fs.readFileSync(snapshotFile, 'utf8')) : { docs: {} };
  const now = {};
  for (const n of files) now[n.slice(0, -5)] = contentLines(paragraphs(path.join(docsDir, n)));

  if (baseline || !fs.existsSync(snapshotFile)) {
    fs.writeFileSync(snapshotFile, JSON.stringify({ takenAt: new Date().toISOString(), docs: now }));
    console.log(`Snapshot of ${files.length} formatted documents taken. The next check compares against it.`);
    return;
  }

  const changed = Object.keys(now).filter(c => !snapshot.docs[c] || JSON.stringify(snapshot.docs[c]) !== JSON.stringify(now[c]));
  console.log(`Last check: ${snapshot.takenAt}. Documents: ${files.length}. Changed: ${changed.length}.`);
  if (!changed.length) return;

  const proposals = [];
  for (const code of changed) {
    const e = ix.items[code];
    console.log(`\n== ${code}${e ? ` · ${String(e.d.topic).replace(/<[^>]+>/g, '').replace(/^[A-Z]-\d+\s*·\s*/, '')}` : ''}`);
    if (!snapshot.docs[code]) { console.log('   new document — no earlier version to compare; added to the snapshot.'); proposals.push({ code, newDoc: true }); continue; }
    const hunks = diff(snapshot.docs[code], now[code]);
    hunks.forEach(h => { h.removed.forEach(l => console.log(`   - ${l}`)); h.added.forEach(l => console.log(`   + ${l}`)); });
    if (!e) { console.log('   (no app item links to this document)'); proposals.push({ code }); continue; }
    const base = e.d.revision ? e.d.revision.item : itemFields(e.d);
    const res = applyHunks(base, hunks);
    res.applied.forEach(a => console.log(`   ✓ ${a}`));
    res.notes.forEach(a => console.log(`   ⚠ ${a}`));
    if (e.d.revision) console.log('   (added to the proposed version already pending for this item)');
    proposals.push({ code, e, res });
  }

  if (!write) { console.log('\nNothing written. Run with --write to add these proposed versions.'); return; }
  let added = 0;
  for (const p of proposals) {
    snapshot.docs[p.code] = now[p.code];
    if (!p.e || !p.res || (!p.res.applied.length && !p.res.notes.length)) continue;
    const d = p.e.d, prev = d.revision;
    d.revision = {
      item: p.res.item,
      issues: (prev ? prev.issues || [] : []).concat(p.res.applied.map(a => `שינוי מהמסמך המעוצב — ${a}`), p.res.notes),
      source: d.source, createdAt: Date.now(), builtIn: true
    };
    ix.lines[p.e.line] = p.e.prefix + JSON.stringify(d) + ';';
    added++;
  }
  snapshot.takenAt = new Date().toISOString();
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshot));
  if (added) {
    const v = saveIndex(ix, `proposed versions from the changes check (${proposals.filter(p => p.e).map(p => p.code).join(', ')})`);
    console.log(`\n${added} proposed version(s) added (NB_SEED_VERSION ${v}). Snapshot updated.`);
  } else console.log('\nSnapshot updated. No proposed versions to add.');
}

main();
