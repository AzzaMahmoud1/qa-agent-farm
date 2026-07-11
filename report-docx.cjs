/**
 * Fill the SEHA Test Summary Report template (Test Report v3 1.docx).
 * Preserves headers, styles, tables, and layout — only replaces data cells.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const TEMPLATE_PATH = "/templates/test-summary-report-template.docx";

let templateZipCache = null;

function escapeXmlAttr(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatReportDate(value) {
  if (!value) {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return `${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}-${parsed.getFullYear()}`;
  }
  return String(value);
}

function regressionStatus(report) {
  const s = report.summary || {};
  if ((s.executed ?? 0) > 0 && (s.failed ?? 0) === 0) return "Completed";
  if ((s.executed ?? 0) > 0) return "In Progress";
  return "Planned";
}

/** In Scope: user story title + ticket key hyperlink (matches template). */
function inScopeItems(report) {
  const title = String(report.ticket_title || report.story_title || "").trim();
  const key = String(report.ticket_key || report.story_id || "").trim();
  const url = String(report.ticket_url || report.jira_url || "").trim();
  if (!title && !key) return [];
  return [{
    title: title || key,
    linkLabel: key || title,
    linkUrl: url || null,
  }];
}

function inScopeLines(report) {
  return inScopeItems(report).map((item) => {
    const tail = item.linkLabel && !item.title.includes(item.linkLabel) ? ` ${item.linkLabel}` : "";
    return `${item.title}${tail}`.trim();
  });
}

function nextRelationshipId(relsXml) {
  const ids = [...String(relsXml).matchAll(/Id="rId(\d+)"/g)].map((m) => parseInt(m[1], 10));
  return `rId${Math.max(0, ...ids, 0) + 1}`;
}

function addHyperlinkRelationship(relsXml, url) {
  const relId = nextRelationshipId(relsXml);
  const rel = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXmlAttr(url)}" TargetMode="External"/>`;
  return {
    relsXml: relsXml.replace("</Relationships>", `${rel}</Relationships>`),
    relId,
  };
}

function bodyTables(doc) {
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  const tables = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i];
    if (node.nodeType === 1 && node.localName === "tbl") tables.push(node);
  }
  return tables;
}

function tableRow(tbl, index) {
  return tbl.getElementsByTagNameNS(W, "tr")[index] || null;
}

function rowCell(tr, index) {
  return tr ? tr.getElementsByTagNameNS(W, "tc")[index] || null : null;
}

function clearCellContent(tc) {
  const toRemove = [];
  for (let i = 0; i < tc.childNodes.length; i++) {
    const node = tc.childNodes[i];
    if (node.nodeType === 1 && (node.localName === "p" || node.localName === "tbl")) {
      toRemove.push(node);
    }
  }
  toRemove.forEach((node) => tc.removeChild(node));
}

function setParagraphText(p, text, doc) {
  const remove = [];
  for (let i = 0; i < p.childNodes.length; i++) {
    const node = p.childNodes[i];
    if (node.nodeType === 1 && (node.localName === "r" || node.localName === "hyperlink")) {
      remove.push(node);
    }
  }
  remove.forEach((node) => p.removeChild(node));
  const r = doc.createElementNS(W, "w:r");
  const t = doc.createElementNS(W, "w:t");
  t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  t.textContent = text;
  r.appendChild(t);
  p.appendChild(r);
}

function setCellText(tc, text, doc) {
  clearCellContent(tc);
  const p = doc.createElementNS(W, "w:p");
  setParagraphText(p, text, doc);
  tc.appendChild(p);
}

function findInScopeParagraphTemplate(tc) {
  const paras = tc.getElementsByTagNameNS(W, "p");
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const style = p.getElementsByTagNameNS(W, "pStyle")[0];
    if (style && style.getAttributeNS(W, "val") === "ListParagraph" && p.getElementsByTagNameNS(W, "hyperlink").length) {
      return p;
    }
  }
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (p.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") === "ListParagraph") {
      return p;
    }
  }
  return paras[0] || null;
}

function setParagraphTitleAndLink(p, doc, item, relId) {
  const title = item.title.endsWith(" ") ? item.title : `${item.title} `;
  const runs = p.getElementsByTagNameNS(W, "r");
  const titleRun = runs.length ? runs[0] : null;
  if (titleRun) {
    let t = titleRun.getElementsByTagNameNS(W, "t")[0];
    if (!t) {
      t = doc.createElementNS(W, "w:t");
      t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
      titleRun.appendChild(t);
    }
    t.textContent = title;
  }

  let hyperlink = p.getElementsByTagNameNS(W, "hyperlink")[0];
  if (item.linkUrl && relId) {
    if (!hyperlink) {
      hyperlink = doc.createElementNS(W, "w:hyperlink");
      const linkRun = doc.createElementNS(W, "w:r");
      const linkT = doc.createElementNS(W, "w:t");
      linkT.textContent = item.linkLabel || "";
      linkRun.appendChild(linkT);
      hyperlink.appendChild(linkRun);
      p.appendChild(hyperlink);
    }
    hyperlink.setAttributeNS(R, "id", relId);
    const linkRun = hyperlink.getElementsByTagNameNS(W, "r")[0];
    if (linkRun) {
      let linkT = linkRun.getElementsByTagNameNS(W, "t")[0];
      if (!linkT) {
        linkT = doc.createElementNS(W, "w:t");
        linkRun.appendChild(linkT);
      }
      linkT.textContent = item.linkLabel || "";
    }
  } else if (hyperlink) {
    const linkRun = hyperlink.getElementsByTagNameNS(W, "r")[0];
    if (linkRun) {
      let linkT = linkRun.getElementsByTagNameNS(W, "t")[0];
      if (!linkT) {
        linkT = doc.createElementNS(W, "w:t");
        linkRun.appendChild(linkT);
      }
      linkT.textContent = item.linkLabel || "";
    }
    hyperlink.removeAttributeNS(R, "id");
  } else if (item.linkLabel && !title.includes(item.linkLabel)) {
    const extra = doc.createElementNS(W, "w:r");
    const extraT = doc.createElementNS(W, "w:t");
    extraT.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    extraT.textContent = item.linkLabel;
    extra.appendChild(extraT);
    p.appendChild(extra);
  }
}

function setCellInScope(tc, items, doc, relsState) {
  const templatePara = findInScopeParagraphTemplate(tc);
  clearCellContent(tc);
  const list = (items || []).filter((i) => i && (i.title || i.linkLabel));
  if (!list.length) {
    setCellText(tc, "—", doc);
    return;
  }
  for (const item of list) {
    const p = templatePara ? templatePara.cloneNode(true) : doc.createElementNS(W, "w:p");
    let relId = null;
    if (item.linkUrl) {
      const added = addHyperlinkRelationship(relsState.relsXml, item.linkUrl);
      relsState.relsXml = added.relsXml;
      relId = added.relId;
    }
    setParagraphTitleAndLink(p, doc, item, relId);
    tc.appendChild(p);
  }
}

function fillDocumentXml(report, xml, relsXml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const relsState = { relsXml: relsXml || "" };
  const tables = bodyTables(doc);
  if (tables.length < 3) {
    throw new Error("Report template structure changed — expected 3 main tables");
  }

  const general = tables[0];
  const overview = tables[1];
  const footer = tables[2];
  const s = report.summary || {};
  const d = report.defects || {};

  setCellText(rowCell(tableRow(general, 0), 1), report.project_name || "SEHA", doc);

  setCellText(rowCell(tableRow(general, 2), 0), report.version_info || report.environment_detail || "—", doc);
  setCellText(rowCell(tableRow(general, 2), 1), report.release_no || report.ticket_title || report.ticket_key || "—", doc);
  setCellText(rowCell(tableRow(general, 2), 2), formatReportDate(report.report_date), doc);
  setCellText(rowCell(tableRow(general, 2), 3), report.environment || "QA", doc);

  const scopeRow = tableRow(overview, 4);
  setCellInScope(rowCell(scopeRow, 0), inScopeItems(report), doc, relsState);
  setCellText(
    rowCell(scopeRow, 1),
    (report.out_of_scope || []).join("\n") || "—",
    doc,
  );
  setCellText(
    rowCell(scopeRow, 2),
    (report.items_not_tested || []).join("\n") || "—",
    doc,
  );
  setCellText(rowCell(scopeRow, 3), report.regression_status || regressionStatus(report), doc);

  setCellText(rowCell(tableRow(overview, 7), 0), String(s.planned ?? 0), doc);
  setCellText(rowCell(tableRow(overview, 7), 1), String(s.executed ?? 0), doc);
  setCellText(rowCell(tableRow(overview, 7), 2), String(s.passed ?? 0), doc);
  setCellText(rowCell(tableRow(overview, 7), 3), String(s.failed ?? 0), doc);

  setCellText(rowCell(tableRow(overview, 10), 0), String(d.reported ?? 0), doc);
  setCellText(rowCell(tableRow(overview, 10), 1), String(d.fixed ?? 0), doc);
  setCellText(rowCell(tableRow(overview, 10), 3), String(d.low ?? 0), doc);
  setCellText(rowCell(tableRow(overview, 11), 3), String(d.medium ?? 0), doc);
  setCellText(rowCell(tableRow(overview, 12), 3), String(d.high ?? 0), doc);

  setCellText(rowCell(tableRow(footer, 1), 0), report.comments || "NA", doc);
  setCellText(
    rowCell(tableRow(footer, 2), 1),
    report.reported_by || "QA Agent Farm",
    doc,
  );

  const serializer = new XMLSerializer();
  return {
    xml: serializer.serializeToString(doc),
    relsXml: relsState.relsXml,
  };
}

async function loadTemplateZip() {
  if (templateZipCache) return templateZipCache;
  const res = await fetch(TEMPLATE_PATH);
  if (!res.ok) {
    throw new Error(`Report template not found (${TEMPLATE_PATH}). Run via node server.js.`);
  }
  const JSZip = typeof window !== "undefined" ? window.JSZip : null;
  if (!JSZip) throw new Error("JSZip is required");
  templateZipCache = await JSZip.loadAsync(await res.arrayBuffer());
  return templateZipCache;
}

async function buildReportDocxBlob(report) {
  const zip = await loadTemplateZip();
  const xml = await zip.file("word/document.xml").async("string");
  const relsXml = await zip.file("word/_rels/document.xml.rels").async("string");
  const filled = fillDocumentXml(report, xml, relsXml);
  zip.file("word/document.xml", filled.xml);
  zip.file("word/_rels/document.xml.rels", filled.relsXml);
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fillDocumentXml,
    buildReportDocxBlob,
    formatReportDate,
    inScopeLines,
    inScopeItems,
    TEMPLATE_PATH,
  };
}
if (typeof window !== "undefined") {
  window.buildReportDocxBlob = buildReportDocxBlob;
  window.fillDocumentXml = fillDocumentXml;
  window.inScopeItems = inScopeItems;
  window.formatReportDate = formatReportDate;
}
