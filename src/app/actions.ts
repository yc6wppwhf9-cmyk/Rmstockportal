"use server";

import { revalidatePath } from "next/cache";
import { writeClient } from "@/lib/supabase";
import { uploadImage, destroyImage } from "@/lib/cloudinary";

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
