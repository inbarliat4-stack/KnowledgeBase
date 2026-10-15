# wecom knowledge base: WordPress plugin

This plugin turns the wecom knowledge-base prototype into a WordPress plugin. The data that each browser used to keep in `localStorage` (library, trash, version history) moves into the WordPress database, so everyone shares one library.

**Where the source lives.** Everything is in this repository. The front-end is designed in the prototype, `index.html` at the repository root. The plugin is this folder, `wordpress/wecom-kb/`, and `wordpress/build.cjs` copies the prototype's design into it.

```
wecom-kb/
├── wecom-kb.php          ← bootstrap, page template, access control
├── includes/
│   ├── class-store.php      ← DB table wp_wecom_kb_versions (live library + history)
│   ├── class-sanitizer.php  ← server-side cleaning + base64 image → Media Library
│   ├── class-rest.php       ← REST API
│   └── class-admin.php      ← Tools → "wecom מאגר ידע" (status, export, import)
├── templates/
│   ├── app.php           ← full-screen page template
│   └── app-body.html     ← GENERATED: <body> of index.html
└── assets/
    ├── app.css / app.js  ← GENERATED: <style> / <script> of index.html
    └── wp-bridge.js/.css ← hand-written WordPress layer (persistence, read-only mode)
```

## Install

1. Zip this folder as `wecom-kb.zip` (the folder inside the zip must be named `wecom-kb`) and upload it in **Plugins → Add New Plugin → Upload Plugin**, or copy the folder to `wp-content/plugins/wecom-kb/`. From the repository root, `git archive --format=zip --prefix=wecom-kb/ -o wecom-kb.zip HEAD:wordpress/wecom-kb` creates the zip.
2. Activate it. Activation creates the DB table and a page at **/kb/** that uses the template *"wecom – מאגר ידע (מסך מלא)"*. Any other page can use that template too. The page has no public content: the template sends logged-out visitors to the login screen, and the page is left out of the sitemap.
3. Open the page while logged in as an editor. On first load, the built-in content from `index.html` is saved as version #1.
4. To move content people created on the GitHub Pages version, go to **Tools → wecom מאגר ידע → ייבוא**. The page has a console one-liner that exports a browser's `localStorage` to a JSON file. Do this from the browser where the content was created, because that data never left that browser.

## How it works

- **The front-end is the prototype, unchanged.** `build.cjs` copies the CSS, JS and HTML out of `index.html`. `wp-bridge.js` loads right after `app.js` and replaces only the persistence functions (`nbLoadLibrary`, `nbSaveLibrary`, `nbGetHistory`, `nbRestoreHistorySnapshot`). Everything else runs as in the prototype.
- **Design changes stay in `index.html`.** Edit and preview it as before, then run `node wordpress/build.cjs` from the repository root to regenerate this plugin's assets. Never edit the generated files by hand.
- **Data model.** The app works with one JSON document, `{topics, docs, worlds, trash, seedVersion}`. It follows the spec's hierarchy: content world → topic → knowledge items. Each item (`docs[id]`) has a type `kind` (M/R/O/E/S/T/I), `worlds`, `topicIds`, `tags`, `desc` and `owner`. R/S items keep their content in `stages`; the other types use a type-specific `body`, described at the top of the "TYPE-SPECIFIC CONTENT" section in `index.html`. Each save inserts a row in `wp_wecom_kb_versions`. The newest row is the live library, and older rows are the version history (the newest 200 are kept; change this with the `wecom_kb_history_max` filter). History rows now record who made each change.
- **Initial page load** inlines the library into the page (`window.WECOM_KB`), so the app's synchronous start-up code didn't need to change.
- **Concurrent edits.** Every save sends the version it was based on. If someone else saved in between, the server returns `409`, and the editor chooses between keeping their version (the other one stays in history) and reloading the latest.
- **Images.** The prototype embeds pasted images as base64. The server moves them into the Media Library (deduplicated by hash) and stores URLs instead. This includes images inside the rich text of information (I) items.
- **Drafts.** The in-progress "פריט ידע חדש" draft stays in `localStorage`, because it is personal to each editor's browser.

## Source documents → drafts (AI conversion)

Editors can upload a source document (PDF, Word `.docx` or `.txt`, up to 20 MB). Claude converts it into a draft in the app's structure. Nothing reaches agents without an editor's approval (spec §8):

- **New item.** In "פריט ידע חדש", under "יצירת פריט ממסמך מקור", the draft opens in the form with the conversion's notes (contradictions, broken references, open items) and status "ממתין לאישור". The editor picks the topic and worlds and saves.
- **Existing item.** In the item's editor panel, "עדכון ממסמך מקור" stores the conversion as a proposed revision (`doc.revision`) next to the published content, and flags it "נדרשת לבדיקה". The review screen shows both versions side by side, with approve / edit before publishing / reject.
- **Source files.** The original file is kept in the Media Library and linked from the item (`doc.source`).

**Setup:** Tools → wecom מאגר ידע → "המרת מסמכי מקור". Enter an Anthropic API key, or define `WECOM_KB_ANTHROPIC_KEY` in `wp-config.php`, which takes precedence. Without a key the feature stays off and editors see a note.

**How it works** (`includes/class-importer.php`): `POST /wp-json/wecom-kb/v1/import` (edit capability + `upload_files`). PDFs are sent as a base64 `document` block. Word files are converted to structured text on the server (headings, lists, tables, highlighted runs as `⟦…⟧`, comments), which needs PHP's `ZipArchive`. The request uses `claude-opus-5-5` with `output_config.format` (a JSON schema, so the draft always parses), `effort: high`, and `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), which retries a safety-classifier refusal on the recommended fallback model. It's a single non-streaming `wp_remote_post` with a 600 s timeout, so very long documents may need splitting. The endpoint can be redirected with the `wecom_kb_anthropic_endpoint` filter (used for testing).

**Privacy and cost:** the document's content is sent to Anthropic's API. A typical document costs a few cents to tens of cents.

## Permissions

| Who | Capability (filter) | Gets |
|---|---|---|
| Agents | `read` (`wecom_kb_view_cap`) | read-only app: no create, edit, delete, trash, history or world management. Search, guided diagnosis and copy buttons work. Elements with class `nb-edit-only` are hidden. |
| Content editors | `edit_posts` (`wecom_kb_edit_cap`) | full app |
| Admins | `manage_options` | plus Tools → import/export |

Logged-out visitors are redirected to the login page. Read-only is enforced on the server (REST permission checks); hiding the buttons is only cosmetic.

## REST API (`/wp-json/wecom-kb/v1/`)

| Method | Route | Capability | |
|---|---|---|---|
| GET | `library` | view | `{version, library, history}` |
| POST | `library` | edit | body `{state, label, base_version, force}` → `{version, history_item, images}`; `409` on conflict |
| GET | `history` | view | `[{id, ts, label, author}]` |
| GET | `history/{id}` | edit | `{id, library}` |

## Security notes

The prototype renders titles and step texts with `innerHTML`. That was harmless when each person only saw their own browser's data. Now one editor's input runs in everyone else's browser, including admins'. The sanitizer therefore limits ID fields to `[A-Za-z0-9_-]` and runs any text containing markup through `wp_kses_post`. Still, only give `wecom_kb_edit_cap` to trusted staff. A longer-term fix is to move the app's rendering from string concatenation to `textContent`.

## Things to know

- The template deliberately skips `wp_head()`/`wp_footer()`, so theme CSS doesn't clash with the app's design. As a result, plugins that inject scripts through those hooks (for example analytics) won't run on this page. Add them to `templates/app.php` if needed.
- Large pasted images make a large save request. If saves fail with images, raise `post_max_size` / `upload_max_filesize` in PHP. Per-image limit: `wecom_kb_max_image_bytes` (8 MB).
- When the built-in seed content in `index.html` changes, bump `NB_SEED_VERSION` as before. On the next editor visit, the new built-in docs replace the stored ones, and topics created by users are kept. This is the same rule the prototype used.
