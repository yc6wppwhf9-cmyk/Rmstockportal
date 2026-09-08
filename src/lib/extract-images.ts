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

const SR_SYNONYMS = ["sr no", "sr", "serial", "serial no", "s.no", "s no", "sno"];
const GROUP_SYNONYMS = ["thaily", "group"];

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);

  const imagesMap = new Map<string, ExtractedImage>();

  for (const ws of wb.worksheets) {
    const sheetName = ws.name;
    const m = /(\d+)\s*$/.exec(sheetName);
    // Align exactly with parse-workbook.ts group naming
    const sheetGroup = m ? m[1] : "All";

    const headerRow = ws.getRow(1);
    let srColIdx: number | null = null;
    let groupColIdx: number | null = null;

    headerRow.eachCell((cell, colNumber) => {
      const h = String(cell.value ?? "").trim().toLowerCase();
      if (SR_SYNONYMS.includes(h)) {
        srColIdx = colNumber;
      } else if (GROUP_SYNONYMS.includes(h)) {
        groupColIdx = colNumber;
      }
    });

    if (srColIdx === null) continue;

    const images = ws.getImages();
    for (const img of images) {
      // Calculate vertical center of the image anchor to precisely identify row
      const tlRow = typeof img.range.tl.row === "number" ? img.range.tl.row : (img.range.tl.nativeRow ?? 0);
      const brRow = (img.range.br && typeof img.range.br.row === "number")
        ? img.range.br.row
        : (img.range.br?.nativeRow ?? tlRow);
      const midRow = (tlRow + brRow) / 2;
      let rowIdx = Math.floor(midRow) + 1;

      if (rowIdx <= 1) continue;

      let row = ws.getRow(rowIdx);
      let srVal = row.getCell(srColIdx).value;

      // Fallback check if top-left or adjacent row contains the SR number
      if (srVal == null || srVal === "") {
        const altIdx = Math.floor(tlRow) + 1;
        if (altIdx > 1) {
          const altRow = ws.getRow(altIdx);
          const altVal = altRow.getCell(srColIdx).value;
          if (altVal != null && altVal !== "") {
            rowIdx = altIdx;
            row = altRow;
            srVal = altVal;
          }
        }
      }

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

      const key = `${department}::${thaily}::${sr}`;
      imagesMap.set(key, {
        department,
        thaily,
        sr,
        buffer: Buffer.from(imgData.buffer),
        extension: imgData.extension || "jpeg",
      });
    }
  }

  const imagesToUpload = Array.from(imagesMap.values());

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
          const file = new File([new Uint8Array(item.buffer)], `photo.${ext}`, { type: mime });
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
