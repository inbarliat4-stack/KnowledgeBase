// Splits the standalone ../index.html into the plugin's front-end assets so
// the design can keep being edited in index.html and re-synced into
// WordPress with a single command:  node wordpress/build.cjs
//
// Generated (do not edit by hand — they are overwritten on every build):
//   wecom-kb/assets/app.css        ← the <style> block
//   wecom-kb/assets/app.js         ← the <script> block
//   wecom-kb/templates/app-body.html ← everything inside <body>
//
// The WordPress-specific behaviour lives in wecom-kb/assets/wp-bridge.js,
// which is hand-written and never touched by this script.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pluginDir = path.join(__dirname, 'wecom-kb');
const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function between(open, close, from) {
  const start = src.indexOf(open, from || 0);
  if (start === -1) throw new Error('Could not find ' + open + ' in index.html');
  const contentStart = src.indexOf('>', start) + 1;
  const end = src.indexOf(close, contentStart);
  if (end === -1) throw new Error('Could not find ' + close + ' in index.html');
  return { content: src.slice(contentStart, end), end: end + close.length };
}

const head = between('<head', '</head>');
const headHtml = head.content;

function collect(tag) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = headHtml.indexOf('<' + tag, from);
    if (i === -1) break;
    const contentStart = headHtml.indexOf('>', i) + 1;
    const end = headHtml.indexOf('</' + tag + '>', contentStart);
    out.push(headHtml.slice(contentStart, end).trim());
    from = end;
  }
  return out;
}

const css = collect('style');
const js = collect('script');
const body = between('<body', '</body>', head.end).content.trim();

if (!css.length || !js.length || !body) throw new Error('index.html structure changed — nothing extracted');

const banner = '/* GENERATED from index.html by wordpress/build.cjs — do not edit by hand. */\n';
fs.writeFileSync(path.join(pluginDir, 'assets', 'app.css'), banner + css.join('\n\n') + '\n');
fs.writeFileSync(path.join(pluginDir, 'assets', 'app.js'), banner + js.join('\n;\n') + '\n');
fs.writeFileSync(
  path.join(pluginDir, 'templates', 'app-body.html'),
  '<!-- GENERATED from index.html by wordpress/build.cjs — do not edit by hand. -->\n' + body + '\n'
);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log('app.css       ' + kb(css.join('')));
console.log('app.js        ' + kb(js.join('')));
console.log('app-body.html ' + kb(body));
