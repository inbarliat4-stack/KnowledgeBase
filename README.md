# wecom Knowledge Base

An internal knowledge base for wecom customer-service agents. Editors create and maintain structured פריטי ידע; agents use the published items to find guidance while helping customers.

Live development version: https://inbarliat4-stack.github.io/KnowledgeBase/

## What users see

Knowledge is organized as content worlds (שירות, טכני, הנדסה, מטה) → topics → knowledge items. The library filters topics by content world, item type and category. Technical topics have their own categories: SIM/eSIM, גלישה, קליטה, שיחות, SMS and חו"ל. Choosing a category or content world sets the item type back to הכל. A topic with a single item opens that item directly. Each item has a code (for example `M-10` or `O-51`) and a format suited to its purpose:

- **M** — guided diagnosis and routing
- **R / S** — handling and specialist procedures
- **O** — system or process instructions
- **E** — escalation guidance
- **T** — call scripts
- **I** — reference information

Each type has its own display, following the display spec for that type: the full title with a type label, the description and the update date; a table of contents; references to other items as clickable boxes showing the item's full title, next to the condition they depend on; and a "דיווח על בעיה / משוב" button. Diagnosis items show every question and referral up front. Handling (R) and specialist (S) items show the source's stages, which the agent can open and close in a full or step-by-step view. Only the source's own stage numbers appear, once, in the title. The text reads as paragraphs, and "כן" / "לא" branches stay with their instructions. In R, a referral stays one sentence with the target as a link in it. Operating items (O, "תפעול") show clickable boxes with the device names after the explanation, then a section per device with its numbered actions and a way back to the device choice, and the closing notes at the end, each marked with an asterisk. Customer wording is set apart, with a copy button. Back from a linked item returns to the same place, with the same stages open. A reference written by name in quotes, without the code, also links when the name is exactly an item's title. Each linked item gets one box per section; a later mention in the same section stays a link in the text. A code that matches no item is marked "להשלמה" instead of becoming a link. The display never changes the content or its order.

Agents search and read published items. Editors can also create, edit, delete, review and manage items, and administrators can also manage content worlds. The entry screen lets you pick a role (מנהל מערכת, עורך תוכן, נציג שירות) to see each view; in this version that is a demo and does not restrict access.

Agents send feedback on an item with "דיווח על בעיה / משוב". Editors see it in the item's "מעקב עריכה" panel and, for all items, in the **משוב** tab of "מעקב מסמכים": a table with the date, item, feedback text and the version the agent read, where each one is marked חדש or טופל and can be exported to Excel. In this version feedback is kept in the browser it was sent from; on WordPress it is to be stored on the server. Each item has a status: draft, pending approval, published, expired or archived. Agents see only published items. The **הנצפות ביותר** filter shows up to ten items most recently opened in the current browser.

## How app items are updated

App items are built from source documents in three stages:

1. **Origin documents.** The original documents sit in the SharePoint folder "מסמכי DOCx מוכנים לפרסום". They are read-only. Editors open them from the item's "מעקב עריכה" panel, which links the origin document (read-only), the formatted document to edit, the published and last edited dates, and a numbered list of the missing details marked in yellow in the formatted document. These links and details come from `node scripts/doc-info.cjs`, which the changes check also runs.
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

- **The app's built-in content** is in `index.html`, one `window.dynamicDocs[…]` entry per item. When built-in content changes, `NB_SEED_VERSION` is increased by one, so browsers that already saved a copy pick up the change. Items approved, rejected or edited in the app keep their version: if their built-in content has since changed, the change arrives as a proposed version to review.
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
