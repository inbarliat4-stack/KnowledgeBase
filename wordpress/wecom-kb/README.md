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

## What's new in 1.5.0 (12.11.2026)

The changes come from `index.html` as usual; the plugin's PHP is unchanged apart from the version number.

- **New look.** The design follows the Astryx playground (a local design test, not part of the plugin). Styles only, every feature works as before:
  - **Top bar:** light, with a light search field, and the role shown with an outlined "החלף" button.
  - **Library:** filter rows with aligned labels and quiet buttons (grey when selected).
  - **Topic cards:** more room, a soft shadow and a grey hover. The coloured category stripe stays.
  - **Icons:** orange line icons for categories (an aeroplane for חו"ל) instead of emoji.
  - **Item-type tags:** M purple, R orange, O blue, E yellow, S turquoise, T green, I grey, on the filters and the cards.
  - **Side menu:** a grey current page and orange counts.
  - **In-app tabs:** roomier, with a soft shadow under the pinned strip.
  - **Entry screen** (GitHub only): logo above a white card on light grey, and roles as stacked cards with line icons.
- **Numbering.** Steps show a small bullet instead of a blue numbered circle. Section titles keep their numbers: O-56's titles have the original Word document's numbers 1–5. Only the side-menu table of contents is unnumbered; the one on the item page (narrow screens) is numbered again. A step beside a reference box now lines up with its bullet.
- **Content.** `NB_SEED_VERSION` is now 73: the O items' step sections were re-marked and O-56's titles numbered. On the first visit, the built-in content is refreshed by the usual rule (items people created or edited in the app are kept).
- **Addresses.** Unchanged on WordPress (`/kb/O-50-sim-activation`). The GitHub version now uses the same names after `#` (`#item=O-50-sim-activation`), and old `#item=kbd_…` links still work.

## What's new in 1.4.0 (11.11.2026)

**Readable addresses.** Every screen has a real address under the knowledge base page, instead of `/kb/#item=kbd_o10`:

| Screen | Address |
|---|---|
| Item | `/kb/O-50-sim-activation`: the item's code + a short English name |
| Topic | `/kb/topic/no-mobile-data` |
| Library | `/kb/` |
| Document tracking / new item | `/kb/tracking`, `/kb/new` |
| Proposed version | `/kb/review/O-50-sim-activation` |

- **How it works.** The plugin adds a rewrite rule that sends every address under the knowledge base page to that page (and stops WordPress from redirecting it back to `/kb/`); the boot data carries the page's address (`baseUrl`), and the app reads the rest. WordPress's stored rules refresh by themselves after the update.
- **Links don't break.** Items are found by their code, so `/kb/O-50`, a wrong or changed English name, and old `#item=…` links all open the item; the address bar then shows the readable form. The English names are in `NB_ITEM_SLUGS` and `NB_TOPIC_SLUGS` in `index.html`; a new item with a code gets `/kb/<code>` until a name is added there.
- **Requirements.** Pretty permalinks (any setting other than "Plain"), and the knowledge base page is the one the plugin created (`wecom_kb_page_id`). With plain permalinks the app keeps `#item=…` addresses. The GitHub version always uses `#item=…`.
- **Tested** on a local WordPress (WordPress Playground): direct addresses, links inside items, the browser's Back button, topics, the library, tracking and old `#item=` links.

## What's new in 1.3.0 (11.11.2026)

The front-end changes come from `index.html` as usual; the plugin's PHP is unchanged apart from the version number.

- **Library filters.** Technical topics have their own categories: SIM/eSIM, גלישה, קליטה, שיחות, SMS and חו"ל. Choosing a category or content world sets the item type back to "הכל". A topic with a single item opens that item directly.
- **References.** A document named in quotes without its code links to the item with that exact title. Each linked item gets one reference box per section.
- **Item page.** The table of contents has no automatic numbering.
- **Tabs inside the app.** A ↗ icon on reference boxes, diagnosis answers, item cards and search results opens the item in a tab of the app's own tab strip, pinned under the top bar, while the current page stays as it is. Each tab keeps its screen, open stages and scroll position; tabs are kept per browser tab in `sessionStorage`. The wecom logo returns to the library with no search or filters and closes every tab.
- **Feedback tab.** "מעקב מסמכים" has a "משוב" tab listing agents' feedback ("דיווח על בעיה / משוב") with a חדש / טופל toggle and Excel export. See *Before go-live*: feedback isn't stored on the server yet.
- **Content world "מטה".** A built-in world for HQ guides. A world with the same name that someone created by hand is merged into it, and built-in worlds added later reach saved libraries. Two HQ guides, O-200 (נוהל העברת בעלות) and O-201 (סיכום מדריכי חישובי נתונים), arrive as pending approval.
- **Content since 1.2.** Items now come from formatted source documents and are published after an editor's approval. The editor panel ("מעקב עריכה") links each item's origin document and formatted document and lists the missing details. `NB_SEED_VERSION` is now 72, so on the first editor visit the built-in content is refreshed by the usual rule (items people created or edited in the app are kept).

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

Editors can upload a source document (PDF, PNG, Word `.docx` or `.txt`, up to 20 MB). Claude converts it into a draft in the app's structure. Nothing reaches agents without an editor's approval (spec §8):

- **New item.** In "פריט ידע חדש", under "יצירת פריט ממסמך מקור", the draft opens in the form with the conversion's notes (contradictions, broken references, open items) and status "ממתין לאישור". The editor picks the topic and worlds and saves.
- **Existing item.** Use "העלה טיוטה" beside the item's edit/delete buttons, or "עדכון ממסמך מקור" in its editor panel. The conversion is stored as a proposed revision (`doc.revision`) next to the published content and flagged "נדרשת לבדיקה". The review screen shows both versions side by side, with approve / edit before publishing / reject.
- **Source files.** The original file is kept in the Media Library and linked from the item (`doc.source`).

**Setup:** Tools → wecom מאגר ידע → "המרת מסמכי מקור". Enter an Anthropic API key, or define `WECOM_KB_ANTHROPIC_KEY` in `wp-config.php`, which takes precedence. Without a key the feature stays off and editors see a note.

**How it works** (`includes/class-importer.php`): `POST /wp-json/wecom-kb/v1/import` (edit capability + `upload_files`). PDFs are sent as a base64 `document` block; validated PNG images are sent as base64 `image` blocks. Word files are converted to structured text on the server (headings, lists, tables, highlighted runs as `⟦…⟧`, comments), which needs PHP's `ZipArchive`. The request uses `claude-opus-5-5` with `output_config.format` (a JSON schema, so the draft always parses), `effort: high`, and `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), which retries a safety-classifier refusal on the recommended fallback model. It's a single non-streaming `wp_remote_post` with a 600 s timeout, so very long documents may need splitting. The endpoint can be redirected with the `wecom_kb_anthropic_endpoint` filter (used for testing).

**Privacy and cost:** the document's content is sent to Anthropic's API. A typical document costs a few cents to tens of cents.

## Permissions

**Not active in the current deployment.** The platform the plugin is installed on handles sign-in itself, so the WordPress roles below don't apply there and everyone sees all content, drafts and pending items included. The table describes what the plugin enforces on a site where WordPress roles are used.

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

## Before go-live

- **Feedback stays in the browser.** Feedback is still saved in the sending browser's `localStorage`, so the "משוב" tab shows only feedback sent from the same browser. It needs a REST route and storage on the server before editors see everyone's feedback.
- **Approving on WordPress is untested.** The approve / reject flow has only been tested against a stand-in server, because no PHP or WordPress was available. Test it on the real site before relying on it.
- **New proposals arrive with plugin updates.** Proposed versions built from the formatted source documents reach WordPress only when a new plugin version is uploaded.
- **Document links point to OneDrive.** The editor panel's links to origin and formatted documents open in the company OneDrive / SharePoint, so editors need access there.

## Things to know

- The template deliberately skips `wp_head()`/`wp_footer()`, so theme CSS doesn't clash with the app's design. As a result, plugins that inject scripts through those hooks (for example analytics) won't run on this page. Add them to `templates/app.php` if needed.
- Large pasted images make a large save request. If saves fail with images, raise `post_max_size` / `upload_max_filesize` in PHP. Per-image limit: `wecom_kb_max_image_bytes` (8 MB).
- When the built-in seed content in `index.html` changes, bump `NB_SEED_VERSION` as before. On the next editor visit, the new built-in docs replace the stored ones, and topics created by users are kept. This is the same rule the prototype used.
