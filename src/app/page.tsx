import { isConfigured, readClient } from "@/lib/supabase";
import { photoUrl } from "@/lib/cloudinary";
import type { RmItem, RmItemView } from "@/lib/types";
import { Portal } from "@/components/portal";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isConfigured()) return <SetupNotice />;

  const supabase = readClient();
  const { data, error } = await supabase
    .from("rm_item")
    .select(
      "id, department, thaily, sr, size, colour, character, name, inventory, uom, qty_pcs, photo_path, photo_updated_at, extra"
    )
    .order("department", { ascending: true })
    .order("thaily", { ascending: true })
    .order("sr", { ascending: true })
    .limit(5000);

  if (error) return <SetupNotice error={error.message} />;

  const items: RmItemView[] = (data ?? []).map((it: RmItem) => ({
    ...it,
    photoUrl: photoUrl(it.photo_path),
  }));

  return <Portal items={items} />;
}

function SetupNotice({ error }: { error?: string }) {
  return (
    <main>
      <div className="notice">
        <h2>Almost there — connect Supabase</h2>
        {error ? (
          <p>
            Couldn’t read the catalogue: <code>{error}</code>. Check the steps
            below, then reload.
          </p>
        ) : (
          <p>
            The portal needs a Supabase project for the item catalogue and
            photos. Set these environment variables and reload:
          </p>
        )}
        <pre>{`NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…   (server only)`}</pre>
        <p>
          Then run the SQL in <code>supabase/migrations/</code> (schema, then
          seed) against that project. See <code>README.md</code> for the full
          walkthrough.
        </p>
      </div>
    </main>
  );
}
