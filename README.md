# Resilience Packet Publisher Prototype

Published at <https://sxzdsn.github.io/resilience-packet-prototype/>.

A local, dependency-free browser prototype containing the complete 25-page Figma packet and demonstrating:

- exact US Letter page geometry based on the Figma packet;
- single-page and cover-skipping two-page preview modes;
- a permanently reserved chapter-title band;
- a Google Docs URL importer that fetches a link-shared document and maps its semantic structure into the packet;
- semantic page filling that allows subsections to split between sentences, safe clause breaks, list items, and table rows, while keeping at least two lines of paragraph copy with a heading;
- repeated subsection headings with generated `CONTINUED` badges;
- chapter-aware footers and print-to-PDF output;
- dedicated cover, orientation-card, introductory-letter, and contents templates selected by red bracketed Google Docs directives;
- the full Caregiver, About Resilience, Navigating Emotions, Hospital Visit, Legal Process, At School and Work, and Minors Rights chapters;
- legal Q&A cards, emotion exercises, visual grids, process rows, contact strips, comparison cards, and left-rule callouts.

The design-QA pass uses Figma’s native 612×792 coordinate system directly in CSS pixels, with a 4/3 print zoom for physical US Letter output. Frame-specific variants preserve the packet’s intentional differences in title typeface, content rails, subsection spacing, continuation placement, tables, and interactive layouts.

Figma SVGs are bundled under `assets/icons/` for the website, phone, email, continuation label, and the complete Letter 118 orientation artwork. The prototype does not depend on Figma’s temporary asset URLs at runtime.

The rendered packet follows the exact numbered Figma frame order, `01` through `25`. The reordered run now keeps About Resilience and Navigating Emotions together, and includes the added Orders of Protection, survivor-based immigration, and continued employment pages. The corrected Hospital Visit continuation repeats “The hospital is required to offer you” with a `CONTINUED` badge.

Imported markup is reduced to supported semantic formatting, and PDF export is blocked if an unsplittable block is taller than a page. Print colors are forced to exact mode where the browser supports it.

Run locally:

```sh
python3 server.py 8765
```

Then open `http://localhost:8765/`.

The local server provides a same-origin proxy for Google Docs' HTML export. The GitHub Pages build uses the scoped Cloudflare Worker at <https://resilience-packet-google-doc-proxy.steph-design.workers.dev>; its browser access is restricted to this project's GitHub Pages origin. Documents must be shared so anyone with the link can view them; private documents would require an authenticated Google API integration. Heading 1 becomes a chapter; immediately adjacent Normal text becomes its optional subtitle, while a blank paragraph after Heading 1 skips the subtitle and begins the chapter body. Heading 2 becomes a section, Heading 3 a nested section, and paragraphs, lists, links, inline emphasis, tables, and embedded images are preserved. Imported images become draggable page overlays by default; a standalone `[this picture should be inline]` line immediately before an image keeps that image in document flow. The illustration library is built exclusively from images in the imported Google Doc. Google Docs tables become the gray packet card grid shown in the style guide; a red `[outline table]` line immediately before a table preserves it as the outlined content-table treatment instead. A red `[block]` line immediately before a bulleted or numbered list converts each top-level item into left-column text and its nested item or items into right-column text. Red `[Cover]`, `[Summary Graphic]`, and `[Letter]` lines select the three special templates and remain hidden in the output; fully italicized paragraphs within `[Letter]` are converted into its lower, smaller supporting-notes section without retaining italics. Special-page content is separated automatically, and other red editorial text is omitted.

Deploy Worker updates from the repository root with:

```sh
npx --yes wrangler@latest deploy --config worker/wrangler.toml
```

The dependency-free runtime is split by responsibility: `google-doc-import.js` adapts exported Google Docs HTML, `app.js` builds and paginates the semantic model, `figma-comparison.js` owns comparison-only frame decoration, and `packet-content.js` supplies the bundled Figma-aligned fallback content.
