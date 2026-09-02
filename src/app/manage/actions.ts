"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { writeClient } from "@/lib/supabase";
import { MANAGE_COOKIE, managePasscode, manageConfigured, isUnlocked } from "@/lib/manage";
import { parseWorkbook } from "@/lib/parse-workbook";
import { computePcs } from "@/lib/pcs";

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
