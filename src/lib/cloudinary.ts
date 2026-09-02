import crypto from "node:crypto";

/**
 * Cloudinary helpers. Signed, server-side uploads: the API key and secret stay
 * on the server; the browser never sees them. Photos are addressed by their
 * Cloudinary `public_id`, which is what we store in `rm_item.photo_path`.
 */

/** Public cloud name — safe in the browser, used to build delivery URLs. */
export function cloudName(): string | undefined {
  return process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
}

/** True when server-side uploads are fully configured. */
export function uploadConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

/** Public delivery URL for a stored public_id, or null. */
export function photoUrl(publicId: string | null | undefined): string | null {
  const cloud = cloudName();
  if (!publicId || !cloud) return null;
  // f_auto,q_auto lets Cloudinary pick the best format and quality per browser.
  return `https://res.cloudinary.com/${cloud}/image/upload/f_auto,q_auto/${publicId}`;
}

function sign(params: Record<string, string | number>, secret: string): string {
  const str = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(str + secret).digest("hex");
}

export type CloudUpload = { publicId: string; url: string };

/** Upload one image (signed). Returns the stored public_id and delivery URL. */
export async function uploadImage(
  file: File,
  folder: string,
  publicId: string
): Promise<CloudUpload> {
  const cloud = cloudName();
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !apiKey || !apiSecret) {
    throw new Error("Cloudinary is not configured on the server.");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign({ folder, public_id: publicId, timestamp }, apiSecret);

  const form = new FormData();
  form.append("file", file);
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("public_id", publicId);
  form.append("signature", signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/image/upload`,
    { method: "POST", body: form }
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || "Cloudinary upload failed.");
  }
  return { publicId: json.public_id as string, url: json.secure_url as string };
}

/** Delete one image by public_id (signed). Best-effort. */
export async function destroyImage(publicId: string): Promise<void> {
  const cloud = cloudName();
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !apiKey || !apiSecret) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign({ public_id: publicId, timestamp }, apiSecret);

  const form = new FormData();
  form.append("public_id", publicId);
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);

  await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, {
    method: "POST",
    body: form,
  });
}
