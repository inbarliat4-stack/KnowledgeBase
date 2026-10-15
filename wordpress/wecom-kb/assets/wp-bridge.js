/*
 * WordPress bridge for the wecom knowledge base.
 *
 * app.js is the original index.html script, unchanged. It keeps its
 * library, trash and version history in localStorage. This file loads right
 * after it and replaces just those persistence functions so the data lives
 * in WordPress instead, shared by everyone:
 *
 *   nbLoadLibrary            ← reads the library inlined into the page (window.WECOM_KB)
 *   nbSaveLibrary            → POST /wecom-kb/v1/library (queued, conflict-checked)
 *   nbGetHistory             ← server version history (with author names)
 *   nbRestoreHistorySnapshot ← GET /wecom-kb/v1/history/{id}
 *
 * The in-progress "new item" draft (nbSaveDraft/nbLoadDraft) intentionally
 * stays in localStorage: it is personal to each editor's browser.
 *
 * Users without edit rights get a read-only app (see also wp-bridge.css).
 */
(function () {
  'use strict';

  var CFG = window.WECOM_KB || {};
  var version = CFG.version || 0;
  var historyList = (CFG.history || []).slice();
  var HISTORY_LIST_MAX = 100;

  // ── HTTP ────────────────────────────────────────────────────────────────

  function refreshNonce() {
    return fetch(CFG.ajaxUrl + '?action=wecom_kb_nonce', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.success) throw { code: 'logged_out' };
        CFG.nonce = j.data.nonce;
      });
  }

  function api(method, path, body, retried) {
    return fetch(CFG.restUrl + path, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': CFG.nonce },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        // Nonces expire after ~24h; tabs left open overnight need a new one.
        if (!retried && j.code === 'rest_cookie_invalid_nonce') {
          return refreshNonce().then(function () { return api(method, path, body, true); });
        }
        throw { status: r.status, code: j.code, message: j.message, data: j.data };
      });
    });
  }

  // ── Status toast ────────────────────────────────────────────────────────

  var statusEl = null;
  var statusTimer = null;

  function status(kind, html, actions) {
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'wkb-status';
      statusEl.setAttribute('role', 'status');
      document.body.appendChild(statusEl);
    }
    clearTimeout(statusTimer);
    statusEl.className = 'wkb-status wkb-' + kind;
    statusEl.innerHTML = '<span class="wkb-msg">' + html + '</span>';
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      if (a.primary) b.className = 'wkb-primary';
      b.addEventListener('click', a.onClick);
      statusEl.appendChild(b);
    });
    statusEl.hidden = false;
    if (kind === 'saved') {
      statusTimer = setTimeout(function () { statusEl.hidden = true; }, 2000);
    }
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Load ────────────────────────────────────────────────────────────────

  var initialSaveLabel = null;

  // Mirrors the original nbLoadLibrary, but reads the server copy instead of
  // localStorage. Same seed-version rules: when the built-in content in
  // index.html has been updated (NB_SEED_VERSION bumped), the new built-in
  // documents win and topics people created themselves are kept.
  window.nbLoadLibrary = function () {
    var saved = CFG.library;
    if (!saved) {
      // Brand-new install: keep the built-in content and store it as the
      // first version once the app has finished starting.
      initialSaveLabel = 'טעינת תוכן ראשוני';
      return;
    }

    var seedMatches = saved.seedVersion === NB_SEED_VERSION;

    var savedDocs = saved.docs || {};
    window.dynamicDocs = window.dynamicDocs || {};
    Object.keys(savedDocs).forEach(function (k) {
      var isSeedDoc = k.indexOf('pdf_') === 0 || k === 'view-churn-doc';
      if (seedMatches || !isSeedDoc) window.dynamicDocs[k] = savedDocs[k];
    });

    if (Array.isArray(saved.topics) && saved.topics.length) {
      if (seedMatches) {
        TOPICS = saved.topics;
      } else {
        saved.topics.filter(function (t) { return t.id > NB_SEED_MAX_TOPIC_ID; }).forEach(function (t) {
          if (!TOPICS.some(function (x) { return x.id === t.id; })) TOPICS.push(t);
        });
      }
    }

    if (Array.isArray(saved.trash)) nbTrash = saved.trash;

    if (!seedMatches) initialSaveLabel = 'עדכון תוכן מובנה (גרסה ' + NB_SEED_VERSION + ')';
  };

  // Registered after app.js's own DOMContentLoaded handler, so this runs
  // once the built-in documents have been linked to their topics.
  document.addEventListener('DOMContentLoaded', function () {
    if (initialSaveLabel && CFG.canEdit) window.nbSaveLibrary(initialSaveLabel);
  });

  // ── Save ────────────────────────────────────────────────────────────────

  var queue = Promise.resolve();
  var pending = 0;

  function currentState() {
    return JSON.parse(JSON.stringify({
      topics: TOPICS || [],
      docs: window.dynamicDocs || {},
      trash: nbTrash || [],
      seedVersion: NB_SEED_VERSION
    }));
  }

  // The server moves base64 images into the Media Library; swap them for
  // their URLs in memory too, so they aren't re-uploaded on every save.
  function replaceImages(map) {
    if (!map || !Object.keys(map).length) return;
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (typeof v === 'string' && map[v]) o[k] = map[v];
        else if (v && typeof v === 'object') walk(v);
      });
    })({ a: TOPICS, b: window.dynamicDocs, c: nbTrash });
  }

  // Resolves once the state (or a newer one, after a retry) is stored.
  function send(state, label, force) {
    return api('POST', 'library', { state: state, label: label, base_version: version, force: !!force })
      .then(function (res) {
        version = res.version;
        if (res.history_item) {
          historyList.push(res.history_item);
          if (historyList.length > HISTORY_LIST_MAX) historyList = historyList.slice(-HISTORY_LIST_MAX);
        }
        replaceImages(res.images);
        nbUpdateHistoryBadge();
      })
      .catch(function (err) {
        // Hold the queue until the user decides, so later saves don't race
        // past a failed one.
        return new Promise(function (resolve) {
          if (err && err.status === 409) {
            var latest = (err.data && err.data.latest) || {};
            status('error',
              '<strong>' + esc(latest.author || 'משתמש אחר') + '</strong> עדכן/ה את הספרייה בזמן שעבדת'
                + (latest.label ? ' (' + esc(latest.label) + ')' : '') + '.',
              [
                { label: 'שמור את הגרסה שלי', primary: true, onClick: function () {
                  // The other person's version stays in the history.
                  status('saving', 'שומר…');
                  send(currentState(), label, true).then(resolve);
                } },
                { label: 'טען את הגרסה העדכנית', onClick: function () {
                  pending = 0;
                  location.reload();
                } }
              ]);
          } else if (err && (err.code === 'logged_out' || err.status === 401)) {
            status('error', 'פג תוקף ההתחברות. השינוי לא נשמר.', [
              { label: 'התחבר מחדש', primary: true, onClick: function () { pending = 0; location.reload(); } }
            ]);
          } else {
            status('error', 'השמירה נכשלה' + (err && err.message ? ': ' + esc(err.message) : '') + '.', [
              { label: 'נסה שוב', primary: true, onClick: function () {
                status('saving', 'שומר…');
                send(currentState(), label, false).then(resolve);
              } }
            ]);
          }
        });
      });
  }

  window.nbSaveLibrary = function (historyLabel) {
    if (!CFG.canEdit) return;
    // Capture the state now; saves go out one at a time, in order.
    var state = currentState();
    var label = historyLabel || 'עדכון בספרייה';
    pending++;
    status('saving', 'שומר…');
    queue = queue.then(function () { return send(state, label, false); }).then(function () {
      pending--;
      if (!pending) status('saved', 'נשמר ✓');
    });
  };

  window.addEventListener('beforeunload', function (e) {
    if (pending > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ── Version history ─────────────────────────────────────────────────────

  // The original history dialog renders labels as HTML, so escape here.
  window.nbGetHistory = function () {
    return historyList.map(function (h) {
      return {
        id: String(h.id),
        ts: h.ts,
        label: esc(h.label) + (h.author ? ' <span style="color:var(--muted);font-weight:400">· ' + esc(h.author) + '</span>' : '')
      };
    });
  };

  window.nbRestoreHistorySnapshot = function (histId) {
    var snap = historyList.find(function (h) { return String(h.id) === String(histId); });
    if (!snap) return;
    var dateStr = fmtDate(snap.ts);
    nbConfirmGeneric(
      'שחזור גרסה',
      'לשחזר את הספרייה למצב שהיה ב-<strong style="color:var(--navy)">' + dateStr + '</strong>?<br><span style="font-size:12px;color:var(--muted)">כל שינוי שנעשה אחרי הגרסה הזו יוחלף (אך יישמר כגרסה משלו, כך שגם את זה ניתן יהיה לבטל).</span>',
      'שחזר',
      'var(--navy)',
      function () {
        status('saving', 'טוען גרסה…');
        api('GET', 'history/' + encodeURIComponent(snap.id)).then(function (res) {
          var lib = res.library || {};
          TOPICS = lib.topics || [];
          window.dynamicDocs = lib.docs || {};
          renderLibrary('all');
          renderHomeWaves();
          showView('library');
          nbSaveLibrary('שוחזר לגרסה מתאריך ' + dateStr);
          nbUpdateTrashBadge();
          nbOpenHistory();
        }).catch(function (err) {
          status('error', 'טעינת הגרסה נכשלה' + (err && err.message ? ': ' + esc(err.message) : '') + '.');
        });
      }
    );
  };

  // ── Read-only mode (agents without edit rights) ─────────────────────────

  if (!CFG.canEdit) {
    var noop = function () {};
    ['nbEditDoc', 'nbConfirmDeleteDoc', 'nbConfirmDeleteTopic', 'nbOpenTrash', 'nbOpenHistory',
      'nbGoNew', 'nbCreateDoc', 'nbRestoreFromTrash', 'nbPermanentlyDeleteFromTrash'].forEach(function (fn) {
      window[fn] = noop;
    });

    var origShowView = window.showView;
    window.showView = function (id) {
      if (id === 'new') return;
      return origShowView.apply(this, arguments);
    };

    // Topics that have no document yet say "click 'new item' to create it";
    // viewers can't, so just say it isn't written yet.
    var origOpenArticle = window.openArticle;
    window.openArticle = function () {
      var r = origOpenArticle.apply(this, arguments);
      var box = document.querySelector('#article-content .info-box');
      if (box) box.textContent = '📝 מסמך זה עדיין לא נכתב.';
      return r;
    };
  }
})();
