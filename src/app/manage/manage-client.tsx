"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { unlock, importWorkbook, addItem, type UnlockState, type ImportState } from "./actions";
import { uploadPhoto } from "@/app/actions";
import { CameraModal } from "@/components/camera";

/** Downscale an image before upload (bounds size for camera and gallery). */
function downscale(file: Blob, maxDim = 1100, quality = 0.75): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > h && w > maxDim) { h = Math.round((h * maxDim) / w); w = maxDim; }
      else if (h >= w && h > maxDim) { w = Math.round((w * maxDim) / h); h = maxDim; }
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, w, h);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}

const NEW = "__new__";

export function ManageClient({
  unlocked,
  gated,
  departments,
}: {
  unlocked: boolean;
  gated: boolean;
  departments: string[];
}) {
  if (!unlocked) return <LockForm />;
  return (
    <div className="panels">
      <ImportPanel departments={departments} />
      <AddItemPanel departments={departments} />
      {gated && (
        <p className="hint-note" style={{ textAlign: "center" }}>
          You’re unlocked on this device. Viewing and photographing don’t need the passcode.
        </p>
      )}
    </div>
  );
}

/* ── Passcode ─────────────────────────────────────── */
function LockForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlock, { ok: false });
  useEffect(() => { if (state.ok) router.refresh(); }, [state.ok, router]);
  return (
    <div className="panels">
      <form action={action} className="panel">
        <h2>Enter passcode</h2>
        <p className="sub">Adding and importing items is passcode-protected.</p>
        <div className="fld">
          <label htmlFor="pc">Passcode</label>
          <input id="pc" name="passcode" type="password" autoComplete="off" autoFocus />
        </div>
        {state.error && <div className="msg err">{state.error}</div>}
        <button className="btn primary block" type="submit" disabled={pending}>
          {pending ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}

/* ── Department picker (existing + new) ───────────── */
function DepartmentField({
  departments,
  value,
  onChange,
  id,
}: {
  departments: string[];
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  const isNew = !departments.includes(value) || value === "";
  const [mode, setMode] = useState<string>(value && departments.includes(value) ? value : NEW);
  return (
    <div className="fld full">
      <label htmlFor={id}>Department</label>
      <select
        id={id}
        value={mode}
        onChange={(e) => {
          setMode(e.target.value);
          onChange(e.target.value === NEW ? "" : e.target.value);
        }}
      >
        {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        <option value={NEW}>➕ New department…</option>
      </select>
      {mode === NEW && (
        <input
          style={{ marginTop: 8 }}
          placeholder="New department name (e.g. Labels, Runner)"
          value={isNew ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
      )}
    </div>
  );
}

/* ── Import Excel ─────────────────────────────────── */
function ImportPanel({ departments }: { departments: string[] }) {
  const router = useRouter();
  const [dept, setDept] = useState<string>(departments[0] ?? "");
  const [state, action, pending] = useActionState<ImportState, FormData>(importWorkbook, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state && state.ok) { router.refresh(); formRef.current?.reset(); }
  }, [state, router]);

  return (
    <form ref={formRef} action={action} className="panel">
      <h2>Import an Excel sheet</h2>
      <p className="sub">One workbook per department. Columns are detected automatically (SR No, Colour, Item Name, Stock, etc.). Each sheet becomes a group.</p>

      <div className="form-grid">
        <DepartmentField departments={departments} value={dept} onChange={setDept} id="imp-dept" />
        <input type="hidden" name="department" value={dept} />
        <div className="fld full">
          <label htmlFor="imp-file">Excel file (.xlsx)</label>
          <div className="file-drop">
            Choose the workbook to import
            <input id="imp-file" name="file" type="file" accept=".xlsx,.xls" disabled={!dept} />
          </div>
        </div>
      </div>

      {state && !state.ok && <div className="msg err">{state.error}</div>}
      {state && state.ok && (
        <div className="msg ok">
          Imported {state.imported} item(s) into “{state.department}” ({state.groups.length} group
          {state.groups.length === 1 ? "" : "s"}: {state.groups.join(", ")}).
        </div>
      )}

      <button className="btn primary block" type="submit" disabled={!dept || pending}>
        {pending ? "Importing…" : "Import sheet"}
      </button>
      {!dept && <p className="hint-note">Select or name a department to enable the file picker.</p>}
    </form>
  );
}

/* ── Add one item ─────────────────────────────────── */
function AddItemPanel({ departments }: { departments: string[] }) {
  const router = useRouter();
  const [dept, setDept] = useState<string>(departments[0] ?? "");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [cam, setCam] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const on = Boolean(dept); // fields enable once a department is chosen

  const onCaptured = async (raw: Blob) => {
    setCam(false);
    try {
      const blob = await downscale(raw);
      setPhoto((p) => { if (p) URL.revokeObjectURL(p.url); return { blob, url: URL.createObjectURL(blob) }; });
    } catch { setMsg({ ok: false, text: "Couldn’t process that image." }); }
  };
  const clearPhoto = () => setPhoto((p) => { if (p) URL.revokeObjectURL(p.url); return null; });

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!on) return;
    const form = formRef.current!;
    const fd = new FormData(form);
    setPending(true); setMsg(null);
    try {
      const res = await addItem(fd);
      if (!res.ok) { setMsg({ ok: false, text: res.error ?? "Couldn’t add the item." }); setPending(false); return; }

      if (photo) {
        const sr = String(fd.get("sr") ?? "").trim();
        const thaily = String(fd.get("thaily") ?? "").trim() || "All";
        const pf = new FormData();
        pf.append("department", dept);
        pf.append("thaily", thaily);
        pf.append("sr", sr);
        pf.append("photo", new File([photo.blob], "photo.jpg", { type: "image/jpeg" }));
        const up = await uploadPhoto(pf);
        setMsg(up.ok
          ? { ok: true, text: "Item and photo added." }
          : { ok: true, text: `Item added, but the photo didn’t upload: ${up.error}` });
      } else {
        setMsg({ ok: true, text: "Item added." });
      }
      form.reset();
      clearPhoto();
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Something went wrong. Try again." });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <form ref={formRef} onSubmit={onSubmit} className="panel">
        <h2>Add a single item</h2>
        <p className="sub">Pick a department first — the fields enable once it’s set.</p>

        <div className="form-grid">
          <DepartmentField departments={departments} value={dept} onChange={setDept} id="add-dept" />
          <input type="hidden" name="department" value={dept} />

          <div className="fld"><label>Group / Thaily</label>
            <input name="thaily" placeholder="e.g. 1 or All" defaultValue="All" disabled={!on} /></div>
          <div className="fld"><label>Serial no *</label>
            <input name="sr" type="number" min={0} placeholder="e.g. 12" disabled={!on} /></div>

          <div className="fld full"><label>Item name</label>
            <input name="name" placeholder="e.g. SL 8 SATIN RVS" disabled={!on} /></div>

          <div className="fld"><label>Colour code</label>
            <input name="colour" placeholder="e.g. NBL" disabled={!on} /></div>
          <div className="fld"><label>Colour name</label>
            <input name="colour_name" placeholder="e.g. Navy Blue" disabled={!on} /></div>

          <div className="fld"><label>Size</label>
            <input name="size" placeholder="e.g. 15*12" disabled={!on} /></div>
          <div className="fld"><label>Design / character</label>
            <input name="character" placeholder="e.g. AVENGERS" disabled={!on} /></div>

          <div className="fld"><label>Stock / inventory</label>
            <input name="inventory" type="text" inputMode="numeric" placeholder="e.g. 22000" disabled={!on} /></div>
          <div className="fld"><label>UOM</label>
            <input name="uom" placeholder="Pcs / Mtr" disabled={!on} /></div>

          <div className="fld full"><label>INV code</label>
            <input name="inv" placeholder="e.g. INV22369" disabled={!on} /></div>

          <div className="fld full">
            <label>Photo</label>
            <div className="add-photo">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt="Item preview" />
              ) : (
                <span>No photo yet — take a live photo or upload one.</span>
              )}
              <div className="add-photo-btns">
                <button type="button" className="btn" disabled={!on} onClick={() => setCam(true)}>
                  {photo ? "Retake / change" : "Take or upload"}
                </button>
                {photo && <button type="button" className="btn danger" onClick={clearPhoto}>Remove</button>}
              </div>
            </div>
          </div>
        </div>

        {msg && <div className={`msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}

        <button className="btn primary block" type="submit" disabled={!on || pending}>
          {pending ? "Saving…" : "Add item"}
        </button>
        {!on && <p className="hint-note">Select or name a department to enable the fields.</p>}
      </form>

      {cam && (
        <CameraModal
          title={dept || "New item"}
          subtitle="New item photo"
          onCapture={onCaptured}
          onClose={() => setCam(false)}
        />
      )}
    </>
  );
}
