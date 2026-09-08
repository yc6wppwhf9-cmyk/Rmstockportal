"use server";

import { revalidatePath } from "next/cache";
import { writeClient } from "@/lib/supabase";
import { uploadImage, destroyImage } from "@/lib/cloudinary";
import { computePcs } from "@/lib/pcs";

export type UploadResult =
  | { ok: true; photoUrl: string }
  | { ok: false; error: string };

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB — a downscaled phone photo is well under this.
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function safe(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Upload (or replace) the photo for one item, identified by thaily + serial. */
export async function uploadPhoto(formData: FormData): Promise<UploadResult> {
  const department = String(formData.get("department") ?? "").trim();
  const thaily = String(formData.get("thaily") ?? "").trim();
  const sr = String(formData.get("sr") ?? "").trim();
  const file = formData.get("photo");

  if (!department || !thaily || !sr) return { ok: false, error: "Missing item." };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image." };
  }
  if (!ALLOWED.has(file.type)) {
    return { ok: false, error: "Use a JPEG, PNG, WebP or GIF image." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image is larger than the 6 MB limit." };
  }

  let supabase;
  try {
    supabase = writeClient();
  } catch {
    return { ok: false, error: "Server isn't configured for writes yet." };
  }

  // Upload to Cloudinary first.
  let uploaded;
  try {
    const folder = `rm-stock/thaily-${safe(thaily)}`;
    const publicId = `${safe(sr)}-${Date.now()}`;
    uploaded = await uploadImage(file, folder, publicId);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Photo upload failed.",
    };
  }

  // Point the row at the new image; remember the previous one to clean up.
  const { data: prev } = await supabase
    .from("rm_item")
    .select("photo_path")
    .eq("department", department)
    .eq("thaily", thaily)
    .eq("sr", Number(sr))
    .single();

  const { error: updErr } = await supabase
    .from("rm_item")
    .update({ photo_path: uploaded.publicId, photo_updated_at: new Date().toISOString() })
    .eq("department", department)
    .eq("thaily", thaily)
    .eq("sr", Number(sr));

  if (updErr) {
    await destroyImage(uploaded.publicId); // roll back the orphaned upload
    return { ok: false, error: updErr.message };
  }

  const previous = prev?.photo_path as string | null | undefined;
  if (previous && previous !== uploaded.publicId) {
    await destroyImage(previous);
  }

  revalidatePath("/");
  return { ok: true, photoUrl: uploaded.url };
}

export type RemoveResult = { ok: boolean; error?: string };

/** Remove the photo for one item. */
export async function removePhoto(formData: FormData): Promise<RemoveResult> {
  const department = String(formData.get("department") ?? "").trim();
  const thaily = String(formData.get("thaily") ?? "").trim();
  const sr = String(formData.get("sr") ?? "").trim();
  if (!department || !thaily || !sr) return { ok: false, error: "Missing item." };

  let supabase;
  try {
    supabase = writeClient();
  } catch {
    return { ok: false, error: "Not configured." };
  }

  const { data: row } = await supabase
    .from("rm_item")
    .select("photo_path")
    .eq("department", department)
    .eq("thaily", thaily)
    .eq("sr", Number(sr))
    .single();

  const path = row?.photo_path as string | null | undefined;

  const { error } = await supabase
    .from("rm_item")
    .update({ photo_path: null, photo_updated_at: null })
    .eq("department", department)
    .eq("thaily", thaily)
    .eq("sr", Number(sr));
  if (error) return { ok: false, error: error.message };

  if (path) await destroyImage(path);

  revalidatePath("/");
  return { ok: true };
}

export type UpdateInvResult = { ok: boolean; inv?: string | null; error?: string };

/** Update or set the INV code for one item. */
export async function updateInv(formData: FormData): Promise<UpdateInvResult> {
  const department = String(formData.get("department") ?? "").trim();
  const thaily = String(formData.get("thaily") ?? "").trim();
  const sr = String(formData.get("sr") ?? "").trim();
  const inv = String(formData.get("inv") ?? "").trim();

  if (!department || !thaily || !sr) return { ok: false, error: "Missing item details." };

  let supabase;
  try {
    supabase = writeClient();
  } catch {
    return { ok: false, error: "Server isn't configured for writes." };
  }

  // Get current extra object
  const { data: row, error: fetchErr } = await supabase
    .from("rm_item")
    .select("extra")
    .eq("department", department)
    .eq("thaily", thaily)
    .eq("sr", Number(sr))
    .single();

  if (fetchErr) return { ok: false, error: fetchErr.message };

  const extra = (row?.extra as Record<string, string> | null) ?? {};
  if (inv) {
    extra["INV"] = inv;
  } else {
    delete extra["INV"];
    delete extra["inv"];
    delete extra["Inv"];
  }

  const { error: updErr } = await supabase
    .from("rm_item")
    .update({ extra })
    .eq("department", department)
    .eq("thaily", thaily)
    .eq("sr", Number(sr));

  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath("/");
  return { ok: true, inv: inv || null };
}

export type DeleteItemResult = { ok: boolean; error?: string };

/** Permanently delete an item (and its photo if one exists). */
export async function deleteItem(formData: FormData): Promise<DeleteItemResult> {
  const department = String(formData.get("department") ?? "").trim();
  const thaily = String(formData.get("thaily") ?? "").trim();
  const sr = String(formData.get("sr") ?? "").trim();

  if (!department || !thaily || !sr) return { ok: false, error: "Missing item details." };

  let supabase;
  try {
    supabase = writeClient();
  } catch {
    return { ok: false, error: "Server isn't configured for writes." };
  }

  // Check if item has a photo to clean up
  const { data: row } = await supabase
    .from("rm_item")
    .select("photo_path")
    .eq("department", department)
    .eq("thaily", thaily)
    .eq("sr", Number(sr))
    .single();

  const path = row?.photo_path as string | null | undefined;

  const { error } = await supabase
    .from("rm_item")
    .delete()
    .eq("department", department)
    .eq("thaily", thaily)
    .eq("sr", Number(sr));

  if (error) return { ok: false, error: error.message };

  if (path) {
    try {
      await destroyImage(path);
    } catch {
      /* continue even if image destroy fails */
    }
  }

  revalidatePath("/");
  return { ok: true };
}

export type UpdateStockResult = {
  ok: boolean;
  inventory?: number | null;
  qty_pcs?: number | null;
  error?: string;
};

/** Update the stock / inventory quantity for one item. */
export async function updateStock(formData: FormData): Promise<UpdateStockResult> {
  const department = String(formData.get("department") ?? "").trim();
  const thaily = String(formData.get("thaily") ?? "").trim();
  const sr = String(formData.get("sr") ?? "").trim();
  const invRaw = String(formData.get("inventory") ?? "").trim();

  if (!department || !thaily || !sr) return { ok: false, error: "Missing item details." };

  let supabase;
  try {
    supabase = writeClient();
  } catch {
    return { ok: false, error: "Server isn't configured for writes." };
  }

  // Get current row to know uom & size for pcs calculation
  const { data: row, error: fetchErr } = await supabase
    .from("rm_item")
    .select("uom, size")
    .eq("department", department)
    .eq("thaily", thaily)
    .eq("sr", Number(sr))
    .single();

  if (fetchErr) return { ok: false, error: fetchErr.message };

  const inventory = invRaw ? Number(invRaw.replace(/,/g, "")) : null;
  if (invRaw && (inventory == null || !Number.isFinite(inventory) || inventory < 0)) {
    return { ok: false, error: "Stock quantity must be a valid non-negative number." };
  }

  const qty_pcs = computePcs(row?.uom, inventory, row?.size);

  const { error: updErr } = await supabase
    .from("rm_item")
    .update({ inventory, qty_pcs })
    .eq("department", department)
    .eq("thaily", thaily)
    .eq("sr", Number(sr));

  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath("/");
  return { ok: true, inventory, qty_pcs };
}
