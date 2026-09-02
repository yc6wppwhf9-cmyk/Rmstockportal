export type RmItem = {
  id: number;
  department: string;
  thaily: string;
  sr: number;
  size: string | null;
  colour: string | null;
  character: string | null;
  name: string | null;
  inventory: number | null;
  uom: string | null;
  photo_path: string | null;
  photo_updated_at: string | null;
};

/** Item plus its resolved public photo URL, ready for the client. */
export type RmItemView = RmItem & { photoUrl: string | null };
