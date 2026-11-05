# wecom Knowledge Base

An internal knowledge base for wecom customer-service agents. Editors create and maintain structured פריטי ידע; agents use the published items to find guidance while helping customers.

Live development version: https://inbarliat4-stack.github.io/KnowledgeBase/

## What users see

Knowledge is organized as content worlds (שירות, טכני, הנדסה) → topics → knowledge items. Each item has a code (for example `M-10` or `O-51`) and a format suited to its purpose:

- **M** — guided diagnosis and routing
- **R / S** — handling and specialist procedures
- **O** — system or process instructions
- **E** — escalation guidance
- **T** — call scripts
- **I** — reference information

Agents search and read published items. Editors can also create, edit, delete, review and manage items, and administrators can also manage content worlds. The entry screen lets you pick a role (מנהל מערכת, עורך תוכן, נציג שירות) to see each view; in this version that is a demo and does not restrict access.

Each item has a status: draft, pending approval, published, expired or archived. Agents see only published items. The **הנצפות ביותר** filter shows up to ten items most recently opened in the current browser.

## How app items are updated

App items are built from source documents in three stages:

1. **Origin documents.** The original documents sit in the SharePoint folder "מסמכי DOCx מוכנים לפרסום". They are read-only and are never linked from the app.
2. **Formatted source docx.** AI formats each origin into one unified Word document per item, in `formatted-source/` (for example `M-10.docx`). Every formatted document follows the same template: a details table (code, type, topic, content world, owner, status, origin file), numbered steps, editor callouts, a "לבדיקת העורך/ת – פערים והערות" section and a "מקורות" section. Missing information is highlighted in yellow, and the origin's state (מוכן לפרסום, טיוטה – בבדיקה, להשלים) appears in the status field. The formatted documents are editable and open in Word for the web, without downloading.
3. **App items.** Each item links only to its formatted source docx, shown to editors as "מסמך מקור מעוצב". A proposed new version of an item is built from its formatted docx only when requested. It appears alongside the current item, and the editor can compare, edit, approve or reject it. It replaces the published item only after approval.

**העלה טיוטה**, on an existing item, relates to updating its origin document.

In this development version there is no API: Claude Code performs the AI steps locally in this repository, using `scripts/build-formatted-source.cjs`:

```powershell
# All origins: lays out each origin in the template (existing documents are kept)
node scripts/build-formatted-source.cjs "מסמכי DOCx מוכנים לפרסום"
# One item
node scripts/build-formatted-source.cjs "מסמכי DOCx מוכנים לפרסום" --only=O-40
# One item, with content Claude Code formatted from the origin (JSON)
node scripts/build-formatted-source.cjs "מסמכי DOCx מוכנים לפרסום" --only=O-40 --content=O-40.json --force
```

Without `--content`, the script places every line of the origin in the template, highlights missing information, and checks that no origin text was lost. With `--content`, it renders content Claude Code formatted, which can restructure the text into steps, tables and callouts. It then lists the origin lines that were rephrased or left out, so they can be checked. Existing formatted documents are never replaced without `--force`, because editors may have edited them. Empty origin documents are skipped. Origin documents are only read.

### Changes check

When a formatted source docx is edited, the item is updated through a changes check that an editor starts when they choose ("Activate changes check in the source docs"). Nothing runs in the background and nothing is committed automatically.

```powershell
# Which formatted documents changed since the last check, and the proposed version for each (writes nothing)
node scripts/check-source-changes.cjs
# Add those proposed versions to the items and update the snapshot
node scripts/check-source-changes.cjs --write
# After an editor approves a proposed version in the app: publish it
node scripts/check-source-changes.cjs --publish=O-50
```

The check compares each document's content with its snapshot from the last check (`formatted-source/.changes-check-snapshot.json`, kept out of git), so edits are found whenever and by whomever they were made. A proposed version applies only the lines that changed, so the rest of the item stays as it is. Lines it cannot place are listed in the proposal's notes. Proposed versions appear to editors beside the published version and are never shown to agents before approval. After `--write` or `--publish`, run `node wordpress/build.cjs`, then commit.

## Where things are stored

- **The app's built-in content** is in `index.html`, one `window.dynamicDocs[…]` entry per item. When built-in content changes, `NB_SEED_VERSION` is increased by one, so browsers that already saved a copy pick up the change.
- **Changes made in the app** are saved in the browser (`localStorage`), including the trash and version history. They are not shared between browsers.
- **Documents are not on GitHub.** The formatted source docx, the drafts and the origin files are kept in the shared OneDrive folder and excluded from git (see `.gitignore`), because this repository and the site are public. Only people with access to that folder can open the document links.

## Project structure

```
KnowledgeBase/
├── index.html          ← the whole app: design, code and built-in content
├── docs/               ← two original pages, linked from two early items
├── shared.css          ← styles for the pages in docs/
├── scripts/
│   ├── build-formatted-source.cjs  ← builds formatted source docx from origins
│   └── check-source-changes.cjs    ← changes check: proposed versions from edited docx
├── wordpress/          ← WordPress plugin version of the app
│   ├── build.cjs       ← copies index.html into the plugin's assets
│   └── wecom-kb/       ← the plugin (see its README)
└── .gitignore          ← keeps the document folders off GitHub

Not in git (shared OneDrive folder only):
├── formatted-source/              ← one formatted source docx per item code
├── drafts/                        ← earlier drafts
└── מסמכי DOCx מוכנים לפרסום/      ← local copy of the read-only origin documents
```

## WordPress plugin

`wordpress/wecom-kb/` packages the same app as a WordPress plugin, with a shared library in the WordPress database and AI conversion through Anthropic's API. Its assets are generated from `index.html` with `node wordpress/build.cjs`, which does not zip the plugin. Adapting the plugin to the source-document workflow above is a separate, later task. See the [plugin README](wordpress/wecom-kb/README.md).
