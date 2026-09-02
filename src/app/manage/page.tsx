import Link from "next/link";
import { isConfigured, readClient } from "@/lib/supabase";
import { manageConfigured, isUnlocked } from "@/lib/manage";
import { ManageClient } from "./manage-client";

export const dynamic = "force-dynamic";

export default async function ManagePage() {
  const configured = isConfigured();
  const unlocked = await isUnlocked();
  const gated = manageConfigured();

  let departments: string[] = [];
  if (configured && unlocked) {
    const supabase = readClient();
    const { data } = await supabase
      .from("rm_item")
      .select("department")
      .order("department", { ascending: true })
      .limit(5000);
    departments = [...new Set((data ?? []).map((r: { department: string }) => r.department))];
  }

  return (
    <>
      <header>
        <div className="head-inner">
          <div className="brand">
            <Link href="/" className="mark" aria-label="Back to stock" style={{ textDecoration: "none" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </Link>
            <div className="title-wrap">
              <h1>Add items</h1>
              <p>Import a sheet or add one item</p>
            </div>
          </div>
          <div className="head-right">
            <Link href="/" className="btn">View stock</Link>
          </div>
        </div>
      </header>
      <main>
        {!configured ? (
          <p className="empty-grid">Connect Supabase first (see the home page).</p>
        ) : (
          <ManageClient unlocked={unlocked} gated={gated} departments={departments} />
        )}
      </main>
    </>
  );
}
