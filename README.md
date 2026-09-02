# RM Stock Portal

Browse raw-material stock by **Thaily**, and capture a **photo for every serial
number** — stored in the cloud and shared across everyone's devices.

Built with Next.js (App Router), Supabase (item catalogue), and Cloudinary
(photo hosting). Seeded with the 472 designs from `DIGITAL_PRINT.xlsx`
(Thaily 1–3).

## Features

- **Departments** — top-level switcher (Digital Print today; Labels, Runner,
  Patta, … later), each with its own groups and photographed count.
- **Group tabs** — for Digital Print these are Thaily 1 / 2 / 3, each with a live
  "photographed" count.
- **Item cards** — serial no, size, colour codes, design/character, item name,
  inventory + UOM.
- **Live photo capture** — tap a card to open the phone camera; the shot is
  downscaled in the browser and uploaded to Cloudinary against that exact
  Thaily + serial. Tap a photographed card to view, retake, or remove.
- **Search & filter** — by size / colour / design / serial, and by photo status.
- **Shared** — photos are hosted on Cloudinary, so everyone sees them.
- Light / dark theme.

## Setup

### 1. Create a Supabase project
From [supabase.com](https://supabase.com) → **Settings → API**, copy the
Project URL, the `anon` public key, and the `service_role` key (server-only).

### 2. Run the SQL
In the Supabase **SQL Editor**, run the files in `supabase/migrations/` in order:
1. `0001_init.sql` — creates the `rm_item` table and RLS.
2. `0002_seed_items.sql` — inserts the 472 items from the sheet.

### 3. Create a Cloudinary account
From [cloudinary.com](https://cloudinary.com) → **Dashboard**, copy the
Cloud name, API Key, and API Secret (the last two are server-only).

### 4. Environment variables
Copy `.env.example` to `.env.local` and fill in all six values (Supabase URL +
anon + service-role; Cloudinary cloud name + api key + api secret).

On Vercel, set the same six as project environment variables.

### 4. Run
```bash
npm install
npm run dev
```
Open http://localhost:3000. (Photo capture uses the camera — use HTTPS or
localhost, which browsers treat as secure.)

## Adding a department / re-importing

Each department is one workbook; each sheet is a group (Thaily for Digital
Print), with SR NO, Size, Colour, Character(Design), Name, Inventory, UOM
columns. To load one:

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  npm run seed -- path/to/labels.xlsx --department Labels
```
It upserts on `(department, thaily, sr)` and never touches existing photos. The
new department shows up automatically in the app's department switcher.

## How photos are stored

- The browser downscales each capture (max 1000 px, JPEG) before upload — a few
  tens of KB each.
- Uploads go through a server action that signs the request with the Cloudinary
  API secret; the browser never holds it.
- Images land on Cloudinary under `rm-stock/thaily-<n>/<sr>-<timestamp>`; the
  `rm_item.photo_path` column stores that Cloudinary `public_id`, and delivery
  URLs are built with `f_auto,q_auto`. Replacing a photo deletes the old one.

## Notes

- Reads (the catalogue) are public via the `anon` key and RLS `select using
  (true)`. Writes are server-only. If you later add authentication, move the
  upload authorization there.
