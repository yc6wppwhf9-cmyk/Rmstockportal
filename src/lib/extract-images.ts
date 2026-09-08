import ExcelJS from "exceljs";
import { uploadImage, uploadConfigured } from "./cloudinary";
import type { SupabaseClient } from "@supabase/supabase-js";

function safe(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export type ExtractedImage = {
  department: string;
  thaily: string;
  sr: number;
  buffer: Buffer;
  extension: string;
};

/**
 * Extract embedded photos from each worksheet in the Excel workbook,
 * upload them to Cloudinary, and update the rm_item photo_path in Supabase.
 */
export async function extractAndUploadExcelImages(
  buf: ArrayBuffer | Buffer,
  department: string,
  supabase: SupabaseClient
): Promise<number> {
  if (!uploadConfigured()) return 0;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Buffer);

  const imagesToUpload: ExtractedImage[] = [];

  for (const ws of wb.worksheets) {
    const sheetName = ws.name;
    const m = /(\d+)\s*$/.exec(sheetName);
    const sheetGroup = m ? m[1] : (sheetName.trim() || "All");

    const headerRow = ws.getRow(1);
    let srColIdx: number | null = null;
    let groupColIdx: number | null = null;

    headerRow.eachCell((cell, colNumber) => {
      const h = String(cell.value ?? "").trim().toLowerCase();
      if (["sr no", "sr", "serial", "serial no", "s.no", "s no", "sno"].includes(h)) {
        srColIdx = colNumber;
      } else if (["thaily", "group"].includes(h)) {
        groupColIdx = colNumber;
      }
    });

    if (srColIdx === null) continue;

    const images = ws.getImages();
    for (const img of images) {
      const rowIdx = Math.floor(img.range.tl.nativeRow ?? img.range.tl.row) + 1;
      if (rowIdx <= 1) continue;

      const row = ws.getRow(rowIdx);
      const srVal = row.getCell(srColIdx).value;
      if (srVal == null || srVal === "") continue;
      const sr = Number(String(srVal).replace(/,/g, "").trim());
      if (!Number.isFinite(sr)) continue;

      let thaily = sheetGroup;
      if (groupColIdx !== null) {
        const gVal = row.getCell(groupColIdx).value;
        if (gVal != null && String(gVal).trim() !== "") {
          thaily = String(gVal).trim();
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const imgData = wb.getImage(Number(img.imageId) || (img.imageId as any));
      if (!imgData || !imgData.buffer) continue;

      imagesToUpload.push({
        department,
        thaily,
        sr,
        buffer: Buffer.from(imgData.buffer),
        extension: imgData.extension || "jpeg",
      });
    }
  }

  if (imagesToUpload.length === 0) return 0;

  let uploadedCount = 0;
  const CONCURRENCY = 5;
  for (let i = 0; i < imagesToUpload.length; i += CONCURRENCY) {
    const chunk = imagesToUpload.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (item) => {
        try {
          const ext = item.extension.toLowerCase();
          const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
          const file = new File([item.buffer], `photo.${ext}`, { type: mime });
          const folder = `rm-stock/thaily-${safe(item.thaily)}`;
          const publicId = `${safe(String(item.sr))}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const uploaded = await uploadImage(file, folder, publicId);

          await supabase
            .from("rm_item")
            .update({ photo_path: uploaded.publicId, photo_updated_at: new Date().toISOString() })
            .eq("department", item.department)
            .eq("thaily", item.thaily)
            .eq("sr", item.sr);

          uploadedCount++;
        } catch {
          /* continue on single photo error */
        }
      })
    );
  }

  return uploadedCount;
}
