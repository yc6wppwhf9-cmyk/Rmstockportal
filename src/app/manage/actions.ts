"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { writeClient } from "@/lib/supabase";
import { MANAGE_COOKIE, managePasscode, manageConfigured, isUnlocked } from "@/lib/manage";
import { parseWorkbook } from "@/lib/parse-workbook";
import { computePcs } from "@/lib/pcs";
import { uploadImageBuffer } from "@/lib/cloudinary";
import ExcelJS from "exceljs";

export type UnlockState = { ok: boolean; error?: string };

export async function unlock(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  if (!manageConfigured()) return { ok: true };
  const code = String(formData.get("passcode") ?? "");
  if (code !== managePasscode()) return { ok: false, error: "Wrong passcode." };
  const c = await cookies();
  c.set(MANAGE_COOKIE, code, {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return { ok: true };
}

export type ImportState =
  | { ok: true; imported: number; department: string; groups: string[] }
  | { ok: false; error: string }
  | null;

export async function importWorkbook(_prev: ImportState, formData: FormData): Promise<ImportState> {
  if (!(await isUnlocked())) return { ok: false, error: "Enter the passcode first." };

  const department = String(formData.get("department") ?? "").trim();
  const file = formData.get("file");
  if (!department) return { ok: false, error: "Enter a department name." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an .xlsx file." };
  if (file.size > 25 * 1024 * 1024) return { ok: false, error: "File is larger than 25 MB." };

  let rows;
  try {
    rows = parseWorkbook(await file.arrayBuffer(), department);
  } catch {
    return { ok: false, error: "Couldn’t read that file. Is it a valid .xlsx?" };
  }
  if (rows.length === 0) {
    return { ok: false, error: "No rows found. The sheet needs an 'SR No' column." };
  }

  let supabase;
  try { supabase = writeClient(); } catch { return { ok: false, error: "Server isn’t configured for writes." }; }

  // Upsert in batches; never overwrite an existing photo.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("rm_item")
      .upsert(rows.slice(i, i + 200), { onConflict: "department,thaily,sr", ignoreDuplicates: false });
    if (error) return { ok: false, error: error.message };
  }

  const groups = [...new Set(rows.map((r) => r.thaily))];
  revalidatePath("/");
  revalidatePath("/manage");
  return { ok: true, imported: rows.length, department, groups };
}

export type AddState = { ok: boolean; error?: string };

export async function addItem(formData: FormData): Promise<AddState> {
  if (!(await isUnlocked())) return { ok: false, error: "Enter the passcode first." };

  const g = (k: string) => String(formData.get(k) ?? "").trim();
  const department = g("department");
  const thaily = g("thaily") || "All";
  const srRaw = g("sr");
  if (!department) return { ok: false, error: "Choose a department." };
  if (!srRaw) return { ok: false, error: "Serial number is required." };
  const sr = Number(srRaw);
  if (!Number.isInteger(sr) || sr < 0) return { ok: false, error: "Serial number must be a whole number." };

  const invRaw = g("inventory");
  const extra: Record<string, string> = {};
  const colourName = g("colour_name");
  const inv = g("inv");
  if (colourName) extra["Colour"] = colourName;
  if (inv) extra["INV"] = inv;

  const size = g("size") || null;
  const uom = g("uom") || null;
  const inventory = invRaw ? Number(invRaw.replace(/,/g, "")) : null;
  const record = {
    department,
    thaily,
    sr,
    size,
    colour: g("colour") || null,
    character: g("character") || null,
    name: g("name") || null,
    inventory,
    uom,
    qty_pcs: computePcs(uom, inventory, size),
    extra,
  };

  let supabase;
  try { supabase = writeClient(); } catch { return { ok: false, error: "Server isn’t configured for writes." }; }

  const { error } = await supabase
    .from("rm_item")
    .upsert(record, { onConflict: "department,thaily,sr", ignoreDuplicates: false });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  revalidatePath("/manage");
  return { ok: true };
}

/* ── Import embedded photos from an Excel workbook ─────────────────────────
   The Labels/Runner sheets carry a photo per row in an image column. This
   extracts those images, maps each to its row's serial, uploads to Cloudinary
   and links it. Resumable: only rows without a photo are processed, and each
   call stops at a time budget so a large sheet finishes over several calls. */
export type PhotoImportState =
  | { ok: true; uploaded: number; remaining: number; total: number; failed: number }
  | { ok: false; error: string }
  | null;

const SR_HEADERS = ["sr no", "sr", "serial", "serial no", "s.no", "s no", "sno"];
const TIME_BUDGET_MS = 45000;

function groupForSheet(name: string): string {
  const m = /(\d+)\s*$/.exec(name);
  return m ? m[1] : "All";
}

export async function importPhotos(_prev: PhotoImportState, formData: FormData): Promise<PhotoImportState> {
  if (!(await isUnlocked())) return { ok: false, error: "Enter the passcode first." };
  const department = String(formData.get("department") ?? "").trim();
  const file = formData.get("file");
  if (!department) return { ok: false, error: "Enter a department name." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the .xlsx file." };

  let supabase;
  try { supabase = writeClient(); } catch { return { ok: false, error: "Server isn’t configured for writes." }; }

  // Which items exist and which already have a photo (paged past the 1000 cap).
  const hasPhoto = new Set<string>();
  const known = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data: existing, error: exErr } = await supabase
      .from("rm_item").select("thaily, sr, photo_path").eq("department", department)
      .order("sr", { ascending: true }).range(from, from + 999);
    if (exErr) return { ok: false, error: exErr.message };
    for (const r of existing ?? []) {
      const k = `${r.thaily}::${r.sr}`;
      known.add(k);
      if (r.photo_path) hasPhoto.add(k);
    }
    if (!existing || existing.length < 1000) break;
  }

  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); }
  catch { return { ok: false, error: "Couldn’t read that .xlsx." }; }

  // Build the list of images to upload (skip rows already done / unknown).
  type Job = { group: string; sr: number; imageId: number };
  const jobs: Job[] = [];
  let total = 0;
  wb.eachSheet((ws) => {
    // find SR column from the header row
    const header = ws.getRow(1);
    let srCol = -1;
    header.eachCell((cell, col) => {
      const h = String(cell.value ?? "").trim().toLowerCase();
      if (srCol === -1 && SR_HEADERS.includes(h)) srCol = col;
    });
    if (srCol === -1) return;
    const group = groupForSheet(ws.name);
    for (const img of ws.getImages()) {
      const nativeRow = img.range?.tl?.nativeRow; // 0-based
      if (nativeRow == null) continue;
      const srVal = ws.getRow(nativeRow + 1).getCell(srCol).value;
      const sr = Number(String(srVal ?? "").trim());
      if (!Number.isFinite(sr)) continue;
      const key = `${group}::${sr}`;
      if (!known.has(key)) continue;
      total++;
      if (hasPhoto.has(key)) continue;
      jobs.push({ group, sr, imageId: Number(img.imageId) });
    }
  });

  const start = Date.now();
  let uploaded = 0;
  let failed = 0;
  let idx = 0;
  const CONC = 6;
  const worker = async () => {
    while (idx < jobs.length && Date.now() - start < TIME_BUDGET_MS) {
      const job = jobs[idx++];
      try {
        const media = wb.getImage(job.imageId) as unknown as { buffer: Buffer; extension: string };
        const ext = (media.extension || "png").toLowerCase();
        const up = await uploadImageBuffer(
          Buffer.from(media.buffer),
          ext,
          `rm-stock/${department.replace(/[^a-zA-Z0-9._-]/g, "_")}/thaily-${job.group}`,
          `${job.sr}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        );
        const { error } = await supabase
          .from("rm_item")
          .update({ photo_path: up.publicId, photo_updated_at: new Date().toISOString() })
          .eq("department", department).eq("thaily", job.group).eq("sr", job.sr);
        if (error) { failed++; } else { uploaded++; }
      } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONC, jobs.length) }, worker));

  revalidatePath("/");
  return { ok: true, uploaded, remaining: jobs.length - idx, total, failed };
}
