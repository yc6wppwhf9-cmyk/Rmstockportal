import * as XLSX from "xlsx";

export type ParsedRow = {
  department: string;
  thaily: string;
  sr: number;
  size: string | null;
  colour: string | null;
  character: string | null;
  name: string | null;
  inventory: number | null;
  uom: string | null;
  extra: Record<string, string>;
};

const norm = (h: unknown) => String(h ?? "").trim().toLowerCase();
const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const num = (v: unknown): number | null => {
  const s = clean(v);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Header synonyms → our core fields. First match wins.
const MAP: Record<string, string[]> = {
  sr: ["sr no", "sr", "serial", "serial no", "s.no", "sno"],
  thaily: ["thaily", "group"],
  size: ["size"],
  colourCode: ["colour code", "color code"],
  colour: ["colour", "color"],
  character: ["character(design)", "character", "design"],
  name: ["item name", "name", "article name"],
  inventory: ["stock (pcs)", "stock", "inventory", "qty", "quantity", "stock qty"],
  uom: ["uom", "unit"],
  inv: ["inv", "inv no", "inv code", "lot"],
};

// Columns we consume into typed fields (so they don't also land in `extra`).
const CONSUMED = new Set([
  ...MAP.sr, ...MAP.thaily, ...MAP.size, ...MAP.colourCode, ...MAP.colour,
  ...MAP.character, ...MAP.name, ...MAP.inventory, ...MAP.uom,
  "chain image", "image", "image map", "photo", "picture", // embedded-image columns: ignored here
]);

function titleCase(h: string): string {
  return h.replace(/\b\w/g, (m) => m.toUpperCase());
}

export function parseWorkbook(buf: ArrayBuffer, department: string): ParsedRow[] {
  const wb = XLSX.read(buf, { type: "array" });
  const out: ParsedRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
    if (!aoa.length) continue;

    const header = (aoa[0] as unknown[]).map(norm);
    const idx: Record<string, number> = {};
    header.forEach((h, i) => { if (!(h in idx)) idx[h] = i; });
    const col = (names: string[]): number | undefined => {
      for (const n of names) if (n in idx) return idx[n];
      return undefined;
    };

    const iSr = col(MAP.sr);
    if (iSr === undefined) continue; // not a data sheet

    // Group: an explicit Thaily/Group column, else the sheet's trailing number,
    // else "All".
    const iGroup = col(MAP.thaily);
    const m = /(\d+)\s*$/.exec(sheetName);
    const sheetGroup = m ? m[1] : "All";

    const iColourCode = col(MAP.colourCode);
    const iColour = col(MAP.colour);
    const iInv = col(MAP.inv);

    for (const rowRaw of aoa.slice(1)) {
      const row = rowRaw as unknown[];
      const sr = num(row[iSr]);
      if (sr === null) continue;

      const group = (iGroup !== undefined ? clean(row[iGroup]) : null) ?? sheetGroup;

      // colour: prefer the code column; if both code and full colour exist, the
      // full name goes to extra.
      let colour: string | null = null;
      const extra: Record<string, string> = {};
      if (iColourCode !== undefined) {
        colour = clean(row[iColourCode]);
        const full = iColour !== undefined ? clean(row[iColour]) : null;
        if (full) extra["Colour"] = full;
      } else if (iColour !== undefined) {
        colour = clean(row[iColour]);
      }

      if (iInv !== undefined) {
        const inv = clean(row[iInv]);
        if (inv) extra["INV"] = inv;
      }

      // Any other unrecognised column → extra, keyed by its original header.
      header.forEach((h, i) => {
        if (!h || CONSUMED.has(h) || MAP.inv.includes(h)) return;
        const v = clean(row[i]);
        if (v !== null && !(titleCase(h) in extra)) extra[titleCase(h)] = v;
      });

      const iSize = col(MAP.size);
      const iChar = col(MAP.character);
      const iName = col(MAP.name);
      const iInvq = col(MAP.inventory);
      const iUom = col(MAP.uom);
      // Infer UOM from a "Stock (Pcs)" style header when there's no UOM column.
      const stockHeader = MAP.inventory.find((n) => n in idx);
      const inferredUom = stockHeader && /\(([^)]+)\)/.exec(stockHeader)?.[1];

      out.push({
        department,
        thaily: group,
        sr,
        size: iSize !== undefined ? clean(row[iSize]) : null,
        colour,
        character: iChar !== undefined ? clean(row[iChar]) : null,
        name: iName !== undefined ? clean(row[iName]) : null,
        inventory: iInvq !== undefined ? num(row[iInvq]) : null,
        uom: (iUom !== undefined ? clean(row[iUom]) : null) ?? (inferredUom ? titleCase(inferredUom) : null),
        extra,
      });
    }
  }

  return out;
}
