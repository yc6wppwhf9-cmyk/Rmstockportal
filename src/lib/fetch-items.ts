import type { SupabaseClient } from "@supabase/supabase-js";
import type { RmItem } from "@/lib/types";

export const ITEM_SELECT =
  "id, department, thaily, sr, size, colour, character, name, inventory, uom, qty_pcs, photo_path, photo_updated_at, extra";

/**
 * Fetch every rm_item row, paging past Supabase's per-request row cap (1000 by
 * default). Without this, large catalogues silently truncate — e.g. a second
 * department beyond the first 1000 rows only partly appears.
 */
export async function fetchAllItems(
  sb: SupabaseClient,
  opts: { department?: string } = {}
): Promise<RmItem[]> {
  const PAGE = 1000;
  let from = 0;
  const out: RmItem[] = [];
  for (;;) {
    let q = sb
      .from("rm_item")
      .select(ITEM_SELECT)
      .order("department", { ascending: true })
      .order("thaily", { ascending: true })
      .order("sr", { ascending: true })
      .range(from, from + PAGE - 1);
    if (opts.department) q = q.eq("department", opts.department);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as RmItem[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
