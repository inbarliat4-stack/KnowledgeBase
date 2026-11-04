# How the wecom Knowledge Base works

The platform is an internal knowledge base for customer-service agents. Editors create and maintain structured פריטי ידע; agents use the published content to find guidance while helping customers.

## What users see

Knowledge is organized as content worlds → topics → knowledge items. Items use formats suited to different purposes:

- **M** — guided diagnosis and routing
- **R / S** — handling and specialist procedures
- **O** — system or process instructions
- **E** — escalation guidance
- **T** — call scripts
- **I** — reference information

Agents can search and read published items. Editors can also create, edit, delete, review, and manage them.

The **הנצפות ביותר** filter shows up to ten items most recently opened in the current browser.

## Editing and publishing

Editors can create an item manually or upload a source document. The app saves content as a draft for the editor to check. Drafts and proposed revisions do not replace published content until an editor reviews and approves them.

For an existing item, **העלה טיוטה** uploads a Word (.docx), PDF, or PNG file. The conversion proposes a revision alongside the current item; the editor can compare, edit, approve, or reject it. The original upload is stored in WordPress's Media Library.

## AI document conversion

The WordPress plugin sends uploaded documents to Anthropic's API and converts them into the appropriate item structure. Word files are converted to text on the server; PDFs and PNGs are sent as documents or images. The editor selects the item's topic and content world for a new item, and checks the generated content and any conversion notes.

This feature requires an administrator to configure an Anthropic API key in **Tools → wecom מאגר ידע**. It also requires editor permissions and WordPress's `upload_files` capability. Document content is sent to Anthropic, so the company's data policy should allow that.

## Storage, permissions, and history

In the WordPress plugin, the shared library is stored in the WordPress database. Each save creates a version-history entry, and the app detects conflicting edits so an editor can choose whether to keep their work or reload the latest version. Agents have read-only access; editors can edit; administrators can configure the plugin and manage imports.

The repository's standalone `index.html` is the front-end source. The WordPress plugin assets are generated from it with `build.cjs`. GitHub holds the source; the WordPress site runs the plugin. The latest plugin workflow is documented in the [WordPress plugin README](wordpress/wecom-kb/README.md).
