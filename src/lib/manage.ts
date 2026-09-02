import { cookies } from "next/headers";

/**
 * Lightweight passcode gate for the "Add items" tools. Viewing and
 * photographing stay open; only adding/importing is gated.
 *
 * Set MANAGE_PASSCODE in the environment to require it. If it is unset, the
 * tools are open (fine for a purely internal deployment).
 */
export const MANAGE_COOKIE = "rmsp_mgr";

export function managePasscode(): string {
  return process.env.MANAGE_PASSCODE || "";
}

export function manageConfigured(): boolean {
  return managePasscode().length > 0;
}

export async function isUnlocked(): Promise<boolean> {
  if (!manageConfigured()) return true;
  const c = await cookies();
  return c.get(MANAGE_COOKIE)?.value === managePasscode();
}
