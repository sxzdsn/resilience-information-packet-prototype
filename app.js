import { filterImportedContent, transformGoogleDocExport } from "./google-doc-import.js?v=20260804-02";
import { getLegacyFrameClass, makePageComparisons } from "./figma-comparison.js?v=20260713-01";

const sampleSource = window.RESILIENCE_PACKET_SOURCE;
const googleDocsProxyEndpoint = window.location.hostname === "sxzdsn.github.io"
  ? "https://resilience-packet-google-doc-proxy.steph-design.workers.dev/api/google-doc"
  : "/api/google-doc";
const quickLinkTargets = [
  "https://docs.google.com/document/d/1zk0gfmfr4DiEXf68XUmp9tf-lK19oaz2QLYEo_Yytxo/edit?tab=t.nn8dmo3ghr8e",
  "https://docs.google.com/document/d/1itQWoODToJypsL2GoAwpNdcs5thXu9Nwfc0JJC5DNT4/edit?tab=t.nn8dmo3ghr8e",
];
const documentTitleCache = new Map();
const isPublishedPacket = window.location.hostname === "sxzdsn.github.io";

const els = {
  shell: document.querySelector(".app-shell"),
  figmaToggle: document.querySelector("#toggleFigma"),
  preview: document.querySelector(".preview-panel"),
  previewMain: document.querySelector(".preview-main"),
  spreadToggle: document.querySelector("#toggleSpread"),
  docsUrl: document.querySelector("#docsUrl"),
  docsLink: document.querySelector("#openDocsLink"),
  docsLinkPreview: document.querySelector("#docsLinkPreview"),
  docsPreviewFrame: document.querySelector("#docsPreviewFrame"),
  docsPreviewTitle: document.querySelector("#docsPreviewTitle"),
  quickLinkSection: document.querySelector("#quickLinkSection"),
  quickLink: document.querySelector("#quickLink"),
  source: document.querySelector("#docsSource"),
  importButton: document.querySelector("#importButton"),
  refreshButton: document.querySelector("#refreshButton"),
  importSummary: document.querySelector("#importSummary"),
  illustrationLibrary: document.querySelector("#illustrationLibrary"),
  saveIllustrations: document.querySelector("#saveIllustrations"),
  illustrationSupportEmail: document.querySelector("#illustrationSupportEmail"),
  illustrationSaveStatus: document.querySelector("#illustrationSaveStatus"),
  pages: document.querySelector("#pages"),
  warnings: document.querySelector("#renderWarnings"),
  printBlocker: document.querySelector("#printBlocker"),
  measurement: document.querySelector("#measurementStage"),
  zoom: document.querySelector("#zoomRange"),
  zoomValue: document.querySelector("#zoomValue"),
  printButton: document.querySelector("#printButton"),
};

if (isPublishedPacket) els.figmaToggle.hidden = true;

let documentModel = { chapters: [] };
let previewCenterFrame;
const illustrationPositions = new Map();
const illustrationWidths = new Map();
const illustrationLibrary = [];
const placedIllustrations = [];
let illustrationSequence = 0;
let savedPlacementsRestored = false;
const illustrationStorageKey = "resilience-packet-illustrations-v1";
const illustrationLayoutVersion = 3;
const defaultIllustrationLayouts = new Map([
  ["illustration-2-1qhlv9t", { frame: "15", left: 409.34, top: 576.68, width: 190.35 }],
  ["illustration-3-1u88zji", { frame: "16", left: 448.75, top: 603.27, width: 135.3 }],
  ["illustration-4-tlve7u", { frame: "18", left: 421.29, top: 88.78, width: 157.63 }],
  ["illustration-5-1on3w24", { frame: "21", left: 394, top: 49, width: 167.72 }],
]);
const defaultPlacedIllustrations = [
  {
    id: "placed-3",
    assetId: "document-asset-1qhlv9t",
    frame: "14",
    x: 411.3,
    y: 41.04,
    width: 132,
  },
  {
    id: "placed-2",
    assetId: "document-asset-1u88zji",
    frame: "17",
    x: 435.17,
    y: 50.94,
    width: 132,
  },
];
const defaultPlacedIllustrationIds = new Set(defaultPlacedIllustrations.map(({ id }) => id));
const hiddenIllustrationIds = new Set([
  "illustration-2-1qhlv9t",
  "illustration-3-1u88zji",
]);
const pendingSavedPlacements = defaultPlacedIllustrations.map((placement) => ({ ...placement }));
illustrationSequence = Math.max(
  illustrationSequence,
  ...defaultPlacedIllustrations.map(({ id }) => Number(id.match(/placed-(\d+)$/)?.[1] || 0)),
);

function centerPreviewPages() {
  window.cancelAnimationFrame(previewCenterFrame);
  previewCenterFrame = window.requestAnimationFrame(() => {
    const maxScrollLeft = els.previewMain.scrollWidth - els.previewMain.clientWidth;
    els.previewMain.scrollLeft = Math.max(0, maxScrollLeft / 2);
  });
}
let isLiveDocument = false;
let importedSpecialPages = [];

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function stableId(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function googleDocsProxyUrl(value) {
  const docsUrl = normalizeGoogleDocsUrl(value);
  if (!docsUrl) return "";
  const proxyUrl = new URL(googleDocsProxyEndpoint, window.location.href);
  proxyUrl.searchParams.set("url", docsUrl);
  return proxyUrl.toString();
}

function googleDocumentId(value) {
  try {
    const url = new URL(value.trim());
    const match = url.pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]+)/);
    return url.hostname === "docs.google.com" ? match?.[1] || "" : "";
  } catch {
    return "";
  }
}

function quickLinkTarget(value) {
  const currentId = googleDocumentId(value);
  const currentIndex = quickLinkTargets.findIndex((target) => googleDocumentId(target) === currentId);
  return currentIndex < 0 ? "" : quickLinkTargets[(currentIndex + 1) % quickLinkTargets.length];
}

function metadataProxyUrl(value) {
  const proxyUrl = googleDocsProxyUrl(value);
  if (!proxyUrl) return "";
  const url = new URL(proxyUrl);
  url.searchParams.set("metadata", "1");
  return url.toString();
}

async function fetchDocumentTitle(value) {
  const documentId = googleDocumentId(value);
  if (!documentId) return "";
  if (documentTitleCache.has(documentId)) return documentTitleCache.get(documentId);
  try {
    const response = await fetch(metadataProxyUrl(value), { headers: { Accept: "application/json" } });
    if (!response.ok) return "";
    const payload = await response.json();
    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    if (title) documentTitleCache.set(documentId, title);
    return title;
  } catch {
    return "";
  }
}

async function refreshDocumentTitles(value) {
  const normalized = normalizeGoogleDocsUrl(value);
  if (!normalized) return;
  const target = quickLinkTarget(normalized);
  const [currentTitle, targetTitle] = await Promise.all([
    fetchDocumentTitle(normalized),
    target ? fetchDocumentTitle(target) : Promise.resolve(""),
  ]);
  if (normalizeGoogleDocsUrl(els.docsUrl.value) !== normalized) return;
  els.docsPreviewTitle.textContent = currentTitle || "Google Doc preview";
  if (target && els.quickLink.dataset.targetUrl === target) {
    els.quickLink.textContent = targetTitle || "Google Doc";
  }
}

function syncDocsPreview(value = els.docsUrl.value) {
  const previewUrl = googleDocsProxyUrl(value);
  els.docsLinkPreview.hidden = !previewUrl;
  if (previewUrl && els.docsPreviewFrame.src !== previewUrl) els.docsPreviewFrame.src = previewUrl;
  if (!previewUrl) els.docsPreviewFrame.removeAttribute("src");
  const documentId = googleDocumentId(value);
  els.docsPreviewTitle.textContent = documentTitleCache.get(documentId) || "Loading document…";
  syncQuickLink(value);
  if (previewUrl) void refreshDocumentTitles(value);
}

function syncQuickLink() {
  els.quickLinkSection.hidden = true;
}

function safeImageSource(value) {
  return /^(?:https:\/\/|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,)/i.test(value || "");
}

function isStandaloneWebsite(value) {
  return /^(?:(?:https?:\/\/|www\.)\S+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)$/i.test(value.trim());
}

function cleanHtml(node) {
  const clone = node.cloneNode(true);
  const allowedTags = new Set(["A", "B", "BR", "EM", "I", "IMG", "LI", "OL", "P", "SPAN", "STRONG", "U", "UL"]);
  const allowedTextAlignments = new Set(["left", "center", "right", "justify", "start", "end"]);
  clone.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((child) => child.remove());
  [...clone.querySelectorAll("*")].forEach((child) => {
    if (!allowedTags.has(child.tagName)) {
      child.replaceWith(...child.childNodes);
      return;
    }

    if (child.tagName === "IMG") {
      [...child.attributes].forEach((attribute) => {
        if (!["alt", "height", "src", "width"].includes(attribute.name.toLowerCase())) child.removeAttribute(attribute.name);
      });
      if (!safeImageSource(child.getAttribute("src"))) child.remove();
      return;
    }

    [...child.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const preservesAlignment = name === "data-text-align"
        && allowedTextAlignments.has(attribute.value.toLowerCase());
      if ((child.tagName !== "A" || name !== "href") && !preservesAlignment) {
        child.removeAttribute(attribute.name);
      }
    });

    if (child.tagName === "A") {
      const href = child.getAttribute("href") || "";
      if (!/^(https?:|mailto:|tel:)/i.test(href)) child.removeAttribute("href");
    }
  });
  return clone.innerHTML.trim();
}

function cleanHeadingHtml(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll("strong,b,em,i,u").forEach((wrapper) => {
    wrapper.replaceWith(...wrapper.childNodes);
  });
  return cleanHtml(clone);
}

function sanitizeHtmlString(html) {
  const container = document.createElement("span");
  container.innerHTML = html || "";
  return cleanHtml(container);
}

function safeLinkHref(value) {
  const candidate = (value || "").trim();
  if (!candidate) return "";
  if (/^#[a-z][\w:-]*$/i.test(candidate)) return candidate;
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(candidate)) return `mailto:${candidate}`;
  if (/^(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}$/.test(candidate)) {
    const prefix = candidate.startsWith("+") ? "+" : "";
    return `tel:${prefix}${candidate.replace(/\D/g, "")}`;
  }

  let normalized = candidate;
  if (/^(?:www\.)?(?:[a-z0-9-]+\.)+(?:org|com|net|edu)(?:\/\S*)?$/i.test(normalized)) {
    normalized = `https://${normalized}`;
  }
  if (/^(?:mailto:|tel:)/i.test(normalized)) return normalized;

  try {
    const url = new URL(normalized);
    if (!/^https?:$/.test(url.protocol)) return "";
    if (["google.com", "www.google.com"].includes(url.hostname.toLowerCase()) && url.pathname === "/url") {
      return safeLinkHref(url.searchParams.get("q") || url.searchParams.get("url") || "");
    }
    return url.href;
  } catch {
    return "";
  }
}

function contactIconFor(value) {
  const candidate = (value || "").trim();
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(candidate)) return "email.svg";
  if (/^(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}$/.test(candidate)) return "phone.svg";
  return "website.svg";
}

function activateLinks(root) {
  const pattern = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:https?:\/\/|www\.)[^\s<]+|(?:[a-z0-9-]+\.)+(?:org|com|net|edu)(?:\/[^\s<]*)?|(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/gi;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement?.closest("a")) textNodes.push(walker.currentNode);
  }

  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue || "";
    const matches = [...text.matchAll(pattern)];
    if (!matches.length) return;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    matches.forEach((match) => {
      const raw = match[0];
      const linkText = raw.replace(/[.,;:!?]+$/, "");
      const trailing = raw.slice(linkText.length);
      const href = safeLinkHref(linkText);
      fragment.append(document.createTextNode(text.slice(cursor, match.index)));
      if (href) {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.textContent = linkText;
        fragment.append(anchor);
      } else {
        fragment.append(document.createTextNode(linkText));
      }
      if (trailing) fragment.append(document.createTextNode(trailing));
      cursor = match.index + raw.length;
    });
    fragment.append(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  });

  root.querySelectorAll("a[href]").forEach((anchor) => {
    const href = safeLinkHref(anchor.getAttribute("href"));
    if (!href) {
      anchor.removeAttribute("href");
      return;
    }
    anchor.href = href;
    if (/^https?:/i.test(href)) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    } else {
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    }
  });
}

function parseSource() {
  const chapters = [];
  let chapter = null;
  let subsection = null;
  let activeParentId = null;
  let imageIndex = 0;

  const ensureChapter = () => {
    if (!chapter) {
      chapter = { id: "untitled-chapter", title: "Untitled chapter", subsections: [] };
      chapters.push(chapter);
    }
    return chapter;
  };

  const ensureSubsection = () => {
    ensureChapter();
    if (!subsection) {
      subsection = {
        id: `${chapter.id}-body`,
        title: "",
        isUntitled: true,
        blocks: [],
      };
      chapter.subsections.push(subsection);
    }
    return subsection;
  };

  [...els.source.children].forEach((node) => {
    const tag = node.tagName.toLowerCase();
    const text = node.textContent.trim();
    if (!text && !node.dataset.blockType) return;

    if (tag === "h1") {
      const id = slugify(text) || `chapter-${chapters.length + 1}`;
      chapter = { id, title: text, titleHtml: cleanHeadingHtml(node), footerLabel: text, dek: "", subsections: [] };
      chapters.push(chapter);
      subsection = null;
      activeParentId = null;
      return;
    }

    if (tag === "h2" || tag === "h3") {
      ensureChapter();
      const id = `${chapter.id}-${slugify(text) || chapter.subsections.length + 1}`;
      subsection = {
        id,
        level: Number(tag.slice(1)),
        title: text,
        titleHtml: cleanHtml(node),
        depth: tag === "h3" ? 3 : 2,
        parentId: tag === "h3" ? activeParentId : null,
        blankLinesBefore: Number(node.dataset.blankLinesBefore) || 0,
        pageBreakBefore: node.dataset.pageBreakBefore === "true",
        startsContinued: node.dataset.startContinued === "true",
        continuationStyle: ["header", "none"].includes(node.dataset.repeat) ? node.dataset.repeat : "badge",
        blocks: [],
      };
      chapter.subsections.push(subsection);
      if (tag === "h2") activeParentId = id;
      return;
    }

    if (tag === "p" && node.dataset.role === "chapter-dek" && chapter && !subsection) {
      chapter.dek = cleanHtml(node);
      return;
    }

    // A blank paragraph after an H3 is an authoring signal to resume the
    // parent H2 rather than continue the nested callout.
    const breaksOutOfNested = node.dataset.breakOutOfNested === "true"
      || Number(node.dataset.blankLinesBefore) > 0;
    const didBreakOutOfNested = breaksOutOfNested && subsection?.depth === 3;
    if (didBreakOutOfNested) {
      const parentId = subsection.parentId;
      subsection = {
        id: `${chapter.id}-body-${chapter.subsections.length + 1}`,
        title: "",
        isUntitled: true,
        depth: 2,
        parentId,
        blocks: [],
      };
      chapter.subsections.push(subsection);
      activeParentId = parentId;
    }

    const target = ensureSubsection();
    const blockStart = target.blocks.length;
    if (tag === "ul" || tag === "ol") {
      target.blocks.push({
        type: "list",
        ordered: tag === "ol",
        start: tag === "ol" ? Number(node.getAttribute("start")) || 1 : undefined,
        items: [...node.querySelectorAll(":scope > li")].map((li) => cleanHtml(li)),
      });
    } else if (tag === "table") {
      target.blocks.push({
        type: "table",
        outline: node.dataset.tableStyle === "outline",
        importedTable: node.dataset.importedTable === "true",
        rows: [...node.rows].map((row) =>
          [...row.cells].map((cell) => ({
            html: cleanHtml(cell),
            header: cell.tagName.toLowerCase() === "th",
            colspan: cell.colSpan || 1,
            textAlign: cell.dataset.textAlign || "",
          })),
        ),
      });
    } else if (tag === "figure" && node.dataset.blockType === "emotion-exercise") {
      target.blocks.push({
        type: "emotion-exercise",
        prompt: node.querySelector("figcaption")?.textContent.trim() || "",
        items: [...node.querySelectorAll("li")].map((item) => item.textContent.trim()),
        reassurance: node.querySelector("[data-role='reassurance']")?.textContent.trim() || "It’s all valid.",
      });
    } else if (tag === "figure" && node.dataset.blockType === "visual-grid") {
      target.blocks.push({
        type: "visual-grid",
        label: node.querySelector("figcaption")?.textContent.trim() || "",
        count: Number(node.dataset.count) || 6,
      });
    } else if (tag === "figure" && node.dataset.blockType === "doc-image") {
      const image = node.querySelector("img");
      if (image && safeImageSource(image.getAttribute("src"))) {
        imageIndex += 1;
        const src = image.getAttribute("src");
        target.blocks.push({
          type: "image",
          id: `illustration-${imageIndex}-${stableId(src)}`,
          src,
          alt: image.getAttribute("alt") || "",
          caption: node.querySelector("figcaption")?.textContent.trim() || "",
          width: Number(node.dataset.width) || 0,
          height: Number(node.dataset.height) || 0,
          cropWidth: Number(node.dataset.cropWidth) || 0,
          cropHeight: Number(node.dataset.cropHeight) || 0,
          cropLeft: Number(node.dataset.cropLeft) || 0,
          cropTop: Number(node.dataset.cropTop) || 0,
          inline: node.dataset.imageLayout === "inline",
        });
      }
    } else if (node.dataset.blockType === "contact-row") {
      target.blocks.push({
        type: "contact-row",
        items: [...node.children].map((item) => item.textContent.trim()).filter(Boolean),
      });
    } else if (node.dataset.blockType === "resource-link") {
      target.blocks.push({ type: "resource-link", text });
    } else if (node.dataset.blockType === "steps") {
      target.blocks.push({
        type: "steps",
        items: [...node.querySelectorAll("li")].map((item) => cleanHtml(item)),
      });
    } else if (node.dataset.blockType === "paired-blocks") {
      const sourceRows = [...node.querySelectorAll(":scope > [data-paired-row]")];
      const list = node.querySelector(":scope > ul, :scope > ol");
      target.blocks.push({
        type: "paired-blocks",
        outline: node.dataset.tableStyle === "outline",
        rows: sourceRows.length
          ? sourceRows.map((row) => ({
            label: cleanHtml(row.querySelector(":scope > [data-paired-label]")),
            details: [...row.querySelectorAll(":scope > [data-paired-details] > [data-paired-detail]")]
              .map((detail) => cleanHtml(detail)),
          }))
          : [...(list?.children || [])]
            .filter((item) => item.tagName === "LI")
            .map((item) => {
              const label = item.cloneNode(true);
              label.querySelectorAll(":scope > ul, :scope > ol").forEach((nested) => nested.remove());
              const nestedList = item.querySelector(":scope > ul, :scope > ol");
              return {
                label: cleanHtml(label),
                details: [...(nestedList?.children || [])]
                  .filter((detail) => detail.tagName === "LI")
                  .map((detail) => cleanHtml(detail)),
              };
            }),
      });
    } else if (node.dataset.blockType === "callout-group") {
      target.blocks.push({
        type: "callout-group",
        parts: [...node.children].map((part) => {
          if (part.dataset.blockType === "card-grid") {
            return {
              type: "card-grid",
              layout: part.dataset.layout || "columns",
              cards: [...part.querySelectorAll(":scope > article")].map((item) => ({
                html: cleanHtml(item),
                textAlign: item.dataset.textAlign || "",
              })),
            };
          }
          if (part.dataset.blockType === "contact-row") {
            return {
              type: "contact-row",
              items: [...part.children].map((item) => item.textContent.trim()).filter(Boolean),
            };
          }
          if (part.dataset.blockType === "steps") {
            return {
              type: "steps",
              items: [...part.querySelectorAll("li")].map((item) => cleanHtml(item)),
            };
          }
          return { type: "paragraph", html: cleanHtml(part) };
        }),
      });
    } else if (node.dataset.blockType === "card-grid") {
      target.blocks.push({
        type: "card-grid",
        layout: node.dataset.layout || "columns",
        importedTable: node.dataset.importedTable === "true",
        cards: [...node.querySelectorAll(":scope > article")].map((item) => ({
          html: cleanHtml(item),
          textAlign: item.dataset.textAlign || "",
        })),
      });
    } else if (node.dataset.blockType === "section-divider") {
      target.blocks.push({ type: "section-divider" });
    } else if (tag === "blockquote") {
      const hasCalloutTitle = [...node.children].some((child) => (
        child.tagName === "STRONG" || child.tagName === "B"
      ));
      if (hasCalloutTitle) {
        target.blocks.push({ type: "callout", html: cleanHtml(node) });
      } else {
        // Google Docs ends a quoted/nested run with a separate plain blockquote.
        // Treat its children as normal parent-section content rather than extending
        // the left rule from the preceding titled callout.
        [...node.children].forEach((child) => {
          const childTag = child.tagName.toLowerCase();
          if (childTag === "ul" || childTag === "ol") {
            target.blocks.push({
              type: "list",
              ordered: childTag === "ol",
              start: childTag === "ol" ? Number(child.getAttribute("start")) || 1 : undefined,
              items: [...child.querySelectorAll(":scope > li")].map((item) => cleanHtml(item)),
            });
            return;
          }
          const html = cleanHtml(child) || child.textContent.trim();
          if (!html) return;
          target.blocks.push({
            type: "paragraph",
            html,
            hasSoftBreak: /<br\s*\/?\s*>/i.test(html),
          });
        });
      }
    } else if (tag === "p" && isStandaloneWebsite(text)) {
      target.blocks.push({ type: "resource-link", text });
    } else {
      const html = cleanHtml(node) || text;
      target.blocks.push({
        type: "paragraph",
        html,
        // Google Docs Shift+Enter exports as <br>; keep that line break inside one block.
        hasSoftBreak: /<br\s*\/?\s*>/i.test(html),
      });
    }
    // The blank paragraph that exits an H3 describes structure, not a visible
    // spacer, so do not translate it into a rendered margin.
    if (target.blocks.length > blockStart && node.dataset.blankLinesBefore && !didBreakOutOfNested) {
      target.blocks[blockStart].blankLinesBefore = Number(node.dataset.blankLinesBefore) || 0;
    }
    if (target.blocks.length > blockStart && node.dataset.pageBreakBefore === "true") {
      target.blocks[blockStart].pageBreakBefore = true;
    }
  });

  chapters.forEach((item) => {
    item.subsections.forEach((section, index) => {
      const next = item.subsections[index + 1];
      section.anchorsNextHeading = section.depth === 2
        && section.blocks.length === 0
        && next?.depth === 3
        && next.parentId === section.id;
    });
    item.subsections = item.subsections.filter((section) => (
      section.blocks.length > 0
      || section.anchorsNextHeading
      || (section.depth === 2 && !section.isUntitled)
    ));
  });

  const arranged = chapters.filter((item) => item.subsections.length > 0);
  arranged.forEach((item) => {
    const last = item.subsections.at(-1);
    if (last) last.isChapterLast = true;
  });
  return { chapters: arranged };
}

function makeBlock(block) {
  if (block.type === "emotion-exercise") {
    const figure = document.createElement("figure");
    figure.className = "content-block emotion-exercise";
    const prompt = document.createElement("figcaption");
    prompt.className = "emotion-prompt";
    prompt.textContent = block.prompt;
    const list = document.createElement("div");
    list.className = "emotion-pills";
    block.items.forEach((item) => {
      const pill = document.createElement("span");
      pill.className = "emotion-pill";
      pill.textContent = item;
      list.append(pill);
    });
    const reassurance = document.createElement("p");
    reassurance.className = "emotion-reassurance";
    reassurance.textContent = block.reassurance;
    if (block.prompt) figure.append(prompt);
    figure.append(list, reassurance);
    return figure;
  }

  if (block.type === "visual-grid") {
    const figure = document.createElement("figure");
    figure.className = "content-block visual-grid-block";
    if (block.label) {
      const caption = document.createElement("figcaption");
      caption.className = "visual-grid-label";
      caption.textContent = block.label;
      figure.append(caption);
    }
    const grid = document.createElement("div");
    grid.className = "visual-grid";
    for (let index = 0; index < block.count; index += 1) {
      const cell = document.createElement("div");
      cell.className = "visual-grid-cell";
      grid.append(cell);
    }
    figure.append(grid);
    return figure;
  }

  if (block.type === "image") {
    if (block.inline) {
      const figure = document.createElement("figure");
      figure.className = "content-block content-image inline-illustration resizable-inline-illustration";
      figure.dataset.illustrationId = block.id;
      const savedWidth = illustrationWidths.get(block.id);
      const width = savedWidth || block.cropWidth || block.width;
      if (width > 0) figure.style.width = `${width}px`;
      figure.tabIndex = 0;
      figure.setAttribute("aria-label", `${block.alt || "Inline illustration"}. Use the lower-right handle to resize it.`);
      const image = document.createElement("img");
      image.src = safeImageSource(block.src) ? block.src : "";
      image.alt = block.alt || "";
      if (block.cropWidth > 0 && block.cropHeight > 0) {
        const viewport = document.createElement("div");
        viewport.className = "inline-illustration-viewport";
        viewport.style.aspectRatio = `${block.cropWidth} / ${block.cropHeight}`;
        if (block.width > 0) image.style.width = `${(block.width / block.cropWidth) * 100}%`;
        if (block.height > 0) image.style.height = `${(block.height / block.cropHeight) * 100}%`;
        image.style.marginLeft = `${(block.cropLeft / block.cropWidth) * 100}%`;
        image.style.marginTop = `${(block.cropTop / block.cropHeight) * 100}%`;
        viewport.append(image);
        figure.append(viewport);
      } else {
        if (block.width > 0) image.width = block.width;
        if (block.height > 0) image.height = block.height;
        figure.append(image);
      }
      if (block.caption) {
        const caption = document.createElement("figcaption");
        caption.textContent = block.caption;
        figure.append(caption);
      }
      figure.append(makeIllustrationResizeHandle(block.alt || "inline illustration"));
      return figure;
    }

    const anchor = document.createElement("span");
    anchor.className = "illustration-anchor";
    anchor.dataset.illustrationId = block.id || `illustration-${block.src}`;
    anchor.setAttribute("aria-hidden", "true");
    return anchor;
  }

  if (block.type === "contact-row") {
    const row = document.createElement("div");
    row.className = "content-block contact-row";
    block.items.forEach((item, index) => {
      const href = safeLinkHref(item);
      const entry = document.createElement(href ? "a" : "span");
      entry.className = "contact-entry";
      if (href) entry.href = href;
      entry.innerHTML = `<img class="contact-icon" src="assets/icons/${contactIconFor(item)}" alt="">${escapeHtml(item)}`;
      row.append(entry);
    });
    return row;
  }

  if (block.type === "resource-link") {
    const href = safeLinkHref(block.text);
    const row = document.createElement(href ? "a" : "div");
    row.className = "content-block resource-link";
    if (href) row.href = href;
    row.innerHTML = `<img src="assets/icons/website.svg" alt="">${escapeHtml(block.text)}`;
    return row;
  }

  if (block.type === "steps") {
    const steps = document.createElement("div");
    steps.className = "content-block process-steps";
    block.items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "process-step";
      row.innerHTML = `<strong>STEP ${index + 1}</strong><span>${item}</span>`;
      steps.append(row);
    });
    return steps;
  }

  if (block.type === "paired-blocks") {
    const blocks = document.createElement("div");
    blocks.className = "content-block process-steps paired-blocks";
    blocks.classList.toggle("paired-blocks-outline", block.outline === true);
    block.rows.forEach((item) => {
      const row = document.createElement("div");
      row.className = "process-step paired-block";
      const label = document.createElement("strong");
      label.innerHTML = item.label;
      const detail = document.createElement("span");
      detail.className = "paired-block-details";
      item.details.forEach((html) => {
        const line = document.createElement("span");
        line.className = "paired-block-detail";
        const marker = document.createElement("span");
        marker.className = "paired-block-marker";
        marker.textContent = "→";
        const copy = document.createElement("span");
        copy.innerHTML = html;
        line.append(marker, copy);
        detail.append(line);
      });
      row.append(label, detail);
      blocks.append(row);
    });
    return blocks;
  }

  if (block.type === "card-grid") {
    const grid = document.createElement("div");
    grid.className = `content-block card-grid card-grid-${block.layout || "columns"}`;
    grid.classList.toggle("card-grid-imported", block.importedTable === true);
    block.cards.forEach((card) => {
      const article = document.createElement("article");
      article.innerHTML = typeof card === "string" ? card : card.html;
      if (typeof card === "object" && card.textAlign) article.dataset.textAlign = card.textAlign;
      grid.append(article);
    });
    return grid;
  }

  if (block.type === "section-divider") {
    const divider = document.createElement("div");
    divider.className = "content-block section-divider";
    return divider;
  }

  if (block.type === "callout-group") {
    const group = document.createElement("div");
    group.className = "content-block callout callout-group";
    block.parts.forEach((part) => {
      if (part.type === "card-grid" || part.type === "contact-row" || part.type === "steps") {
        group.append(makeBlock(part));
      } else {
        const copy = document.createElement("div");
        copy.className = "callout-copy";
        copy.innerHTML = part.html;
        const strong = copy.querySelector("strong");
        if (strong) {
          strong.classList.add("callout-title");
          if (strong.nextSibling?.nodeName === "BR") strong.nextSibling.remove();
        }
        group.append(copy);
      }
    });
    return group;
  }

  if (block.type === "table") {
    const table = document.createElement("table");
    table.className = "content-block content-table";
    table.classList.toggle("content-table-outline", block.outline === true);
    table.classList.toggle("content-table-imported", block.importedTable === true);
    table.classList.toggle(
      "table-single-column",
      block.rows.length === 3 && block.rows.every((row) => row.length === 1),
    );
    const prompt = plainText(block.rows[0]?.[0]?.html || "");
    if (prompt.startsWith("Make a report to police")) table.classList.add("table-police-report");
    const body = document.createElement("tbody");
    block.rows.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.length > 1 && block.outline !== true) {
        const td = document.createElement("td");
        td.colSpan = row.reduce((sum, cell) => sum + (cell.colspan || 1), 0);
        td.className = "citation-cell";
        const columns = document.createElement("div");
        columns.className = "citation-columns";
        row.forEach((cell) => {
          const column = document.createElement("div");
          column.innerHTML = cell.html;
          if (cell.textAlign) column.dataset.textAlign = cell.textAlign;
          columns.append(column);
        });
        td.append(columns);
        tr.append(td);
      } else row.forEach((cell) => {
        const td = document.createElement(cell.header ? "th" : "td");
        td.innerHTML = cell.html.replace(/<\/strong><br>(?!<br>)/i, '</strong><span class="table-gap"></span>');
        td.colSpan = cell.colspan || 1;
        if (cell.textAlign) td.dataset.textAlign = cell.textAlign;
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(body);
    return table;
  }

  if (block.type === "list") {
    const list = document.createElement(block.ordered ? "ol" : "ul");
    list.className = "content-block content-list";
    if (block.ordered && block.start > 1) list.start = block.start;
    block.items.forEach((item) => {
      const li = document.createElement("li");
      li.innerHTML = item;
      list.append(li);
    });
    return list;
  }

  const element = document.createElement(block.type === "callout" ? "div" : "p");
  element.className = `content-block${block.type === "callout" ? " callout" : ""}`;
  element.innerHTML = block.html;

  if (block.type === "callout") {
    const strong = element.querySelector("strong");
    if (strong) {
      strong.classList.add("callout-title");
      if (strong.nextSibling?.nodeName === "BR") strong.nextSibling.remove();
    }
  }
  return element;
}

function applyIllustrationPosition(illustration, position) {
  illustration.style.setProperty("--illustration-x", `${position.x}px`);
  illustration.style.setProperty("--illustration-y", `${position.y}px`);
}

function createLibraryIllustration(asset) {
  const item = document.createElement("article");
  item.className = "illustration-library-item";
  item.draggable = true;
  item.dataset.illustrationAsset = asset.id;
  item.setAttribute("aria-label", `Drag ${asset.name} onto a packet page`);

  const image = document.createElement("img");
  image.src = asset.src;
  image.alt = asset.name;
  item.append(image);
  item.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-resilience-illustration", asset.id);
    item.classList.add("is-dragging");
  });
  item.addEventListener("dragend", () => item.classList.remove("is-dragging"));
  return item;
}

function renderIllustrationLibrary() {
  els.illustrationLibrary.replaceChildren();
  if (!illustrationLibrary.length) {
    const empty = document.createElement("p");
    empty.className = "illustration-library-empty";
    empty.textContent = "Import a Google Doc containing images to build this library.";
    els.illustrationLibrary.append(empty);
    return;
  }
  illustrationLibrary.forEach((asset) => els.illustrationLibrary.append(createLibraryIllustration(asset)));
}

function setIllustrationSaveStatus(message, dirty = false) {
  els.illustrationSaveStatus.textContent = message;
  els.illustrationSaveStatus.classList.toggle("is-dirty", dirty);
}

function markIllustrationsDirty() {
  setIllustrationSaveStatus("Illustration changes are not saved yet.", true);
}

function saveIllustrations() {
  const snapshot = {
    version: illustrationLayoutVersion,
    placements: placedIllustrations.map(({ id, assetId, frame, x, y, width }) => ({ id, assetId, frame, x, y, width })),
    positions: [...illustrationPositions.entries()].map(([id, position]) => ({ id, x: position.x, y: position.y })),
    widths: [...illustrationWidths.entries()].map(([id, width]) => ({ id, width })),
    hiddenIllustrations: [...hiddenIllustrationIds],
  };
  try {
    window.localStorage.setItem(illustrationStorageKey, JSON.stringify(snapshot));
    setIllustrationSaveStatus("saved in browser");
  } catch {
    setIllustrationSaveStatus("Couldn’t save these illustrations. The browser may be out of storage.", true);
  }
}

function currentIllustrationLayout() {
  const illustrations = [...els.pages.querySelectorAll(".preview-illustration")].map((illustration) => {
    const paper = illustration.closest(".paper");
    const styles = window.getComputedStyle(illustration);
    const x = Number.parseFloat(styles.getPropertyValue("--illustration-x")) || 0;
    const y = Number.parseFloat(styles.getPropertyValue("--illustration-y")) || 0;
    const left = Number.parseFloat(illustration.style.left) || illustration.offsetLeft;
    const top = Number.parseFloat(illustration.style.top) || illustration.offsetTop;
    return {
      id: illustration.dataset.illustrationId,
      frame: paper?.dataset.figmaFrame || "",
      left: Number((left + x).toFixed(2)),
      top: Number((top + y).toFixed(2)),
      width: Number(Number.parseFloat(illustration.style.width).toFixed(2)),
    };
  });
  return { illustrations };
}

function updateIllustrationSupportEmail() {
  const subject = encodeURIComponent("Resilience illustration layout update");
  const layout = JSON.stringify(currentIllustrationLayout(), null, 2);
  const body = encodeURIComponent(`Hi Steph,\n\nPlease update the illustration layout with these values:\n\n${layout}`);
  els.illustrationSupportEmail.href = `mailto:stephaniexzhao@gmail.com?subject=${subject}&body=${body}`;
}

function restoreSavedIllustrations() {
  let snapshot;
  try {
    const stored = window.localStorage.getItem(illustrationStorageKey);
    if (!stored) return;
    snapshot = JSON.parse(stored);
  } catch {
    return;
  }
  if (!snapshot || typeof snapshot !== "object") return;
  const snapshotVersion = Number(snapshot.version) || 1;

  const savedPlacements = Array.isArray(snapshot.placements) ? snapshot.placements : [];
  if (snapshotVersion >= illustrationLayoutVersion) pendingSavedPlacements.length = 0;
  savedPlacements.forEach((placement) => {
    if (!placement || typeof placement.id !== "string" || typeof placement.assetId !== "string" || typeof placement.frame !== "string") return;
    if (![placement.x, placement.y, placement.width].every(Number.isFinite)) return;
    if (snapshotVersion < illustrationLayoutVersion && defaultPlacedIllustrationIds.has(placement.id)) return;
    const savedPlacement = {
      id: placement.id,
      assetId: placement.assetId,
      frame: placement.frame,
      x: placement.x,
      y: placement.y,
      width: placement.width,
    };
    const existingIndex = pendingSavedPlacements.findIndex(({ id }) => id === placement.id);
    if (existingIndex === -1) pendingSavedPlacements.push(savedPlacement);
    else pendingSavedPlacements[existingIndex] = savedPlacement;
  });

  const savedPositions = Array.isArray(snapshot.positions) ? snapshot.positions : [];
  savedPositions.forEach((position) => {
    if (!position || typeof position.id !== "string" || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    if (snapshotVersion < illustrationLayoutVersion && defaultIllustrationLayouts.has(position.id)) return;
    if (snapshotVersion < illustrationLayoutVersion && defaultPlacedIllustrationIds.has(position.id)) return;
    illustrationPositions.set(position.id, { x: position.x, y: position.y });
  });

  const savedWidths = Array.isArray(snapshot.widths) ? snapshot.widths : [];
  savedWidths.forEach((item) => {
    if (!item || typeof item.id !== "string" || !Number.isFinite(item.width) || item.width < 52) return;
    if (snapshotVersion < illustrationLayoutVersion && defaultIllustrationLayouts.has(item.id)) return;
    if (snapshotVersion < illustrationLayoutVersion && defaultPlacedIllustrationIds.has(item.id)) return;
    illustrationWidths.set(item.id, item.width);
  });

  const savedHiddenIllustrations = Array.isArray(snapshot.hiddenIllustrations) ? snapshot.hiddenIllustrations : [];
  savedHiddenIllustrations.forEach((id) => {
    if (typeof id === "string") hiddenIllustrationIds.add(id);
  });

  const savedNumbers = pendingSavedPlacements
    .map((item) => Number(item.id.match(/(?:asset|placed)-(\d+)$/)?.[1] || 0));
  illustrationSequence = Math.max(illustrationSequence, ...savedNumbers);
}

function placeLibraryIllustration(assetId, paper, clientX, clientY) {
  const asset = illustrationLibrary.find((item) => item.id === assetId);
  if (!asset || !paper) return;
  const paperRect = paper.getBoundingClientRect();
  const scale = paperRect.width / paper.offsetWidth || 1;
  const placement = {
    id: `placed-${++illustrationSequence}`,
    assetId,
    frame: paper.dataset.figmaFrame,
    x: Math.max(0, (clientX - paperRect.left) / scale),
    y: Math.max(0, (clientY - paperRect.top) / scale),
    width: 132,
  };
  placedIllustrations.push(placement);
  renderPlacedIllustrations();
  initializeIllustrationDragging();
  initializeIllustrationResizing();
  markIllustrationsDirty();
}

function makeIllustrationResizeHandle(name) {
  const resize = document.createElement("button");
  resize.className = "illustration-resize";
  resize.type = "button";
  resize.setAttribute("aria-label", `Resize ${name || "illustration"}`);
  return resize;
}

function makeIllustrationRemoveButton(name, onRemove) {
  const remove = document.createElement("button");
  remove.className = "illustration-remove";
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${name || "illustration"}`);
  remove.textContent = "×";
  remove.addEventListener("click", onRemove);
  return remove;
}

function documentIllustrationsById() {
  const illustrations = new Map();
  documentModel.chapters.forEach((chapter) => {
    chapter.subsections.forEach((subsection) => {
      subsection.blocks.forEach((block) => {
        if (block.type === "image") illustrations.set(block.id, block);
      });
    });
  });
  return illustrations;
}

function syncIllustrationLibraryFromDocument() {
  const nextLibrary = [];
  const knownSources = new Set();

  documentIllustrationsById().forEach((block) => {
    if (!safeImageSource(block.src) || knownSources.has(block.src)) return;
    knownSources.add(block.src);
    nextLibrary.push({
      id: `document-asset-${stableId(block.src)}`,
      name: block.alt || block.caption || `Google Doc image ${nextLibrary.length + 1}`,
      src: block.src,
    });
  });

  illustrationLibrary.splice(0, illustrationLibrary.length, ...nextLibrary);
  const availableAssetIds = new Set(illustrationLibrary.map((asset) => asset.id));
  const availablePlacements = placedIllustrations.filter((placement) => availableAssetIds.has(placement.assetId));
  placedIllustrations.splice(0, placedIllustrations.length, ...availablePlacements);

  if (!savedPlacementsRestored) {
    const existingPlacementIds = new Set(placedIllustrations.map((placement) => placement.id));
    pendingSavedPlacements.forEach((placement) => {
      if (!availableAssetIds.has(placement.assetId) || existingPlacementIds.has(placement.id)) return;
      placedIllustrations.push({ ...placement });
      existingPlacementIds.add(placement.id);
    });
    savedPlacementsRestored = true;
  }

  renderIllustrationLibrary();
}

function renderAnchoredIllustrations() {
  els.pages.querySelectorAll(".anchored-illustration").forEach((item) => item.remove());
  const illustrations = documentIllustrationsById();

  els.pages.querySelectorAll(".illustration-anchor").forEach((anchor) => {
    const id = anchor.dataset.illustrationId;
    const block = illustrations.get(id);
    const defaultLayout = defaultIllustrationLayouts.get(id);
    const anchoredPaper = anchor.closest(".paper");
    const defaultPaper = defaultLayout
      ? [...els.pages.querySelectorAll(".paper")].find((item) => item.dataset.figmaFrame === defaultLayout.frame)
      : null;
    const paper = defaultPaper || anchoredPaper;
    if (!block || !paper || hiddenIllustrationIds.has(id) || !safeImageSource(block.src)) return;

    const defaultWidth = Math.min(260, Math.max(120, block.width || 220));
    const width = illustrationWidths.get(id) || defaultLayout?.width || defaultWidth;
    const paperRect = paper.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const scale = paperRect.width / paper.offsetWidth || 1;
    const anchorY = (anchorRect.top - paperRect.top) / scale;
    const estimatedHeight = block.width > 0 && block.height > 0
      ? width * (block.height / block.width)
      : width;
    const captionHeight = block.caption ? 20 : 0;
    const left = defaultLayout?.left ?? Math.max(42, paper.offsetWidth - 42 - width);
    const top = defaultLayout?.top ?? Math.max(42, Math.min(anchorY, 716 - estimatedHeight - captionHeight));

    const illustration = document.createElement("figure");
    illustration.className = "content-image preview-illustration anchored-illustration";
    illustration.dataset.illustrationId = id;
    illustration.style.left = `${left}px`;
    illustration.style.top = `${top}px`;
    illustration.style.width = `${width}px`;
    illustration.tabIndex = 0;
    illustration.setAttribute("aria-label", `${block.alt || "Illustration"}. Drag to reposition it, or use the lower-right handle to resize it.`);

    const image = document.createElement("img");
    image.src = block.src;
    image.alt = block.alt || "";
    illustration.append(image);

    if (block.caption) {
      const caption = document.createElement("figcaption");
      caption.textContent = block.caption;
      illustration.append(caption);
    }

    const name = block.alt || "illustration";
    const remove = makeIllustrationRemoveButton(name, () => {
      hiddenIllustrationIds.add(id);
      illustration.remove();
      markIllustrationsDirty();
    });
    illustration.append(remove, makeIllustrationResizeHandle(name));
    paper.append(illustration);
  });
}

function renderPlacedIllustrations() {
  els.pages.querySelectorAll(".placed-illustration").forEach((item) => item.remove());
  placedIllustrations.forEach((placement) => {
    const asset = illustrationLibrary.find((item) => item.id === placement.assetId);
    const paper = [...els.pages.querySelectorAll(".paper")].find((item) => item.dataset.figmaFrame === placement.frame);
    if (!asset || !paper) return;
    const illustration = document.createElement("figure");
    illustration.className = "content-image preview-illustration placed-illustration";
    illustration.dataset.illustrationId = placement.id;
    illustration.style.left = `${placement.x}px`;
    illustration.style.top = `${placement.y}px`;
    illustration.style.width = `${placement.width || 132}px`;
    illustration.tabIndex = 0;
    illustration.setAttribute("aria-label", `${asset.name}. Drag to reposition it, or use the lower-right handle to resize it.`);
    const image = document.createElement("img");
    image.src = asset.src;
    image.alt = asset.name;
    const remove = makeIllustrationRemoveButton(asset.name, () => {
      const index = placedIllustrations.findIndex((item) => item.id === placement.id);
      if (index !== -1) placedIllustrations.splice(index, 1);
      illustrationPositions.delete(placement.id);
      illustration.remove();
      markIllustrationsDirty();
    });
    const resize = makeIllustrationResizeHandle(asset.name);
    illustration.append(image, remove, resize);
    paper.append(illustration);
  });
}

function initializeIllustrationDragging() {
  els.pages.querySelectorAll(".preview-illustration").forEach((illustration) => {
    if (illustration.dataset.dragInitialized === "true") return;
    illustration.dataset.dragInitialized = "true";
    const id = illustration.dataset.illustrationId;
    const savedPosition = illustrationPositions.get(id) || { x: 0, y: 0 };
    applyIllustrationPosition(illustration, savedPosition);

    illustration.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest(".illustration-remove")) return;

      const paper = illustration.closest(".paper");
      if (!paper) return;
      event.preventDefault();
      illustration.focus({ preventScroll: true });
      illustration.setPointerCapture(event.pointerId);
      illustration.classList.add("is-dragging");

      const startPosition = illustrationPositions.get(id) || { x: 0, y: 0 };
      const startX = event.clientX;
      const startY = event.clientY;

      const move = (moveEvent) => {
        const paperRect = paper.getBoundingClientRect();
        const illustrationRect = illustration.getBoundingClientRect();
        const scale = paperRect.width / paper.offsetWidth || 1;
        const minX = startPosition.x + (paperRect.left - illustrationRect.left) / scale;
        const maxX = startPosition.x + (paperRect.right - illustrationRect.right) / scale;
        const minY = startPosition.y + (paperRect.top - illustrationRect.top) / scale;
        const maxY = startPosition.y + (paperRect.bottom - illustrationRect.bottom) / scale;
        const position = {
          x: Math.min(maxX, Math.max(minX, startPosition.x + (moveEvent.clientX - startX) / scale)),
          y: Math.min(maxY, Math.max(minY, startPosition.y + (moveEvent.clientY - startY) / scale)),
        };
        illustrationPositions.set(id, position);
        applyIllustrationPosition(illustration, position);
      };

      const stop = () => {
        illustration.classList.remove("is-dragging");
        illustration.removeEventListener("pointermove", move);
        illustration.removeEventListener("pointerup", stop);
        illustration.removeEventListener("pointercancel", stop);
        markIllustrationsDirty();
      };

      illustration.addEventListener("pointermove", move);
      illustration.addEventListener("pointerup", stop);
      illustration.addEventListener("pointercancel", stop);
    });
  });
}

function initializeIllustrationResizing() {
  els.pages.querySelectorAll(".placed-illustration, .anchored-illustration, .resizable-inline-illustration").forEach((illustration) => {
    const handle = illustration.querySelector(".illustration-resize");
    if (!handle || handle.dataset.resizeInitialized === "true") return;
    handle.dataset.resizeInitialized = "true";
    const id = illustration.dataset.illustrationId;

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const placement = placedIllustrations.find((item) => item.id === id);
      const paper = illustration.closest(".paper");
      const isAnchored = illustration.classList.contains("anchored-illustration");
      const isInline = illustration.classList.contains("resizable-inline-illustration");
      if ((!placement && !isAnchored && !isInline) || !paper) return;
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      illustration.classList.add("is-resizing");

      const paperRect = paper.getBoundingClientRect();
      const scale = paperRect.width / paper.offsetWidth || 1;
      const renderedWidth = illustration.getBoundingClientRect().width / scale;
      const startWidth = placement?.width || illustrationWidths.get(id) || renderedWidth || 132;
      const startX = event.clientX;
      const position = illustrationPositions.get(id) || { x: 0, y: 0 };
      const baseLeft = Number.parseFloat(illustration.style.left) || 0;
      const maxWidth = isInline
        ? Math.max(52, illustration.parentElement?.clientWidth || paper.offsetWidth)
        : Math.max(52, paper.offsetWidth - baseLeft - position.x);

      const move = (moveEvent) => {
        const width = Math.min(maxWidth, Math.max(52, startWidth + (moveEvent.clientX - startX) / scale));
        if (placement) placement.width = width;
        else illustrationWidths.set(id, width);
        illustration.style.width = `${width}px`;
      };

      const stop = () => {
        illustration.classList.remove("is-resizing");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        markIllustrationsDirty();
        if (isInline) paginate();
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
  });
}

function initializeIllustrationDropTargets() {
  els.pages.querySelectorAll(".paper").forEach((paper) => {
    paper.addEventListener("dragover", (event) => {
      if (![...event.dataTransfer.types].includes("application/x-resilience-illustration")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      paper.classList.add("is-illustration-drop-target");
    });
    paper.addEventListener("dragleave", () => paper.classList.remove("is-illustration-drop-target"));
    paper.addEventListener("drop", (event) => {
      event.preventDefault();
      paper.classList.remove("is-illustration-drop-target");
      const assetId = event.dataTransfer.getData("application/x-resilience-illustration");
      if (assetId) placeLibraryIllustration(assetId, paper, event.clientX, event.clientY);
    });
  });
}

function mergeBlockFragments(blocks) {
  return blocks.reduce((merged, block) => {
    const previous = merged.at(-1);
    if (block.type === "list" && block.listGroup && previous?.listGroup === block.listGroup) {
      previous.items.push(...block.items);
      return merged;
    }
    if (block.type === "paragraph" && block.paragraphGroup && previous?.paragraphGroup === block.paragraphGroup) {
      previous.html = `${previous.html} ${block.html}`;
      return merged;
    }
    if (block.type === "table" && block.tableGroup && previous?.tableGroup === block.tableGroup) {
      previous.rows.push(...block.rows.slice(block.tableHasHeader ? 1 : 0));
      return merged;
    }
    if (block.type === "list") merged.push({ ...block, items: [...block.items] });
    else if (block.type === "table") merged.push({ ...block, rows: [...block.rows] });
    else merged.push({ ...block });
    return merged;
  }, []);
}

function makeSubsectionHeadingRow(section, continued = false) {
  const headingRow = document.createElement("div");
  headingRow.className = "subsection-heading-row";
  const heading = document.createElement("h3");
  heading.className = "subsection-heading";
  heading.innerHTML = section.titleHtml || escapeHtml(section.title);

  if (continued && section.continuationStyle !== "header") {
    const badge = document.createElement("span");
    badge.className = "continued-badge";
    badge.innerHTML = '<img src="assets/icons/continued.svg" alt="Continued">';
    heading.append(document.createTextNode("\u00a0"), badge);
  }

  headingRow.append(heading);
  return headingRow;
}

function makeSubsection(subsection, blocks, continued = false) {
  const wrapper = document.createElement("section");
  wrapper.className = "subsection";
  wrapper.classList.toggle("is-heading-anchor", subsection.anchorsNextHeading === true);
  wrapper.classList.toggle("is-nested", subsection.depth === 3);
  wrapper.classList.toggle("is-continuation", continued);
  wrapper.classList.toggle("is-chapter-last", subsection.isChapterLast === true);
  wrapper.classList.toggle("has-doc-blank-before", !continued && subsection.blankLinesBefore > 0);
  if (!continued && subsection.blankLinesBefore > 0) {
    wrapper.style.setProperty("--doc-blank-lines", subsection.blankLinesBefore);
  }
  wrapper.dataset.subsection = subsection.id;

  const headingRow = subsection.isUntitled ? null : makeSubsectionHeadingRow(subsection, continued);
  const blocksToRender = mergeBlockFragments(blocks).map((block) => {
    const node = makeBlock(block);
    if (block.exportWarningId) node.dataset.exportWarningId = block.exportWarningId;
    node.classList.toggle("has-doc-blank-before", block.blankLinesBefore > 0);
    if (block.blankLinesBefore > 0) node.style.setProperty("--doc-blank-lines", block.blankLinesBefore);
    return node;
  });

  if (headingRow && !(continued && subsection.continuationStyle === "none")) wrapper.append(headingRow);
  wrapper.append(...blocksToRender);
  return wrapper;
}

function makeParentContinuation(parent) {
  const wrapper = document.createElement("section");
  wrapper.className = "subsection parent-continuation is-continuation";
  wrapper.dataset.subsection = parent.id;
  wrapper.append(makeSubsectionHeadingRow(parent, true));
  return wrapper;
}

function makeSubsectionWithParentContext(subsection, blocks, continued = false, parent = null, repeatParent = false) {
  const subsectionNode = makeSubsection(subsection, blocks, continued);
  if (!repeatParent || subsection.depth !== 3 || !parent || subsection.continuationStyle === "none") {
    return { node: subsectionNode, subsectionNode };
  }

  const fragment = document.createElement("div");
  fragment.className = "nested-continuation";
  fragment.append(makeParentContinuation(parent), subsectionNode);
  return { node: fragment, subsectionNode };
}

function measure(node, frameClass = "") {
  const container = document.createElement("div");
  container.className = `measurement-content ${frameClass}`.trim();
  container.append(node);
  els.measurement.replaceChildren(container);
  return container.getBoundingClientRect().height;
}

function renderMeasuredSubsection(subsection, blocks, continued = false, frameClass = "", parent = null, repeatParent = false) {
  const rendered = makeSubsectionWithParentContext(subsection, blocks, continued, parent, repeatParent);
  return {
    ...rendered,
    height: measure(rendered.node.cloneNode(true), frameClass),
  };
}

function measureSubsectionPair(first, second, frameClass = "") {
  const container = document.createElement("div");
  container.className = `measurement-content ${frameClass}`.trim();
  container.append(first.cloneNode(true), second.cloneNode(true));
  els.measurement.replaceChildren(container);
  return container.getBoundingClientRect().height;
}

function hasMinimumStartCopy(subsection, block, frameClass = "") {
  if (block.type !== "paragraph") return true;

  const subsectionNode = makeSubsection(subsection, [block]);
  const container = document.createElement("div");
  container.className = `measurement-content ${frameClass}`.trim();
  container.append(subsectionNode);
  els.measurement.replaceChildren(container);

  const paragraph = subsectionNode.querySelector(".content-block");
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const lineTops = new Set(
    [...range.getClientRects()]
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => Math.round(rect.top * 2) / 2),
  );
  if (lineTops.size) return lineTops.size >= 2;

  const styles = getComputedStyle(paragraph);
  const explicitLineHeight = Number.parseFloat(styles.lineHeight);
  const fontSize = Number.parseFloat(styles.fontSize);
  const lineHeight = Number.isFinite(explicitLineHeight)
    ? explicitLineHeight
    : fontSize * 1.35;
  return paragraph.getBoundingClientRect().height >= (lineHeight * 2) - 0.5;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function plainText(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.textContent.trim();
}

function splitAtSafeClauseBoundaries(subsection, sentence, frameClass = "") {
  const clauses = [];
  let start = 0;

  for (const boundary of sentence.matchAll(/;|:(?=\s)|—/g)) {
    const end = boundary.index + boundary[0].length;
    const clause = sentence.slice(start, end);
    if (clause.trim()) clauses.push(clause);
    start = end;
  }

  const tail = sentence.slice(start);
  if (tail.trim()) clauses.push(tail);
  if (clauses.length < 2) return [sentence];

  const everyClauseHasTwoLines = clauses.every((clause) => hasMinimumStartCopy(subsection, {
    type: "paragraph",
    html: escapeHtml(clause),
  }, frameClass));
  return everyClauseHasTwoLines ? clauses : [sentence];
}

function recordFatalWarning(message, warnings, fatalWarnings) {
  const warning = {
    id: `export-warning-${fatalWarnings.length + 1}`,
    message,
  };
  warnings.push(warning);
  fatalWarnings.push(warning);
  return warning;
}

function fragmentParagraphAtSemanticBoundaries(subsection, block, blockIndex, maxHeight, warnings, fatalWarnings, frameClass = "", fallbackTitle = "") {
  if (/<a\b/i.test(block.html)) return [block];
  const text = plainText(block.html);
  const segmenter = typeof Intl?.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "sentence" })
    : null;
  const sentences = segmenter
    ? [...segmenter.segment(text)].map(({ segment }) => segment).filter((segment) => segment.trim())
    : text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g)?.filter((segment) => segment.trim()) || [text];
  const fragments = sentences.flatMap((sentence) => splitAtSafeClauseBoundaries(subsection, sentence, frameClass));

  if (fragments.length < 2) return [block];

  const paragraphGroup = `${subsection.id}-paragraph-${blockIndex}`;
  return fragments.map((fragment, fragmentIndex) => {
    const fragmentBlock = {
      ...block,
      html: escapeHtml(fragment),
      paragraphGroup,
      blankLinesBefore: fragmentIndex === 0 ? block.blankLinesBefore : 0,
      pageBreakBefore: fragmentIndex === 0 ? block.pageBreakBefore : false,
    };
    const fragmentHeight = renderMeasuredSubsection(subsection, [fragmentBlock], false, frameClass).height;
    if (fragmentHeight > maxHeight) {
      const message = `A single sentence or clause in “${subsection.title || fallbackTitle}” is taller than a page and needs an editorial edit before export.`;
      fragmentBlock.exportWarningId = recordFatalWarning(message, warnings, fatalWarnings).id;
    }
    return fragmentBlock;
  });
}

function fragmentSubsectionBlocks(subsection, maxHeight, warnings, fatalWarnings, frameClass = "", fallbackTitle = "") {
  const fragments = [];
  const sectionTitle = subsection.title || fallbackTitle;
  subsection.blocks.forEach((block, blockIndex) => {
    if (block.type === "list" && block.items.length > 1) {
      const listGroup = `${subsection.id}-list-${blockIndex}`;
      block.items.forEach((item, itemIndex) => {
        const itemBlock = {
          ...block,
          items: [item],
          start: (block.start || 1) + itemIndex,
          listGroup,
          blankLinesBefore: itemIndex === 0 ? block.blankLinesBefore : 0,
          pageBreakBefore: itemIndex === 0 ? block.pageBreakBefore : false,
        };
        const itemHeight = renderMeasuredSubsection(subsection, [itemBlock], false, frameClass).height;
        if (itemHeight > maxHeight) {
          const message = `A single list item in “${sectionTitle}” is taller than a page and needs an editorial edit before export.`;
          itemBlock.exportWarningId = recordFatalWarning(message, warnings, fatalWarnings).id;
        }
        fragments.push(itemBlock);
      });
      return;
    }

    if (block.type === "paragraph" && !block.hasSoftBreak) {
      fragments.push(...fragmentParagraphAtSemanticBoundaries(
        subsection,
        block,
        blockIndex,
        maxHeight,
        warnings,
        fatalWarnings,
        frameClass,
        fallbackTitle,
      ));
      return;
    }

    if (block.type === "table") {
      const header = block.rows[0].some((cell) => cell.header) ? block.rows[0] : null;
      const bodyRows = block.rows.slice(header ? 1 : 0);
      if (bodyRows.length > 1) {
        const tableGroup = `${subsection.id}-table-${blockIndex}`;
        bodyRows.forEach((row, rowIndex) => {
          const rowBlock = {
            ...block,
            rows: header ? [header, row] : [row],
            tableGroup,
            tableHasHeader: Boolean(header),
            blankLinesBefore: rowIndex === 0 ? block.blankLinesBefore : 0,
            pageBreakBefore: rowIndex === 0 ? block.pageBreakBefore : false,
          };
          const rowHeight = renderMeasuredSubsection(subsection, [rowBlock], false, frameClass).height;
          if (rowHeight > maxHeight) {
            const message = `A single table row in “${sectionTitle}” is taller than a page and needs an editorial edit before export.`;
            rowBlock.exportWarningId = recordFatalWarning(message, warnings, fatalWarnings).id;
          }
          fragments.push(rowBlock);
        });
        return;
      }
    }

    const height = renderMeasuredSubsection(subsection, [block], false, frameClass).height;
    const fragmentBlock = { ...block };
    if (height > maxHeight) {
      const message = `A single ${block.type} in “${sectionTitle}” is taller than a page and needs an editorial edit before export.`;
      fragmentBlock.exportWarningId = recordFatalWarning(message, warnings, fatalWarnings).id;
    }
    fragments.push(fragmentBlock);
  });
  return fragments;
}

function contentHeightPx() {
  const probe = document.createElement("div");
  probe.style.height = "var(--content-height)";
  els.measurement.replaceChildren(probe);
  return probe.getBoundingClientRect().height;
}

function makePaper(chapter, showChapterTitle, pageNumber) {
  const paper = document.createElement("article");
  paper.className = "paper content-page";
  paper.dataset.chapterId = chapter.id;
  if (showChapterTitle) paper.dataset.chapterStart = "true";
  paper.setAttribute("aria-label", `${chapter.title}, page ${pageNumber}`);

  if (showChapterTitle && chapter.showTitle !== false) {
    const title = document.createElement("h2");
    title.className = "chapter-title";
    title.innerHTML = chapter.titleHtml || escapeHtml(chapter.title);
    paper.append(title);

    if (chapter.dek) {
      const dek = document.createElement("p");
      dek.className = "chapter-dek";
      dek.innerHTML = chapter.dek;
      paper.append(dek);
    }
  }

  const content = document.createElement("div");
  content.className = "page-content";
  paper.append(content, makeFooter(chapter.footerLabel || chapter.title, pageNumber));
  return { paper, content, used: 0 };
}

function makeFooter(label, pageNumber) {
  const footer = document.createElement("footer");
  footer.className = "packet-footer";
  const left = document.createElement("span");
  left.className = "footer-label";
  left.textContent = label;
  const right = document.createElement("span");
  right.className = "footer-number";
  right.textContent = pageNumber;
  footer.append(left, right);
  return footer;
}

function makeCover(data = {}) {
  const cover = {
    title: "",
    subtitle: "",
    website: "",
    year: "",
    ...data,
  };
  const paper = document.createElement("article");
  paper.className = "paper cover-page";
  paper.dataset.pageStyle = "cover";
  paper.setAttribute("aria-label", "Packet cover");
  paper.innerHTML = `
    <img class="cover-mark" src="assets/icons/resilience-cover-mark.png" alt="">
    <p class="cover-brand">RESILIENCE</p>
    <div class="cover-heading-group">
      <h2 class="cover-title"></h2>
      <p class="cover-subtitle"></p>
    </div>
    <p class="cover-meta cover-site"></p>
    <p class="cover-meta cover-year"></p>
  `;
  paper.querySelector(".cover-title").textContent = cover.title;
  paper.querySelector(".cover-subtitle").textContent = cover.subtitle;
  paper.querySelector(".cover-site").textContent = cover.website;
  paper.querySelector(".cover-year").textContent = cover.year;
  return paper;
}

const orientationTextFitRules = [
  { selector: ".orientation-title", maxWidth: 515, maxHeight: 32, minFontSize: 16 },
  { selector: ".orientation-rights p", maxHeight: 88, minFontSize: 10 },
  { selector: ".orientation-emotions > p", maxHeight: 56, minFontSize: 10 },
  { selector: ".orientation-emotions small:nth-of-type(1)", maxHeight: 38, minFontSize: 8 },
  { selector: ".orientation-emotions small:nth-of-type(2)", maxHeight: 36, minFontSize: 8 },
  { selector: ".orientation-confidentiality p", maxHeight: 58, minFontSize: 10 },
  { selector: ".orientation-billing p", maxHeight: 58, minFontSize: 10 },
  { selector: ".orientation-billing small", maxHeight: 34, minFontSize: 8 },
  { selector: ".orientation-organization p", maxHeight: 40, minFontSize: 10 },
  { selector: ".orientation-organization small", maxHeight: 20, minFontSize: 9 },
  { selector: ".orientation-footnote", maxWidth: 543, maxHeight: 26, minFontSize: 8 },
];

function fitTextToBounds(element, { maxWidth = Infinity, maxHeight = Infinity, minFontSize }) {
  element.style.removeProperty("font-size");
  element.classList.remove("is-text-fitted");
  delete element.dataset.fittedFontSize;

  const preferredFontSize = Number.parseFloat(getComputedStyle(element).fontSize);
  const fits = () => (
    element.scrollWidth <= maxWidth + 0.5
    && element.scrollHeight <= maxHeight + 0.5
  );
  if (fits()) return;

  let lower = Math.min(minFontSize, preferredFontSize);
  let upper = preferredFontSize;
  element.style.fontSize = `${lower}px`;

  if (fits()) {
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const candidate = (lower + upper) / 2;
      element.style.fontSize = `${candidate}px`;
      if (fits()) lower = candidate;
      else upper = candidate;
    }
  }

  const fittedFontSize = Math.floor(lower * 100) / 100;
  element.style.fontSize = `${fittedFontSize}px`;
  element.classList.add("is-text-fitted");
  element.dataset.fittedFontSize = String(fittedFontSize);
}

function fitOrientationText(root) {
  root.querySelectorAll(".orientation-page").forEach((page) => {
    orientationTextFitRules.forEach(({ selector, ...bounds }) => {
      page.querySelectorAll(selector).forEach((element) => fitTextToBounds(element, bounds));
    });
  });
}

function makeOrientationPage(data = {}) {
  const summary = {
    title: "",
    rights: "",
    emotions: "",
    emotionsDetail: "",
    confidentiality: "",
    billing: "",
    billingDetail: "",
    organization: "",
    footnote: "",
    ...data,
  };
  const splitSupportingCopy = (value) => {
    const match = value.trim().match(/^(.+?[.!?])\s+(.+)$/);
    return match ? [match[1], match[2]] : [value.trim(), ""];
  };
  const [emotionsDetail, emotionsClosing] = splitSupportingCopy(summary.emotionsDetail);
  const [organizationMessage, organizationDetail] = splitSupportingCopy(summary.organization);
  const paper = document.createElement("article");
  paper.className = "paper orientation-page";
  paper.dataset.pageStyle = "summary-graphic";
  paper.setAttribute("aria-label", "Orientation and reassurance");
  paper.innerHTML = `
    <img class="orientation-banner" src="assets/icons/orientation-banner.svg" alt="">
    <h2 class="orientation-title">${escapeHtml(summary.title)}</h2>
    <article class="orientation-card orientation-rights"><p>${escapeHtml(summary.rights)}</p></article>
    <article class="orientation-card orientation-emotions">
      <p>${escapeHtml(summary.emotions)}</p>
      <div class="orientation-emotion-icons" aria-hidden="true">
        <img src="assets/icons/orientation-emotion-1.svg" alt="">
        <img src="assets/icons/orientation-emotion-3.svg" alt="">
        <img src="assets/icons/orientation-emotion-star.svg" alt="">
        <img src="assets/icons/orientation-emotion-2.svg" alt="">
      </div>
      <small>${escapeHtml(emotionsDetail)}</small>
      <small>${escapeHtml(emotionsClosing)}</small>
    </article>
    <article class="orientation-card orientation-confidentiality">
      <img class="orientation-conf-icon" src="assets/icons/confidential.svg" alt="">
      <img class="orientation-card-asterisk" src="assets/icons/orientation-card-asterisk.svg" alt="">
      <p>${escapeHtml(summary.confidentiality).replace(/\byou\b/i, "<u>$&</u>")}</p>
    </article>
    <article class="orientation-card orientation-billing">
      <img class="orientation-card-bg" src="assets/icons/orientation-billing-bg.svg" alt="">
      <span class="orientation-billing-mark"><img src="assets/icons/orientation-billing-icon.svg" alt=""></span>
      <p>${escapeHtml(summary.billing)}</p>
      <small>${escapeHtml(summary.billingDetail)}</small>
    </article>
    <article class="orientation-card orientation-organization">
      <img class="orientation-card-bg" src="assets/icons/orientation-org-bg.svg" alt="">
      <img class="orientation-org-photo" src="assets/icons/orientation-org-photo.png" alt="">
      <b>RESILIENCE</b>
      <p>${escapeHtml(organizationMessage)}</p>
      <small>${escapeHtml(organizationDetail)}</small>
      <img class="orientation-underline" src="assets/icons/orientation-underline.svg" alt="">
    </article>
    <img class="orientation-footnote-asterisk" src="assets/icons/orientation-footnote-asterisk.svg" alt="">
    <p class="orientation-footnote">${escapeHtml(summary.footnote)}</p>
  `;
  return paper;
}

function makeLetterPage(data = {}) {
  const letter = {
    salutation: "Hello,",
    paragraphs: [],
    paragraphsHtml: [],
    signoff: "Sincerely,",
    organization: "",
    notes: [],
    notesHtml: [],
    contacts: [],
    hasDivider: false,
    isImported: false,
    ...data,
  };
  const paper = document.createElement("article");
  paper.className = "paper letter-page";
  paper.classList.toggle("is-imported-letter", letter.isImported);
  paper.classList.toggle("has-divider", letter.hasDivider);
  paper.dataset.pageStyle = "letter";
  paper.setAttribute("aria-label", "Introductory letter");
  const salutation = document.createElement("h2");
  salutation.className = "letter-salutation";
  salutation.textContent = letter.salutation;
  const main = document.createElement("div");
  main.className = "letter-main";
  letter.paragraphs.forEach((text, index) => {
    const p = document.createElement("p");
    p.innerHTML = letter.paragraphsHtml[index]
      ? sanitizeHtmlString(letter.paragraphsHtml[index])
      : escapeHtml(text);
    main.append(p);
  });
  const signoff = document.createElement("p");
  signoff.className = "letter-signoff";
  signoff.innerHTML = `${escapeHtml(letter.signoff)}<br><strong>${escapeHtml(letter.organization)}</strong>`;
  const notes = document.createElement("div");
  notes.className = "letter-notes";
  letter.notes.forEach((text, index) => {
    const p = document.createElement("p");
    p.innerHTML = letter.notesHtml[index]
      ? sanitizeHtmlString(letter.notesHtml[index])
      : escapeHtml(text);
    notes.append(p);
  });
  if (letter.contacts.length) notes.append(makeBlock({ type: "contact-row", items: letter.contacts }));
  if (letter.isImported) {
    const body = document.createElement("div");
    body.className = "imported-letter-body";
    body.append(main, signoff);
    paper.append(salutation, body);
  } else {
    paper.append(salutation, main, signoff);
  }
  if (letter.notes.length || letter.contacts.length) paper.append(notes);
  return paper;
}

function makeSpecialPage(page) {
  if (page.type === "cover") return makeCover(page.data);
  if (page.type === "summary-graphic") return makeOrientationPage(page.data);
  return makeLetterPage(page.data);
}

function makeContentsPage(data, pageNumber) {
  const paper = document.createElement("article");
  paper.className = "paper contents-page";
  paper.setAttribute("aria-label", "In this packet");
  const title = document.createElement("h2");
  title.className = "chapter-title";
  title.textContent = data.title;
  const list = document.createElement("div");
  list.className = "contents-list";
  data.items.forEach((item) => {
    const entry = document.createElement("div");
    entry.className = "contents-entry";
    entry.innerHTML = `<strong>${item.title}</strong><span>${item.description}</span>`;
    list.append(entry);
  });
  paper.append(title, list, makeFooter("Contents", pageNumber));
  return paper;
}

function contentsTargetChapter(label, chapters) {
  const labelId = slugify(label);
  const candidates = chapters
    .filter((chapter) => !/^(?:in-this-packet|what-s-inside|contents)$/.test(chapter.id))
    .sort((a, b) => b.id.length - a.id.length);
  return candidates.find((chapter) => chapter.id === labelId)
    || candidates.find((chapter) => labelId.startsWith(chapter.id) || chapter.id.startsWith(labelId));
}

function initializePacketContentsLinks(root, chapters) {
  const targetIds = new Map();
  chapters.forEach((chapter) => {
    const paper = [...root.querySelectorAll(".paper[data-chapter-start='true']")]
      .find((candidate) => candidate.dataset.chapterId === chapter.id);
    const comparison = paper?.closest(".page-comparison");
    if (!comparison) return;
    const targetId = `packet-chapter-${chapter.id}`;
    comparison.id = targetId;
    targetIds.set(chapter.id, targetId);
  });

  const makeLink = (chapter) => {
    const link = document.createElement("a");
    link.className = "packet-contents-link";
    link.href = `#${targetIds.get(chapter.id)}`;
    return link;
  };

  root.querySelectorAll(".contents-page .contents-entry").forEach((entry) => {
    const chapter = contentsTargetChapter(entry.querySelector("strong")?.textContent || "", chapters);
    if (!chapter || !targetIds.has(chapter.id)) return;
    const link = makeLink(chapter);
    link.classList.add("contents-entry");
    link.append(...entry.childNodes);
    entry.replaceWith(link);
  });

  const contentsChapterIds = new Set(chapters
    .filter((chapter) => /^(?:in-this-packet|what-s-inside|contents)$/.test(chapter.id))
    .map((chapter) => chapter.id));
  root.querySelectorAll(".paper[data-chapter-id] p.content-block").forEach((paragraph) => {
    if (!contentsChapterIds.has(paragraph.closest(".paper")?.dataset.chapterId)) return;
    const fragment = document.createDocumentFragment();
    let link = null;
    [...paragraph.childNodes].forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches("strong")) {
        const chapter = contentsTargetChapter(node.textContent || "", chapters);
        link = chapter && targetIds.has(chapter.id) ? makeLink(chapter) : null;
        if (link) fragment.append(link);
      }
      (link || fragment).append(node);
    });
    paragraph.replaceChildren(fragment);
  });
}

function paginate() {
  const warnings = [];
  const fatalWarnings = [];
  const preface = window.RESILIENCE_PREFACE || {};
  const showBundledContents = !isLiveDocument && Boolean(preface.contents);
  const output = isLiveDocument
    ? importedSpecialPages.map(makeSpecialPage)
    : [
        preface.cover ? makeCover(preface.cover) : null,
        preface.orientation ? makeOrientationPage(preface.orientation) : null,
        preface.letter ? makeLetterPage(preface.letter) : null,
      ].filter(Boolean);
  if (showBundledContents) output.push(makeContentsPage(preface.contents, 3));
  const maxHeight = contentHeightPx();
  let pageNumber = showBundledContents ? 4 : 3;

  documentModel.chapters.forEach((chapter) => {
    const makeContentPage = (showChapterTitle) => {
      const frameNumber = output.length + 1;
      const page = makePaper(chapter, showChapterTitle, pageNumber++);
      const measurementFrameClass = isLiveDocument ? "" : getLegacyFrameClass(frameNumber);
      return {
        ...page,
        measurementFrameClass,
        maxHeight: measurementFrameClass === "letter-124" ? maxHeight - 10 : maxHeight,
      };
    };

    let current = makeContentPage(true);
    output.push(current.paper);

    const nextPage = () => {
      current = makeContentPage(false);
      output.push(current.paper);
    };

    const carryParentHeadingAnchor = (parentId) => {
      const anchor = current.content.lastElementChild;
      if (
        !parentId
        || !anchor?.classList.contains("is-heading-anchor")
        || anchor.dataset.subsection !== parentId
        || current.content.childElementCount < 2
      ) return false;

      const anchorHeight = measure(anchor.cloneNode(true), current.measurementFrameClass);
      current.content.removeChild(anchor);
      nextPage();
      current.content.append(anchor);
      current.used = anchorHeight;
      return true;
    };

    chapter.subsections.forEach((subsection, subsectionIndex) => {
      if (subsection.pageBreakBefore && current.used > 0) nextPage();
      const startsContinued = subsection.startsContinued === true;
      const parentSubsection = subsection.depth === 3
        ? chapter.subsections.find((candidate) => candidate.id === subsection.parentId)
        : null;
      const nextSubsection = chapter.subsections[subsectionIndex + 1];
      const hasParentContextOnCurrentPage = () => parentSubsection && [...current.content.querySelectorAll(".subsection")]
        .some((section) => section.dataset.subsection === parentSubsection.id);
      const renderSubsection = (blocks, continued, frameClass = current.measurementFrameClass) => (
        renderMeasuredSubsection(
          subsection,
          blocks,
          continued,
          frameClass,
          parentSubsection,
          !hasParentContextOnCurrentPage(),
        )
      );
      let complete = renderSubsection(subsection.blocks, startsContinued);

      // A Google Docs page break can land on the first body block beneath an
      // empty H2. In that case the break belongs before the H2, not between the
      // H2 and its H3, otherwise the H2 is stranded by itself.
      if (
        subsection.anchorsNextHeading
        && nextSubsection
        && (nextSubsection.pageBreakBefore || nextSubsection.blocks[0]?.pageBreakBefore)
      ) {
        if (current.used > 0) nextPage();
        nextSubsection.pageBreakBefore = false;
        if (nextSubsection.blocks[0]) nextSubsection.blocks[0].pageBreakBefore = false;
        complete = renderSubsection(subsection.blocks, startsContinued);
      }

      if (subsection.anchorsNextHeading && nextSubsection && current.used > 0) {
        const nextPreviewBlocks = nextSubsection.blocks.length ? [nextSubsection.blocks[0]] : [];
        const nextPreview = makeSubsection(nextSubsection, nextPreviewBlocks, false);
        // Keep an H2 with the start of its H3. Measuring them together mirrors
        // the actual page flow and prevents an H2 from being stranded alone.
        const pairedHeight = measureSubsectionPair(complete.node, nextPreview, current.measurementFrameClass);
        if (pairedHeight > current.maxHeight - current.used) {
          nextPage();
          complete = renderSubsection(subsection.blocks, startsContinued);
        }
      }
      const available = current.maxHeight - current.used;

      // Bottom padding creates rhythm between subsections, but it is not
      // required when that padding alone would push an otherwise complete
      // subsection onto the next page. In that case the subsection becomes
      // the terminal item on this page and the visible content stays intact.
      if (complete.height > available) {
        complete.subsectionNode.classList.add("is-page-terminal");
        const terminalHeight = measure(complete.node.cloneNode(true), current.measurementFrameClass);
        if (terminalHeight <= available) complete.height = terminalHeight;
        else complete.subsectionNode.classList.remove("is-page-terminal");
      }

      if (!subsection.blocks.length) {
        if (complete.height > current.maxHeight - current.used && current.used > 0) {
          nextPage();
          complete = renderSubsection([], startsContinued);
        }
        current.content.append(complete.node);
        current.used += complete.height;
        return;
      }

      const hasForcedBlockBreak = subsection.blocks.some((block) => block.pageBreakBefore);
      if (!hasForcedBlockBreak && complete.height <= available) {
        current.content.append(complete.node);
        current.used += complete.height;
        return;
      }

      let remaining = fragmentSubsectionBlocks(
        subsection,
        current.maxHeight,
        warnings,
        fatalWarnings,
        current.measurementFrameClass,
        chapter.title,
      );
      let continued = startsContinued;

      while (remaining.length) {
        if (
          current.used > 0
          && (
            remaining[0].pageBreakBefore
            || renderSubsection([remaining[0]], continued).height > current.maxHeight - current.used
          )
        ) {
          if (!continued && carryParentHeadingAnchor(subsection.parentId)) continue;
          nextPage();
        }

        const selected = [];
        for (const block of remaining) {
          if (selected.length && block.pageBreakBefore) break;
          const candidate = renderSubsection([...selected, block], continued);
          if (candidate.height <= current.maxHeight - current.used || selected.length === 0) {
            selected.push(block);
          } else {
            break;
          }
        }

        const selectedBlocks = mergeBlockFragments(selected);
        const leavesOneLineLeadIn = current.used > 0
          && remaining.length > selected.length
          && selectedBlocks.length === 1
          && !hasMinimumStartCopy(subsection, selectedBlocks[0], current.measurementFrameClass);
        if (leavesOneLineLeadIn) {
          if (!continued && carryParentHeadingAnchor(subsection.parentId)) continue;
          nextPage();
          continue;
        }

        const fragment = renderSubsection(selected, continued);
        fragment.subsectionNode.classList.toggle("continues-next-page", remaining.length > selected.length);
        const fragmentHeight = measure(fragment.node.cloneNode(true), current.measurementFrameClass);
        current.content.append(fragment.node);
        current.used += fragmentHeight;
        remaining = remaining.slice(selected.length);

        if (remaining.length) {
          nextPage();
          continued = true;
        }
      }
    });
  });

  els.pages.replaceChildren(...makePageComparisons(output, isLiveDocument));
  fitOrientationText(els.pages);
  initializePacketContentsLinks(els.pages, documentModel.chapters);
  activateLinks(els.pages);
  renderAnchoredIllustrations();
  renderPlacedIllustrations();
  initializeIllustrationDragging();
  initializeIllustrationResizing();
  initializeIllustrationDropTargets();
  centerPreviewPages();
  els.warnings.replaceChildren(...warnings.map((warning) => {
    const item = document.createElement("span");
    item.className = "render-warning";
    item.append(document.createTextNode(warning.message));

    const marker = els.pages.querySelector(`[data-export-warning-id="${warning.id}"]`);
    const paper = marker?.closest(".paper");
    const comparison = paper?.closest(".page-comparison");
    const pageLabel = comparison?.querySelector(".prototype-column > .comparison-label")?.textContent.trim();
    if (comparison && paper && pageLabel) {
      const targetId = `packet-page-${paper.dataset.figmaFrame}`;
      comparison.id = targetId;
      const link = document.createElement("a");
      link.href = `#${targetId}`;
      link.textContent = `View ${pageLabel}`;
      item.append(document.createTextNode(" "), link);
    }
    return item;
  }));
  els.warnings.classList.toggle("is-visible", warnings.length > 0);
  const exportBlocked = fatalWarnings.length > 0;
  els.printButton.disabled = exportBlocked;
  document.body.classList.toggle("has-fatal-overflow", exportBlocked);
  els.printBlocker.textContent = exportBlocked
    ? `PDF export blocked: ${fatalWarnings.map((warning) => warning.message).join(" ")}`
    : "";
}

function setImportBusy(isBusy) {
  els.importButton.disabled = isBusy;
  els.refreshButton.disabled = isBusy;
  els.quickLink.disabled = isBusy;
}

async function responseError(response) {
  try {
    const payload = await response.json();
    return payload.error || `Google Docs import failed (${response.status}).`;
  } catch {
    return `Google Docs import failed (${response.status}).`;
  }
}

async function importAndRender() {
  const docsUrl = normalizeGoogleDocsUrl(els.docsUrl.value);
  if (!docsUrl) {
    els.docsUrl.setAttribute("aria-invalid", "true");
    els.importSummary.textContent = "Paste a valid Google Docs link to continue.";
    els.importSummary.hidden = false;
    return;
  }
  els.docsUrl.removeAttribute("aria-invalid");
  els.docsUrl.value = docsUrl;
  els.docsLink.href = docsUrl;
  syncDocsPreview(docsUrl);
  setImportBusy(true);
  els.importSummary.hidden = true;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const proxyUrl = googleDocsProxyUrl(docsUrl);
    const response = await fetch(proxyUrl, {
      headers: { Accept: "text/html" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await responseError(response));
    const encodedTitle = response.headers.get("X-Google-Doc-Title");
    if (encodedTitle) {
      const documentId = googleDocumentId(docsUrl);
      let title = "";
      try {
        title = decodeURIComponent(encodedTitle);
      } catch {
        title = encodedTitle;
      }
      if (documentId && title) documentTitleCache.set(documentId, title);
      els.docsPreviewTitle.textContent = title;
    }
    const transformed = transformGoogleDocExport(await response.text(), { ignoreRedText: true });
    els.source.replaceChildren(...filterImportedContent(transformed.nodes));
    const nextModel = parseSource();
    if (!nextModel.chapters.length) throw new Error("No chapter content remained after applying the import filters.");

    documentModel = nextModel;
    importedSpecialPages = transformed.specialPages;
    isLiveDocument = true;
    syncIllustrationLibraryFromDocument();
    paginate();
    els.importSummary.textContent = "";
    els.importSummary.hidden = true;
    syncDocsPreview(docsUrl);
  } catch (error) {
    const message = error.name === "AbortError"
      ? "The document took too long to respond. Try again."
      : error.message;
    els.importSummary.textContent = `${message} The current preview was left unchanged.`;
    els.importSummary.hidden = false;
  } finally {
    window.clearTimeout(timeout);
    setImportBusy(false);
  }
}

function normalizeGoogleDocsUrl(value) {
  try {
    const url = new URL(value.trim());
    const match = url.pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (url.hostname !== "docs.google.com" || !match) return "";
    const tab = url.searchParams.get("tab");
    const normalized = `https://docs.google.com/document/d/${match[1]}/edit`;
    const tabUrl = tab && /^[a-zA-Z0-9._-]+$/.test(tab) ? `${normalized}?tab=${encodeURIComponent(tab)}` : normalized;
    return /^#heading=h\.[a-zA-Z0-9_-]+$/.test(url.hash) ? `${tabUrl}${url.hash}` : tabUrl;
  } catch {
    return "";
  }
}

function setPreviewZoom(value) {
  els.zoom.value = String(value);
  document.documentElement.style.setProperty("--page-scale", value / 100);
  els.zoomValue.textContent = `${value}%`;
}

els.importButton.addEventListener("click", importAndRender);
els.refreshButton.addEventListener("click", importAndRender);
els.quickLink.addEventListener("click", () => {
  const targetUrl = els.quickLink.dataset.targetUrl;
  if (!targetUrl) return;
  els.docsUrl.value = targetUrl;
  importAndRender();
});
els.saveIllustrations.addEventListener("click", saveIllustrations);
els.illustrationSupportEmail.addEventListener("click", updateIllustrationSupportEmail);
els.docsUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") importAndRender();
});
els.docsUrl.addEventListener("input", () => syncDocsPreview());
els.zoom.addEventListener("input", () => {
  const value = Number(els.zoom.value);
  setPreviewZoom(value);
  centerPreviewPages();
});
els.figmaToggle.addEventListener("click", () => {
  const showingFigma = els.shell.classList.contains("figma-hidden");
  if (showingFigma && els.shell.classList.contains("two-page-preview")) {
    els.shell.classList.remove("two-page-preview");
    els.spreadToggle.setAttribute("aria-pressed", "false");
    els.spreadToggle.textContent = "Two-page view";
    els.pages.setAttribute("aria-label", "Rendered packet pages");
  }
  const hidden = els.shell.classList.toggle("figma-hidden");
  els.figmaToggle.setAttribute("aria-pressed", String(hidden));
  els.figmaToggle.textContent = hidden ? "Show Figma" : "Hide Figma";
  centerPreviewPages();
});
els.spreadToggle.addEventListener("click", () => {
  const enabled = els.shell.classList.toggle("two-page-preview");
  if (enabled) {
    els.shell.classList.add("figma-hidden");
    els.figmaToggle.setAttribute("aria-pressed", "true");
    els.figmaToggle.textContent = "Show Figma";
  }
  els.spreadToggle.setAttribute("aria-pressed", String(enabled));
  els.spreadToggle.textContent = enabled ? "Single-page view" : "Two-page view";
  els.pages.setAttribute("aria-label", enabled ? "Two-page packet preview" : "Rendered packet pages");
  centerPreviewPages();
});
els.printButton.addEventListener("click", () => window.print());

els.docsLink.href = normalizeGoogleDocsUrl(els.docsUrl.value);
syncDocsPreview();
restoreSavedIllustrations();
renderIllustrationLibrary();
document.fonts.ready.then(async () => {
  els.source.innerHTML = sampleSource;
  documentModel = parseSource();
  importedSpecialPages = [];
  isLiveDocument = false;
  paginate();
  await importAndRender();
});
