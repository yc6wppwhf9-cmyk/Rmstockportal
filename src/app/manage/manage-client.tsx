"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { unlock, importWorkbook, addItem, type UnlockState, type ImportState, type AddState } from "./actions";

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
  const [state, action, pending] = useActionState<AddState, FormData>(addItem, { ok: false });
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) { router.refresh(); formRef.current?.reset(); }
  }, [state.ok, router]);

  const on = Boolean(dept); // fields enable once a department is chosen

  return (
    <form ref={formRef} action={action} className="panel">
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
      </div>

      {state.error && <div className="msg err">{state.error}</div>}
      {state.ok && <div className="msg ok">Item added.</div>}

      <button className="btn primary block" type="submit" disabled={!on || pending}>
        {pending ? "Saving…" : "Add item"}
      </button>
      {!on && <p className="hint-note">Select or name a department to enable the fields.</p>}
    </form>
  );
}
