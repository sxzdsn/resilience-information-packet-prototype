To do: publisher interface is claude, if there's more usage I'll take the time to refine.

# Resilience Info Packet Publisher

[View the live project](https://sxzdsn.github.io/resilience-information-packet-prototype/)

This is a little one-off tool I made for Resilience, a victim advocacy nonprofit based in Chicago. They help people who come into the ER understand the process and their rights, so there are a lot of important details to pass along in an information packet.

For this project:

- I did an IA pass on their existing content to consolidate information and organize it into a clear, readable hierarchy, keeping in mind the not-ideal, sensitive state the intended reader may be in.

- I designed a black-and-white, hospital printer-friendly template with ample negative space in each section for the advocate, nurse, or reader to write down notes or any information not covered in the content.

- I made Resilience Chicago this Info Packet Publishing tool to streamline their existing process so the org and its volunteers could maintain the information packet without bottlenecks.

  - **Before:** Resilience teammates used a source-of-truth Google Doc to align on copy and content. Once the copy was finalized, one of the tech-savvier volunteers would note all the changes, manually apply each change in Canva, and then export the packet.

  - **Now:** Updating the content takes two simple steps: open the tool and export the PDF.

    - The tool automatically loads the latest content from their Google Doc.
    - I mapped the Google Docs styles they were already using—Heading 1, Heading 2, Heading 3, tables, etc.—to the designed styles in the template.
    - I added simple plain-text directives to the document—such as `[page break]` and `[this picture should be inline]`—so they could control the composition when needed.

## License

The source code for this tool is open source under the [GNU Affero General Public License v3.0 or later](LICENSE). If someone modifies the tool and makes it available over a network, they must also make the source code for their modified version available under the same license.

Resilience Chicago’s packet content, name, branding, design assets, reference imagery, and third-party fonts or artwork are not included in this license. See [NOTICE.md](NOTICE.md) for details.

## Agent notes

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

The local server provides a same-origin proxy for Google Docs' HTML export. The GitHub Pages build uses the scoped Cloudflare Worker at <https://resilience-packet-google-doc-proxy.steph-design.workers.dev>; its browser access is restricted to this project's GitHub Pages origin. Documents must be shared so anyone with the link can view them; private documents would require an authenticated Google API integration. Heading 1 becomes a chapter; immediately adjacent Normal text becomes its optional subtitle, while a blank paragraph after Heading 1 skips the subtitle and begins the chapter body. Heading 2 becomes a section, Heading 3 a nested section, and paragraphs, lists, links, inline emphasis, tables, and embedded images are preserved. Imported images become draggable page overlays by default; a standalone `[this picture should be inline]` line immediately before an image keeps that image in document flow. A red `[page break]` line forces the following content onto a new page. The illustration library is built exclusively from images in the imported Google Doc. Google Docs tables become the gray packet card grid shown in the style guide; a red `[outline table]` line immediately before a table preserves it as the outlined content-table treatment instead. A red `[block]` line immediately before a bulleted or numbered list or a table converts each top-level item or table row into left-column text and its nested items into right-column text. `[block]` and `[outline table]` can be stacked before the same source block to use the paired content mapping with the outlined table treatment. Red `[Cover]`, `[Summary Graphic]`, and `[Letter]` lines select the three special templates and remain hidden in the output; fully italicized paragraphs within `[Letter]` are converted into its lower, smaller supporting-notes section without retaining italics. Special-page content is separated automatically, and other red editorial text is omitted.

Deploy Worker updates from the repository root with:

```sh
npx --yes wrangler@latest deploy --config worker/wrangler.toml
```

The dependency-free runtime is split by responsibility: `google-doc-import.js` adapts exported Google Docs HTML, `app.js` builds and paginates the semantic model, `figma-comparison.js` owns comparison-only frame decoration, and `packet-content.js` supplies the bundled Figma-aligned fallback content.
