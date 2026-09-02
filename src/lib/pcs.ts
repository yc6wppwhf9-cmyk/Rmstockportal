/**
 * Pieces conversion.
 *
 * Some articles are stocked in metres. To express them in pieces we use:
 *
 *     pcs = metres × 2145 ÷ size
 *
 * where `size` is the product of the item's dimensions (e.g. "15*12" → 180).
 * The 2145 factor is fixed. Rows already in pieces keep their quantity.
 */
export const PCS_FACTOR = 2145;

/** Product of every number found in a size string ("15*12" → 180), or null. */
export function sizeProduct(size: string | null | undefined): number | null {
  if (!size) return null;
  const nums = String(size).match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  return nums.map(Number).reduce((a, b) => a * b, 1);
}

/** True when the unit is metres (Mtr / Meter / m…). */
export function isMeter(uom: string | null | undefined): boolean {
  return /^\s*m/i.test(uom ?? "");
}

/**
 * Quantity in pieces for a row. Metre rows are converted with the formula;
 * anything already in pieces is returned as-is. Null when it can't be computed
 * (no inventory, or a metre row without a usable size).
 */
export function computePcs(
  uom: string | null | undefined,
  inventory: number | null | undefined,
  size: string | null | undefined
): number | null {
  if (inventory === null || inventory === undefined) return null;
  const inv = Number(inventory);
  if (!Number.isFinite(inv)) return null;
  if (isMeter(uom)) {
    const p = sizeProduct(size);
    if (!p) return null;
    return Math.round((inv * PCS_FACTOR) / p);
  }
  return Math.round(inv);
}
