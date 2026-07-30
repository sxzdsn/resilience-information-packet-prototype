const GOOGLE_DOC_BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,ul,ol,table,figure,img,hr";

function styleDeclarations(node, styleMap) {
  const classRules = [...node.classList].map((name) => styleMap.get(name) || "").join(";");
  return `${classRules};${node.getAttribute("style") || ""}`.toLowerCase();
}

function googleClassStyleMap(doc) {
  const map = new Map();
  const css = [...doc.querySelectorAll("style")].map((node) => node.textContent).join("\n");
  const rulePattern = /\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(css))) map.set(match[1], match[2]);
  return map;
}

function isRedStyle(declarations) {
  return /(?:^|;)\s*(?:color|background-color)\s*:\s*(?:red|#(?:f00|ff0000)\b|rgb\(\s*255\s*,\s*0\s*,\s*0\s*\)|rgba\(\s*255\s*,\s*0\s*,\s*0\s*,)/i.test(declarations);
}

function isPageBreak(node, styleMap) {
  const declarations = styleDeclarations(node, styleMap);
  if (/page-break-(?:before|after)\s*:\s*always|break-(?:before|after)\s*:\s*page/.test(declarations)) return true;
  return node.tagName === "HR" && /page-break|break-before|break-after/.test(declarations);
}

function wrapNode(node, tagName) {
  const wrapper = node.ownerDocument.createElement(tagName);
  node.replaceWith(wrapper);
  wrapper.append(node);
  return wrapper;
}

function preserveGoogleInlineStyles(root, styleMap, ignoreRedText) {
  const candidates = [root, ...root.querySelectorAll("span,a")];
  candidates.forEach((node) => {
    if (node !== root && !root.contains(node)) return;
    const declarations = styleDeclarations(node, styleMap);
    if (ignoreRedText && isRedStyle(declarations)) {
      node.remove();
      return;
    }

    if (node.tagName !== "SPAN") return;
    let outer = node;
    if (/font-weight\s*:\s*(?:bold|[6-9]00)/.test(declarations)) outer = wrapNode(outer, "strong");
    if (/font-style\s*:\s*italic/.test(declarations)) outer = wrapNode(outer, "em");
    if (/text-decoration(?:-line)?\s*:[^;]*underline/.test(declarations)) wrapNode(outer, "u");
    node.replaceWith(...node.childNodes);
  });
}

function topLevelGoogleBlocks(doc) {
  return [...doc.body.querySelectorAll(GOOGLE_DOC_BLOCK_SELECTOR)].filter((node) => {
    const parentBlock = node.parentElement?.closest(GOOGLE_DOC_BLOCK_SELECTOR);
    return !parentBlock;
  });
}

function contactItemsFromText(value) {
  const text = value.trim();
  const emailPattern = /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i;
  const phonePattern = /^(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}$/;
  const websitePattern = /^(?:https?:\/\/|www\.)[^\s,;]+$|^[a-z0-9-]+\.(?:org|com|net|edu)(?:\/[^\s,;]*)?$/i;

  // A contact value on an otherwise-empty line is an authoring signal. Check
  // email first so its domain is not mistaken for a standalone website.
  if (emailPattern.test(text) || phonePattern.test(text) || websitePattern.test(text)) {
    return [text];
  }

  const email = value.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
  const withoutEmail = email ? value.replace(email, "") : value;
  const phone = withoutEmail.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/)?.[0];
  const withoutPhone = phone ? withoutEmail.replace(phone, "") : withoutEmail;
  const website = withoutPhone.match(/(?:https?:\/\/|www\.)[^\s,;]+|\b[a-z0-9-]+\.(?:org|com|net|edu)\b[^\s,;]*/i)?.[0];
  if (!website || !phone || !email) return null;

  // A multi-value contact group must still contain contact values only; prose
  // which merely mentions them remains ordinary body copy.
  const remainingText = withoutPhone
    .replace(website, "")
    .replace(/[\s,;|•·/\\—–-]+/g, "");
  if (remainingText) return null;

  return [website.replace(/[.)]+$/, ""), phone, email];
}

function makeContactSourceBlock(items) {
  const block = document.createElement("div");
  block.dataset.blockType = "contact-row";
  items.forEach((item) => {
    const span = document.createElement("span");
    span.textContent = item;
    block.append(span);
  });
  return block;
}

function makeCardGridSourceBlock(table) {
  const grid = table.ownerDocument.createElement("div");
  grid.dataset.blockType = "card-grid";
  // Preserve the source table's orientation. A one-column Google Docs table
  // is a vertical run of rows, not a pair of side-by-side cards.
  const isSingleColumn = [...table.rows].every((row) => row.cells.length === 1);
  grid.dataset.layout = isSingleColumn ? "stack" : "columns";
  grid.dataset.importedTable = "true";
  [...table.rows].forEach((row) => {
    [...row.cells].forEach((cell) => {
      const article = table.ownerDocument.createElement("article");
      article.innerHTML = cell.innerHTML;
      grid.append(article);
    });
  });
  return grid;
}

function makeThreeRowInformationTableSourceBlock(table) {
  const rows = [...table.rows];
  if (rows.length !== 3) return null;
  const meaningfulCells = (row) => [...row.cells].filter((cell) => (
    cell.textContent.trim() || cell.querySelector("img, br")
  ));
  const [headerCells, detailCells] = rows.slice(0, 2).map(meaningfulCells);
  if (headerCells.length !== 1 || detailCells.length !== 1) return null;

  const informationTable = table.cloneNode(true);
  const citationColumnCount = Math.max(informationTable.rows[2]?.cells.length || 0, 1);
  [0, 1].forEach((rowIndex) => {
    const row = informationTable.rows[rowIndex];
    const sourceCell = meaningfulCells(row)[0];
    const cell = table.ownerDocument.createElement(rowIndex === 0 ? "th" : "td");
    cell.colSpan = citationColumnCount;
    cell.innerHTML = sourceCell.innerHTML;
    row.replaceChildren(cell);
  });
  return informationTable;
}

function declaredIndent(declarations, property) {
  const match = declarations.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(-?[\\d.]+)(?:pt|px)?`, "i"));
  return match ? Math.max(0, Number(match[1])) : 0;
}

function listIndent(list, styleMap) {
  const item = list.querySelector(":scope > li");
  if (!item) return 0;
  const declarations = styleDeclarations(item, styleMap);
  return declaredIndent(declarations, "margin-left")
    + declaredIndent(declarations, "padding-left");
}

function appendListItems(target, source) {
  [...source.children].forEach((item) => target.append(item.cloneNode(true)));
}

function normalizeAdjacentLists(nodes, styleMap) {
  const normalized = [];
  for (let start = 0; start < nodes.length;) {
    const node = nodes[start];
    if (!/^(?:UL|OL)$/.test(node.tagName)) {
      normalized.push(node);
      start += 1;
      continue;
    }

    let end = start + 1;
    while (end < nodes.length && /^(?:UL|OL)$/.test(nodes[end].tagName)) end += 1;
    const run = nodes.slice(start, end);
    const levels = [...new Set(run.map((list) => listIndent(list, styleMap)))].sort((a, b) => a - b);
    const listsByLevel = [];
    const roots = [];

    run.forEach((source) => {
      const level = levels.indexOf(listIndent(source, styleMap));
      const list = source.cloneNode(true);
      const existing = listsByLevel[level];

      if (existing && existing.tagName === list.tagName) {
        appendListItems(existing, list);
        listsByLevel.length = level + 1;
        return;
      }

      if (level > 0) {
        const parentList = listsByLevel[level - 1];
        const parentItem = parentList?.lastElementChild;
        if (parentItem) {
          parentItem.append(list);
          listsByLevel[level] = list;
          listsByLevel.length = level + 1;
          return;
        }
      }

      roots.push(list);
      listsByLevel[level] = list;
      listsByLevel.length = level + 1;
    });

    normalized.push(...roots);
    start = end;
  }
  return normalized;
}

function splitHeadingAtDoubleLineBreak(node) {
  if (!/^H[3-6]$/.test(node.tagName)) return null;
  const breakPattern = /(?:<br\b[^>]*>\s*){2,}/i;
  if (!breakPattern.test(node.innerHTML)) return null;

  const document = node.ownerDocument;
  const isMeaningful = (html) => {
    const probe = document.createElement("div");
    probe.innerHTML = html;
    return Boolean(probe.textContent.trim());
  };
  const groups = node.innerHTML.split(breakPattern).filter(isMeaningful);
  if (groups.length < 2) return null;

  const firstGroupLines = groups.shift().split(/<br\b[^>]*>/i);
  const headingHtml = firstGroupLines.shift()?.trim();
  if (!isMeaningful(headingHtml || "")) return null;

  const heading = document.createElement("h3");
  heading.innerHTML = headingHtml;
  const nodes = [heading];
  const nestedCopy = firstGroupLines.join("<br>").trim();
  if (isMeaningful(nestedCopy)) {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = nestedCopy;
    nodes.push(paragraph);
  }

  groups.forEach((group, index) => {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = group;
    if (index === 0) paragraph.dataset.breakOutOfNested = "true";
    nodes.push(paragraph);
  });
  return nodes;
}

function safeImageSource(value) {
  return /^(?:https:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(value || "");
}

function imageDimension(image, property) {
  const attribute = Number.parseFloat(image.getAttribute(property));
  if (Number.isFinite(attribute) && attribute > 0) return attribute;
  const match = (image.getAttribute("style") || "").match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([\\d.]+)px`, "i"));
  return match ? Number.parseFloat(match[1]) : 0;
}

function makeImageSourceBlocks(node) {
  const images = node.tagName === "IMG" ? [node] : [...node.querySelectorAll("img")];
  const caption = node.tagName === "IMG" ? "" : node.textContent.trim();
  return images.flatMap((sourceImage, index) => {
    const src = sourceImage.getAttribute("src") || "";
    if (!safeImageSource(src)) return [];
    const figure = node.ownerDocument.createElement("figure");
    figure.dataset.blockType = "doc-image";
    const image = node.ownerDocument.createElement("img");
    image.src = src;
    image.alt = sourceImage.getAttribute("alt") || sourceImage.getAttribute("title") || "";
    const width = imageDimension(sourceImage, "width");
    const height = imageDimension(sourceImage, "height");
    if (width) figure.dataset.width = String(width);
    if (height) figure.dataset.height = String(height);
    figure.append(image);
    if (caption && index === 0) {
      const figcaption = node.ownerDocument.createElement("figcaption");
      figcaption.textContent = caption;
      figure.append(figcaption);
    }
    return [figure];
  });
}

function pageDirectiveType(node, styleMap) {
  const match = node.textContent.trim().match(/^\[(cover|summary graphic|letter)\]$/i);
  if (!match) return "";
  const isRed = [node, ...node.querySelectorAll("span,a")]
    .some((candidate) => isRedStyle(styleDeclarations(candidate, styleMap)));
  if (!isRed) return "";
  return match[1].toLowerCase().replace(" ", "-");
}

function manualPageBreakRuns(node, styleMap) {
  return [node, ...node.querySelectorAll("span,a")].filter((candidate) => (
    /^<\s*page break\s*>$/i.test(candidate.textContent.trim())
    && isRedStyle(styleDeclarations(candidate, styleMap))
  ));
}

function isStandalonePageBreakDirective(node, styleMap) {
  return /^<\s*page break\s*>$/i.test(node.textContent.trim())
    && manualPageBreakRuns(node, styleMap).length > 0;
}

function isInlineImageDirective(node) {
  return /^\[\s*this picture should be inline\s*\]$/i.test(node.textContent.trim());
}

function isDeprecatedInlineImageDirective(node) {
  return /^<\s*inline image\s*>$/i.test(node.textContent.trim());
}

function splitAtManualPageBreaks(node, styleMap) {
  const markers = manualPageBreakRuns(node, styleMap).filter((candidate) => candidate !== node);
  if (!markers.length) return { nodes: [node], count: 0, trailingBreak: false };

  const segments = [];
  let startContainer = node;
  let startOffset = 0;
  let breakBefore = false;

  const appendSegment = (range) => {
    const segment = node.cloneNode(false);
    segment.removeAttribute("id");
    segment.append(range.cloneContents());
    const hasContent = Boolean(segment.textContent.trim() || segment.querySelector("img,br"));
    if (!hasContent) return false;
    if (breakBefore) segment.dataset.pageBreakBefore = "true";
    segments.push(segment);
    return true;
  };

  markers.forEach((marker) => {
    const range = node.ownerDocument.createRange();
    range.setStart(startContainer, startOffset);
    range.setEndBefore(marker);
    appendSegment(range);
    const parent = marker.parentNode;
    startContainer = parent;
    startOffset = [...parent.childNodes].indexOf(marker) + 1;
    breakBefore = true;
  });

  const tail = node.ownerDocument.createRange();
  tail.setStart(startContainer, startOffset);
  tail.setEnd(node, node.childNodes.length);
  const hasTrailingContent = appendSegment(tail);
  return { nodes: segments, count: markers.length, trailingBreak: !hasTrailingContent };
}

function isStartHeading(node, startHeadingAliases) {
  return /^H[1-6]$/.test(node.tagName)
    && startHeadingAliases.has(node.textContent.trim().toLocaleLowerCase());
}

function directiveSections(blocks, styleMap, startHeadingAliases) {
  const sections = [];
  let current = null;
  blocks.forEach((node) => {
    const type = pageDirectiveType(node, styleMap);
    if (type) {
      current = { type, nodes: [] };
      sections.push(current);
      return;
    }
    const letterHasSignoff = current?.type === "letter"
      && current.nodes.some((item) => /^(?:sincerely|with care|best),?$/i.test(item.textContent.trim()));
    const startsRegularContent = node.tagName === "H1" && letterHasSignoff;
    if (current && (startsRegularContent || isPageBreak(node, styleMap) || isStartHeading(node, startHeadingAliases))) {
      current = null;
    }
    if (current) current.nodes.push(node);
  });
  return sections;
}

function meaningfulText(nodes) {
  return nodes.map((node) => node.textContent.trim()).filter(Boolean);
}

function letterLineEntries(node, italic) {
  return node.innerHTML
    .split(/<br\b[^>]*>/i)
    .map((html) => {
      const container = node.ownerDocument.createElement("div");
      container.innerHTML = html;
      return { text: container.textContent.trim(), html: container.innerHTML.trim(), italic };
    })
    .filter(({ text }) => Boolean(text));
}

function parseCover(nodes) {
  const texts = meaningfulText(nodes);
  const title = nodes.find((node) => node.classList.contains("title") && node.textContent.trim())?.textContent.trim()
    || texts[0]
    || "";
  const subtitle = nodes.find((node) => node.classList.contains("subtitle") && node.textContent.trim())?.textContent.trim()
    || "";
  const allText = texts.join(" ");
  const website = allText.match(/(?:https?:\/\/|www\.)[^\s,;]+|\b[a-z0-9-]+\.(?:org|com|net|edu)\b[^\s,;]*/i)?.[0]
    ?.replace(/[.)]+$/, "")
    || "";
  const year = texts.find((text) => /^\d{4}$/.test(text)) || "";
  return { title, subtitle, website, year };
}

function splitPrimaryAndDetail(value) {
  const match = value.trim().match(/^(.+?[.!?])(?:\s+(.+))?$/);
  return match ? [match[1], match[2] || ""] : [value.trim(), ""];
}

function parseSummaryGraphic(nodes) {
  const texts = meaningfulText(nodes);
  const categoryPattern = /\bright(?:s)?\b|confidential|emotion|\bbill(?:ed|ing)?\b|\bresilience\b/i;
  const footnoteIndex = texts.findIndex((text) => /exception to confidentiality/i.test(text));
  const title = texts.find((text, index) => index !== footnoteIndex && !categoryPattern.test(text)) || texts[0] || "";

  const group = (pattern) => {
    const index = texts.findIndex((text) => pattern.test(text));
    if (index < 0) return ["", ""];
    const [primary, inlineDetail] = splitPrimaryAndDetail(texts[index]);
    const next = texts[index + 1] || "";
    const followingDetail = !inlineDetail
      && next
      && index + 1 !== footnoteIndex
      && !categoryPattern.test(next)
      ? next
      : "";
    return [primary, inlineDetail || followingDetail];
  };

  const [rights] = group(/\bright(?:s)?\b/i);
  const [confidentiality] = group(/confidential/i);
  const [emotions, emotionsDetail] = group(/emotion/i);
  const [billing, billingDetail] = group(/\bbill(?:ed|ing)?\b/i);
  const [organization, organizationDetail] = group(/\bresilience\b/i);
  return {
    title,
    rights,
    emotions,
    emotionsDetail,
    confidentiality,
    billing,
    billingDetail,
    organization: [organization, organizationDetail].filter(Boolean).join(" "),
    footnote: footnoteIndex >= 0 ? texts[footnoteIndex] : "",
  };
}

function isItalicBlock(node, styleMap) {
  const blockLength = node.textContent.trim().length;
  if (!blockLength) return false;
  return [node, ...node.querySelectorAll("span,em,i")].some((candidate) => {
    const candidateLength = candidate.textContent.trim().length;
    const isItalic = ["EM", "I"].includes(candidate.tagName)
      || /font-style\s*:\s*italic/.test(styleDeclarations(candidate, styleMap));
    return isItalic && candidateLength >= blockLength * 0.8;
  });
}

function parseLetter(nodes, styleMap) {
  const entries = nodes.flatMap((node) => {
    const italic = isItalicBlock(node, styleMap);
    return letterLineEntries(node, italic);
  });
  const blocks = entries.map(({ text }) => text);
  const salutationIndex = blocks.findIndex((text) => /^hello\b/i.test(text));
  const signoffIndex = blocks.findIndex((text) => /^(?:sincerely|with care|best),?$/i.test(text));
  const contactLineIndex = entries.findIndex(({ text }) => Boolean(contactItemsFromText(text)));
  const contacts = contactLineIndex >= 0 ? contactItemsFromText(entries[contactLineIndex].text) : [];
  const bodyStart = salutationIndex >= 0 ? salutationIndex + 1 : 0;
  const bodyEnd = signoffIndex >= 0 ? signoffIndex : blocks.length;
  const candidates = entries
    .map((entry, index) => ({ ...entry, index }))
    .filter(({ index }) => ![
      salutationIndex,
      signoffIndex,
      signoffIndex >= 0 ? signoffIndex + 1 : -1,
      contactLineIndex,
    ].includes(index));
  const bodyEntries = candidates.filter(({ index }) => index >= bodyStart && index < bodyEnd);
  const isSupportingNote = ({ italic }) => italic;
  const bodyParagraphs = bodyEntries.filter((entry) => !isSupportingNote(entry));
  const supportingNotes = candidates.filter(isSupportingNote);
  return {
    salutation: salutationIndex >= 0 ? blocks[salutationIndex] : "Hello,",
    paragraphs: bodyParagraphs.map(({ text }) => text),
    paragraphsHtml: bodyParagraphs.map(({ html }) => html),
    signoff: signoffIndex >= 0 ? blocks[signoffIndex] : "Sincerely,",
    organization: signoffIndex >= 0 ? blocks[signoffIndex + 1] || "" : "",
    notes: supportingNotes.map(({ text }) => text),
    notesHtml: supportingNotes.map(({ html }) => html),
    contacts,
    hasDivider: nodes.some((node) => node.tagName === "HR" && !isPageBreak(node, styleMap)),
    isImported: true,
  };
}

function parseSpecialPages(sections, styleMap) {
  return sections.map(({ type, nodes }) => {
    if (type === "cover") return { type, data: parseCover(nodes) };
    if (type === "summary-graphic") return { type, data: parseSummaryGraphic(nodes) };
    return { type, data: parseLetter(nodes, styleMap) };
  });
}

export function transformGoogleDocExport(html, options = {}) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const styleMap = googleClassStyleMap(doc);
  const startAtHeading = (options.startAtHeading || "").trim().toLocaleLowerCase();
  const startHeadingAliases = /^(?:in this packet|what[’']s inside|contents)$/.test(startAtHeading)
    ? new Set(["in this packet", "what’s inside", "what's inside", "contents"])
    : new Set([startAtHeading]);
  const ignoreRedText = options.ignoreRedText !== false;
  const blocks = topLevelGoogleBlocks(doc);
  const sections = directiveSections(blocks, styleMap, startHeadingAliases);
  const specialPages = parseSpecialPages(sections, styleMap);
  const specialPageNodes = new Set(sections.flatMap(({ nodes }) => nodes));
  const imported = [];
  let reachedStart = !startAtHeading;
  let ignoredRedNodes = 0;
  let importedImages = 0;
  let pendingBlankLines = 0;
  let pendingPageBreak = false;
  let pendingInlineImage = false;
  let pageBreakDirectives = 0;

  const pushImported = (...nodes) => {
    const firstNode = nodes[0];
    if (firstNode?.tagName === "H1") {
      pendingBlankLines = 0;
      pendingPageBreak = false;
    } else if (firstNode) {
      if (pendingBlankLines) firstNode.dataset.blankLinesBefore = String(pendingBlankLines);
      if (pendingPageBreak) firstNode.dataset.pageBreakBefore = "true";
      pendingBlankLines = 0;
      pendingPageBreak = false;
    }
    imported.push(...nodes);
  };

  blocks.forEach((sourceNode) => {
    if (pageDirectiveType(sourceNode, styleMap) || specialPageNodes.has(sourceNode)) {
      pendingBlankLines = 0;
      pendingInlineImage = false;
      return;
    }
    if (!reachedStart) {
      const candidate = sourceNode.textContent.trim().toLocaleLowerCase();
      if (isStartHeading(sourceNode, startHeadingAliases)) reachedStart = true;
      else return;
    }
    if (isStandalonePageBreakDirective(sourceNode, styleMap)) {
      pendingBlankLines = 0;
      pendingPageBreak = true;
      pendingInlineImage = false;
      pageBreakDirectives += 1;
      return;
    }
    if (isInlineImageDirective(sourceNode)) {
      pendingBlankLines = 0;
      pendingInlineImage = true;
      return;
    }
    if (isDeprecatedInlineImageDirective(sourceNode)) {
      pendingBlankLines = 0;
      pendingInlineImage = false;
      return;
    }
    if (isPageBreak(sourceNode, styleMap) || sourceNode.tagName === "HR") {
      pendingBlankLines = 0;
      pendingPageBreak = false;
      pendingInlineImage = false;
      return;
    }

    const node = sourceNode.cloneNode(true);
    const inlineSplit = splitAtManualPageBreaks(node, styleMap);
    if (inlineSplit.count) {
      pendingInlineImage = false;
      pageBreakDirectives += inlineSplit.count;
      inlineSplit.nodes.forEach((segment, segmentIndex) => {
        if (segmentIndex === 0 && segment.dataset.pageBreakBefore === "true") pendingBlankLines = 0;
        const redBefore = [segment, ...segment.querySelectorAll("span,a")]
          .filter((candidate) => isRedStyle(styleDeclarations(candidate, styleMap))).length;
        preserveGoogleInlineStyles(segment, styleMap, ignoreRedText);
        ignoredRedNodes += ignoreRedText ? redBefore : 0;
        if (!segment.textContent.trim()) return;
        const contacts = contactItemsFromText(segment.textContent);
        const importedNode = contacts ? makeContactSourceBlock(contacts) : segment;
        if (segment.dataset.pageBreakBefore === "true") importedNode.dataset.pageBreakBefore = "true";
        pushImported(importedNode);
      });
      if (inlineSplit.trailingBreak) pendingPageBreak = true;
      return;
    }
    const redBefore = [node, ...node.querySelectorAll("span,a")]
      .filter((candidate) => isRedStyle(styleDeclarations(candidate, styleMap))).length;
    if (ignoreRedText && isRedStyle(styleDeclarations(node, styleMap))) {
      ignoredRedNodes += 1;
      pendingInlineImage = false;
      return;
    }
    preserveGoogleInlineStyles(node, styleMap, ignoreRedText);
    ignoredRedNodes += ignoreRedText ? redBefore : 0;
    const headingSplit = splitHeadingAtDoubleLineBreak(node);
    if (headingSplit) {
      pendingInlineImage = false;
      pushImported(...headingSplit);
      return;
    }
    const imageBlocks = makeImageSourceBlocks(node);
    if (imageBlocks.length) {
      if (pendingInlineImage) {
        imageBlocks.forEach((imageBlock) => { imageBlock.dataset.imageLayout = "inline"; });
      }
      pushImported(...imageBlocks);
      importedImages += imageBlocks.length;
      pendingInlineImage = false;
      return;
    }
    if (!node.textContent.trim() && !["TABLE", "UL", "OL"].includes(node.tagName)) {
      if (node.tagName === "P") pendingBlankLines += 1;
      if (node.tagName === "H1") pendingBlankLines = 0;
      return;
    }

    pendingInlineImage = false;

    if (/^H[4-6]$/.test(node.tagName)) {
      const nestedHeading = document.createElement("h3");
      nestedHeading.innerHTML = node.innerHTML;
      pushImported(nestedHeading);
      return;
    }

    if (node.tagName === "TABLE") {
      pushImported(makeThreeRowInformationTableSourceBlock(node) || makeCardGridSourceBlock(node));
      return;
    }

    const contacts = node.tagName === "P" ? contactItemsFromText(node.textContent) : null;
    pushImported(contacts ? makeContactSourceBlock(contacts) : node);
  });

  if (!reachedStart) throw new Error(`Could not find the heading “${options.startAtHeading}” in this document.`);

  if (!imported.some((node) => node.tagName === "H1")) {
    const heading = document.createElement("h1");
    heading.textContent = doc.title.trim() || "--";
    imported.unshift(heading);
  }

  const normalizedImported = normalizeAdjacentLists(imported, styleMap);

  normalizedImported.forEach((node, index) => {
    if (node.tagName !== "H1" || normalizedImported[index + 1]?.tagName !== "P") return;
    normalizedImported[index + 1].dataset.role = "chapter-dek";
  });

  return {
    nodes: normalizedImported,
    title: doc.title.trim() || "--",
    importedImages,
    ignoredRedNodes,
    pageBreakDirectives,
    specialPages,
  };
}

function splitSectionsAtH1(nodes) {
  const sections = [];
  let section = null;
  nodes.forEach((node) => {
    if (node.tagName === "H1") {
      section = { heading: node, nodes: [] };
      sections.push(section);
    } else if (section) {
      section.nodes.push(node);
    }
  });
  return sections;
}

export function filterImportedContent(nodes) {
  return splitSectionsAtH1(nodes)
    .filter((section) => !/^hello\b/i.test(section.heading.textContent.trim()))
    .flatMap((section) => [section.heading, ...section.nodes]);
}
