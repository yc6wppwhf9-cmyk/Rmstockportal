import { isConfigured, readClient } from "@/lib/supabase";
import { photoUrl } from "@/lib/cloudinary";
import { fetchAllItems } from "@/lib/fetch-items";
import type { RmItemView } from "@/lib/types";
import { Portal } from "@/components/portal";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isConfigured()) return <SetupNotice />;

  let rows;
  try {
    rows = await fetchAllItems(readClient());
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : "read failed"} />;
  }

  const items: RmItemView[] = rows.map((it) => ({ ...it, photoUrl: photoUrl(it.photo_path) }));
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
