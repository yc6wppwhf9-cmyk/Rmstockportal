import JSZip from "jszip";
import * as XLSX from "xlsx";

/**
 * Extract the images embedded in an .xlsx and map each to its row's serial —
 * all in the browser, so the (large) workbook never has to be uploaded to the
 * server. Each returned image is small and can be uploaded individually.
 */
export type ExtractedImage = { group: string; sr: number; blob: Blob };

const SR_HEADERS = ["sr no", "sr", "serial", "serial no", "s.no", "s no", "sno", "l"];
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

function groupForSheet(name: string): string {
  const m = /(\d+)\s*$/.exec(name);
  return m ? m[1] : "All";
}

function resolvePath(baseFile: string, rel: string): string {
  if (rel.startsWith("/")) return rel.slice(1);
  const parts = baseFile.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const firstByLocal = (root: Element | Document, local: string): Element | null => {
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) if (all[i].localName === local) return all[i];
  return null;
};
const allByLocal = (root: Element | Document, local: string): Element[] => {
  const out: Element[] = [];
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) if (all[i].localName === local) out.push(all[i]);
  return out;
};
const attrEndsWith = (el: Element, name: string) => {
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.name === name || a.name.endsWith(":" + name)) return a.value;
  }
  return null;
};

export async function extractImagesBySerial(file: File): Promise<ExtractedImage[]> {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const wb = XLSX.read(buf, { type: "array" });
  const parser = new DOMParser();
  const readXml = async (path: string) => {
    const f = zip.file(path);
    if (!f) return null;
    return parser.parseFromString(await f.async("string"), "application/xml");
  };

  // sheet name -> worksheet xml path
  const wbDoc = await readXml("xl/workbook.xml");
  const wbRels = await readXml("xl/_rels/workbook.xml.rels");
  if (!wbDoc || !wbRels) return [];
  const relTarget: Record<string, string> = {};
  for (const r of allByLocal(wbRels, "Relationship")) {
    const id = r.getAttribute("Id");
    if (id) relTarget[id] = r.getAttribute("Target") || "";
  }
  const sheetPath: Record<string, string> = {};
  for (const s of allByLocal(wbDoc, "sheet")) {
    const name = s.getAttribute("name");
    const rid = attrEndsWith(s, "id");
    if (name && rid && relTarget[rid]) sheetPath[name] = resolvePath("xl/workbook.xml", relTarget[rid]);
  }

  const out: ExtractedImage[] = [];

  for (const sheetName of wb.SheetNames) {
    const wsPath = sheetPath[sheetName];
    if (!wsPath) continue;

    // SR column + absolute-row values, from SheetJS (blank rows kept so row
    // indices line up with the drawing's anchor rows).
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: null });
    if (!aoa.length) continue;
    const header = (aoa[0] as unknown[]).map(norm);
    const srCol = header.findIndex((h) => SR_HEADERS.includes(h));
    if (srCol === -1) continue;
    const group = groupForSheet(sheetName);

    // worksheet -> drawing
    const wsRels = await readXml(wsPath.replace(/([^/]+)$/, "_rels/$1.rels"));
    if (!wsRels) continue;
    let drawingPath: string | null = null;
    for (const r of allByLocal(wsRels, "Relationship")) {
      if ((r.getAttribute("Type") || "").endsWith("/drawing")) {
        drawingPath = resolvePath(wsPath, r.getAttribute("Target") || "");
        break;
      }
    }
    if (!drawingPath) continue;

    const drawDoc = await readXml(drawingPath);
    const drawRels = await readXml(drawingPath.replace(/([^/]+)$/, "_rels/$1.rels"));
    if (!drawDoc || !drawRels) continue;
    const embedTarget: Record<string, string> = {};
    for (const r of allByLocal(drawRels, "Relationship")) {
      const id = r.getAttribute("Id");
      if (id) embedTarget[id] = resolvePath(drawingPath, r.getAttribute("Target") || "");
    }

    // each anchor: from-row + embedded image id
    const anchors = [
      ...allByLocal(drawDoc, "twoCellAnchor"),
      ...allByLocal(drawDoc, "oneCellAnchor"),
    ];
    for (const anchor of anchors) {
      const from = firstByLocal(anchor, "from");
      const rowEl = from ? firstByLocal(from, "row") : null;
      if (!rowEl) continue;
      const rowIdx = Number(rowEl.textContent); // 0-based absolute row
      const blip = firstByLocal(anchor, "blip");
      const embed = blip ? attrEndsWith(blip, "embed") : null;
      if (!embed || !embedTarget[embed]) continue;

      const row = aoa[rowIdx] as unknown[] | undefined;
      const sr = row ? Number(String(row[srCol] ?? "").trim()) : NaN;
      if (!Number.isFinite(sr)) continue;

      const mediaFile = zip.file(embedTarget[embed]);
      if (!mediaFile) continue;
      const blob = await mediaFile.async("blob");
      out.push({ group, sr, blob });
    }
  }

  return out;
}
