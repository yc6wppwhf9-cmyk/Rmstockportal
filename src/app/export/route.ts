import ExcelJS from "exceljs";
import { readClient, isConfigured } from "@/lib/supabase";
import type { RmItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SELECT =
  "id, department, thaily, sr, size, colour, character, name, inventory, uom, qty_pcs, photo_path, extra";
const CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

function enc(publicId: string): string {
  return publicId.split("/").map(encodeURIComponent).join("/");
}
// A small, cell-sized rendition keeps the download light and fast.
function thumbUrl(publicId: string): string | null {
  if (!CLOUD) return null;
  return `https://res.cloudinary.com/${CLOUD}/image/upload/w_180,h_220,c_fit,q_auto,f_jpg/${enc(publicId)}`;
}
// Full-size delivery URL for the clickable column.
function fullUrl(publicId: string): string {
  if (!CLOUD) return "";
  return `https://res.cloudinary.com/${CLOUD}/image/upload/${enc(publicId)}`;
}
function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}
// Excel sheet names: max 31 chars, no []:*?/\
function sheetName(s: string): string {
  return (s.replace(/[[\]:*?/\\]/g, " ").trim() || "Sheet").slice(0, 31);
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

export async function GET(req: Request) {
  if (!isConfigured()) return new Response("Supabase not configured.", { status: 500 });

  const { searchParams } = new URL(req.url);
  const dept = searchParams.get("department");

  const supabase = readClient();
  let q = supabase
    .from("rm_item")
    .select(SELECT)
    .order("department", { ascending: true })
    .order("thaily", { ascending: true })
    .order("sr", { ascending: true })
    .limit(10000);
  if (dept) q = q.eq("department", dept);

  const { data, error } = await q;
  if (error) return new Response(error.message, { status: 500 });
  const rows = (data ?? []) as RmItem[];

  const wb = new ExcelJS.Workbook();
  wb.creator = "RM Stock Portal";

  // One worksheet per department.
  const byDept = new Map<string, RmItem[]>();
  for (const r of rows) {
    const list = byDept.get(r.department) ?? [];
    list.push(r);
    byDept.set(r.department, list);
  }
  if (byDept.size === 0) byDept.set(dept || "RM Stock", []);

  for (const [d, items] of byDept) {
    const ws = wb.addWorksheet(sheetName(d));
    ws.columns = [
      { header: "Group", key: "thaily", width: 10 },
      { header: "SR", key: "sr", width: 6 },
      { header: "Photo", key: "img", width: 18 },
      { header: "Item Name", key: "name", width: 28 },
      { header: "Size", key: "size", width: 10 },
      { header: "Colour", key: "colour", width: 10 },
      { header: "Colour Name", key: "cname", width: 14 },
      { header: "Design", key: "character", width: 16 },
      { header: "Inventory", key: "inv", width: 12 },
      { header: "UOM", key: "uom", width: 8 },
      { header: "Qty (Pcs)", key: "pcs", width: 12 },
      { header: "INV Code", key: "invcode", width: 14 },
      { header: "Photo URL", key: "url", width: 44 },
    ];
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.alignment = { vertical: "middle" };

    for (const it of items) {
      const extra = (it.extra ?? {}) as Record<string, string>;
      ws.addRow({
        thaily: it.thaily,
        sr: it.sr,
        img: "",
        name: it.name ?? "",
        size: it.size ?? "",
        colour: it.colour ?? "",
        cname: extra["Colour"] ?? "",
        character: it.character ?? "",
        inv: it.inventory ?? "",
        uom: it.uom ?? "",
        pcs: it.qty_pcs ?? "",
        invcode: extra["INV"] ?? "",
        url: it.photo_path ? fullUrl(it.photo_path) : "",
      });
    }

    // Embed photos into the Photo column (index 2, zero-based).
    await mapLimit(items, 6, async (it, i) => {
      if (!it.photo_path) return;
      const url = thumbUrl(it.photo_path);
      if (!url) return;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const buffer = Buffer.from(await res.arrayBuffer());
        const imgId = wb.addImage({ buffer: buffer as unknown as ExcelJS.Buffer, extension: "jpeg" });
        const sheetRow = i + 2; // 1 header + i (0-based) + 1
        ws.getRow(sheetRow).height = 100; // ~133px
        ws.addImage(imgId, {
          tl: { col: 2.05, row: sheetRow - 1 + 0.05 },
          ext: { width: 108, height: 132 },
          editAs: "oneCell",
        });
      } catch {
        /* skip a photo that fails to fetch */
      }
    });
  }

  const body = await wb.xlsx.writeBuffer();
  const name = `rm-stock${dept ? "-" + slug(dept) : ""}.xlsx`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
