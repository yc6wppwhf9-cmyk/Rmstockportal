#!/usr/bin/env node
/**
 * Import an RM stock workbook into Supabase.
 *
 * Each sheet is treated as one Thaily (the sheet name's trailing number, or the
 * sheet name itself). Recognised columns (case-insensitive): SR NO, Size, Name,
 * Colour, Character(Design), Inventory, UOM.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/import-xlsx.mjs path/to/file.xlsx
 *
 * Upserts on (thaily, sr); never touches photo_path.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/import-xlsx.mjs <file.xlsx>");
  process.exit(1);
}
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const norm = (h) => String(h ?? "").trim().toLowerCase();
const clean = (v) => (typeof v === "string" ? v.trim() || null : v ?? null);
const pick = (row, idx, ...names) => {
  for (const n of names) if (n in idx) return clean(row[idx[n]]);
  return null;
};

const wb = XLSX.read(readFileSync(file), { type: "buffer" });
const rows = [];
for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  if (!aoa.length) continue;
  const header = aoa[0].map(norm);
  const idx = {};
  header.forEach((h, i) => (idx[h] = i));
  const m = /(\d+)\s*$/.exec(sheetName);
  const thaily = m ? m[1] : sheetName.trim();
  for (const r of aoa.slice(1)) {
    const sr = pick(r, idx, "sr no", "sr", "serial");
    if (sr == null || sr === "") continue;
    rows.push({
      thaily,
      sr: Number(sr),
      size: pick(r, idx, "size"),
      colour: pick(r, idx, "colour", "color"),
      character: pick(r, idx, "character(design)", "character", "design"),
      name: pick(r, idx, "name"),
      inventory: (() => { const v = pick(r, idx, "inventory"); return v == null ? null : Number(v); })(),
      uom: pick(r, idx, "uom"),
    });
  }
}

console.log(`Parsed ${rows.length} rows from ${wb.SheetNames.length} sheet(s).`);
const supabase = createClient(url, key, { auth: { persistSession: false } });

let done = 0;
for (let i = 0; i < rows.length; i += 200) {
  const batch = rows.slice(i, i + 200);
  const { error } = await supabase
    .from("rm_item")
    .upsert(batch, { onConflict: "thaily,sr", ignoreDuplicates: false });
  if (error) { console.error("Upsert failed:", error.message); process.exit(1); }
  done += batch.length;
  console.log(`  upserted ${done}/${rows.length}`);
}
console.log("Done.");
