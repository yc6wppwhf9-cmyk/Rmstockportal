"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RmItem, RmItemView } from "@/lib/types";
import { uploadPhoto, removePhoto } from "@/app/actions";
import { CameraModal } from "./camera";

const keyOf = (d: string, t: string, s: number) => `${d}::${t}::${s}`;
const groupLabel = (dept: string, t: string) =>
  dept === "Digital Print" ? `Thaily ${t}` : t;

const SELECT =
  "id, department, thaily, sr, size, colour, character, name, inventory, uom, qty_pcs, photo_path, photo_updated_at, extra";

/** Client-safe Cloudinary URL (reads only the public cloud name). */
const CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
function cloudUrl(publicId: string | null | undefined): string | null {
  if (!publicId || !CLOUD) return null;
  const enc = publicId.split("/").map(encodeURIComponent).join("/");
  return `https://res.cloudinary.com/${CLOUD}/image/upload/f_auto,q_auto/${enc}`;
}
const toView = (row: RmItem): RmItemView => ({ ...row, photoUrl: cloudUrl(row.photo_path) });

/* ── Icons ─────────────────────────────────────────── */
const Cam = ({ w = 24 }: { w?: number }) => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.5 4h-5L7 7H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-3l-2.5-3Z" />
    <circle cx="12" cy="13" r="3.2" />
  </svg>
);
const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);
const Layers = ({ w = 15 }: { w?: number }) => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>
);

/* ── Image downscale ───────────────────────────────── */
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

type Target = { department: string; thaily: string; sr: number };

export function Portal({ items: initial }: { items: RmItemView[] }) {
  const [items, setItems] = useState<RmItemView[]>(initial);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const departments = useMemo(
    () => [...new Set(initial.map((i) => i.department))].sort((a, b) => a.localeCompare(b)),
    [initial]
  );
  const [activeDept, setActiveDept] = useState<string>(departments[0] ?? "Digital Print");

  const thailysFor = useCallback(
    (dept: string) =>
      [...new Set(items.filter((i) => i.department === dept).map((i) => i.thaily))]
        .sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b)),
    [items]
  );
  const [activeTab, setActiveTab] = useState<string>(thailysFor(departments[0] ?? "")[0] ?? "");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "todo" | "done">("all");
  const [colours, setColours] = useState<Set<string>>(new Set());
  const [invMin, setInvMin] = useState("");
  const [invMax, setInvMax] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Target | null>(null);
  const [camTarget, setCamTarget] = useState<Target | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const sbRef = useRef<SupabaseClient | null>(null);

  /* Live updates: keep the gallery current across devices without a manual
     refresh. Realtime pushes changes instantly (when enabled on the table);
     a gentle poll and a refetch-on-focus cover the case where it isn't. */
  const refetch = useCallback(async () => {
    const sb = sbRef.current;
    if (!sb) return;
    const { data } = await sb
      .from("rm_item")
      .select(SELECT)
      .order("department", { ascending: true })
      .order("thaily", { ascending: true })
      .order("sr", { ascending: true })
      .limit(5000);
    if (data) setItems((data as RmItem[]).map(toView));
  }, []);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const sb = createClient(url, key, { auth: { persistSession: false } });
    sbRef.current = sb;

    const channel = sb
      .channel("rm_item-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "rm_item" }, () => refetch())
      .subscribe();

    const onVisible = () => { if (document.visibilityState === "visible") refetch(); };
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, 15000);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      sb.removeChannel(channel);
      sbRef.current = null;
    };
  }, [refetch]);

  /* Theme */
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("rmsp.theme"); } catch {}
    const t = saved === "dark" || saved === "light"
      ? saved
      : (document.documentElement.getAttribute("data-theme") as "dark" | "light") ||
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(t);
  }, []);
  const toggleTheme = () => {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("rmsp.theme", t); } catch {}
  };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const pickDept = (dept: string) => {
    setActiveDept(dept);
    setActiveTab(thailysFor(dept)[0] ?? "");
    setQuery("");
    setColours(new Set());
    setInvMin("");
    setInvMax("");
  };

  // Colour codes present in the active department (for the colour filter).
  const availColours = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) {
      if (i.department !== activeDept) continue;
      (i.colour ?? "").split(/[-/]/).map((x) => x.trim()).filter(Boolean).forEach((c) => s.add(c));
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [items, activeDept]);

  const toggleColour = (c: string) =>
    setColours((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c); else n.add(c);
      return n;
    });
  const clearFilters = () => { setColours(new Set()); setInvMin(""); setInvMax(""); };
  const activeFilters = colours.size + (invMin ? 1 : 0) + (invMax ? 1 : 0);

  const stepDept = (dir: 1 | -1) => {
    const i = departments.indexOf(activeDept);
    const j = i + dir;
    if (j >= 0 && j < departments.length) pickDept(departments[j]);
  };

  // Keep the active department chip centred as it changes.
  useEffect(() => {
    chipRefs.current[activeDept]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [activeDept]);

  // Swipe left/right on the catalogue to switch department.
  const onSwipeStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY };
  };
  const onSwipeEnd = (e: React.TouchEvent) => {
    const s = swipeStart.current;
    swipeStart.current = null;
    if (!s || departments.length < 2) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      stepDept(dx < 0 ? 1 : -1);
    }
  };

  /* Counts */
  const deptStats = useMemo(() => {
    const m: Record<string, { done: number; total: number }> = {};
    for (const i of items) {
      const e = (m[i.department] ??= { done: 0, total: 0 });
      e.total++;
      if (i.photoUrl) e.done++;
    }
    return m;
  }, [items]);

  const thailys = thailysFor(activeDept);
  const perThaily = useMemo(() => {
    const m: Record<string, { done: number; total: number }> = {};
    for (const i of items) {
      if (i.department !== activeDept) continue;
      const e = (m[i.thaily] ??= { done: 0, total: 0 });
      e.total++;
      if (i.photoUrl) e.done++;
    }
    return m;
  }, [items, activeDept]);

  const dStat = deptStats[activeDept] ?? { done: 0, total: 0 };

  /* Filtering */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mn = invMin ? Number(invMin) : null;
    const mx = invMax ? Number(invMax) : null;
    return items.filter((i) => {
      if (i.department !== activeDept) return false;
      if (i.thaily !== activeTab) return false;
      if (statusFilter === "done" && !i.photoUrl) return false;
      if (statusFilter === "todo" && i.photoUrl) return false;
      if (colours.size) {
        const toks = (i.colour ?? "").split(/[-/]/).map((x) => x.trim()).filter(Boolean);
        if (!toks.some((t) => colours.has(t))) return false;
      }
      if (mn != null && (i.inventory == null || i.inventory < mn)) return false;
      if (mx != null && (i.inventory == null || i.inventory > mx)) return false;
      if (q) {
        const hay = [i.sr, i.size, i.colour, i.character, i.name].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, activeDept, activeTab, statusFilter, query, colours, invMin, invMax]);
  const totalInTab = perThaily[activeTab]?.total ?? 0;

  /* Capture */
  const beginCapture = (t: Target) => setCamTarget(t);
  const onShotClick = (i: RmItemView) => {
    const t = { department: i.department, thaily: i.thaily, sr: i.sr };
    if (i.photoUrl) setLightbox(t);
    else beginCapture(t);
  };

  const onCaptured = async (raw: Blob) => {
    const t = camTarget;
    setCamTarget(null);
    if (!t) return;
    const k = keyOf(t.department, t.thaily, t.sr);
    setBusyKey(k);
    try {
      const blob = await downscale(raw);
      const fd = new FormData();
      fd.append("department", t.department);
      fd.append("thaily", t.thaily);
      fd.append("sr", String(t.sr));
      fd.append("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      const res = await uploadPhoto(fd);
      if (res.ok) {
        setItems((prev) => prev.map((i) =>
          i.department === t.department && i.thaily === t.thaily && i.sr === t.sr
            ? { ...i, photoUrl: `${res.photoUrl}?t=${Date.now()}` } : i));
        showToast(`Photo saved — ${groupLabel(t.department, t.thaily)} · #${t.sr}`);
      } else showToast(res.error);
    } catch {
      showToast("Couldn’t process that image. Try again.");
    } finally { setBusyKey(null); }
  };

  const doRemove = async () => {
    if (!lightbox) return;
    const t = lightbox;
    setLightbox(null);
    const fd = new FormData();
    fd.append("department", t.department);
    fd.append("thaily", t.thaily);
    fd.append("sr", String(t.sr));
    const res = await removePhoto(fd);
    if (res.ok) {
      setItems((prev) => prev.map((i) =>
        i.department === t.department && i.thaily === t.thaily && i.sr === t.sr
          ? { ...i, photoUrl: null } : i));
      showToast(`Photo removed — ${groupLabel(t.department, t.thaily)} · #${t.sr}`);
    } else showToast(res.error ?? "Couldn’t remove photo.");
  };

  const lbItem = lightbox
    ? items.find((i) => i.department === lightbox.department && i.thaily === lightbox.thaily && i.sr === lightbox.sr)
    : null;
  const lbIndex = lightbox
    ? shown.findIndex((i) => i.department === lightbox.department && i.thaily === lightbox.thaily && i.sr === lightbox.sr)
    : -1;
  const stepLightbox = (dir: 1 | -1) => {
    if (lbIndex < 0) return;
    const n = shown[lbIndex + dir];
    if (n) setLightbox({ department: n.department, thaily: n.thaily, sr: n.sr });
  };

  const C = 2 * Math.PI * 15.5;

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowLeft") stepLightbox(-1);
      else if (e.key === "ArrowRight") stepLightbox(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox, shown]);

  return (
    <>
      <header>
        <div className="head-inner">
          <div className="brand">
            <div className="mark"><Cam w={19} /></div>
            <div className="title-wrap">
              <h1>RM Stock Portal</h1>
              <p>{activeDept} · photograph each design</p>
            </div>
          </div>
          <div className="head-right">
            <div className="progress-chip" title={`Photographed in ${activeDept}`}>
              <svg className="ring" viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--line-strong)" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--accent)" strokeWidth="3"
                  strokeLinecap="round" transform="rotate(-90 18 18)"
                  strokeDasharray={C.toFixed(1)}
                  strokeDashoffset={(C * (1 - (dStat.total ? dStat.done / dStat.total : 0))).toFixed(1)} />
              </svg>
              <div className="txt"><span>Photographed </span><b>{dStat.done} / {dStat.total}</b></div>
            </div>
            <a className="theme-btn" href={`/export?department=${encodeURIComponent(activeDept)}`}
              aria-label="Export this department to Excel" title="Export to Excel (with photos)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
            </a>
            <a className="theme-btn" href="/manage" aria-label="Add or import items" title="Add / import items">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            </a>
            <button className="theme-btn" onClick={toggleTheme} aria-label="Toggle light and dark theme">
              {theme === "dark" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Department selector */}
      <div className="dept-bar" role="tablist" aria-label="Department">
        {departments.map((d) => {
          const c = deptStats[d] ?? { done: 0, total: 0 };
          return (
            <button key={d} className="dept-chip" role="tab" aria-selected={d === activeDept}
              ref={(el) => { chipRefs.current[d] = el; }}
              onClick={() => pickDept(d)}>
              <Layers /> {d} <span className="c">{c.done}/{c.total}</span>
            </button>
          );
        })}
      </div>

      {/* Group (Thaily) tabs */}
      <div className="tabs-wrap">
        <div className="tabs" role="tablist" aria-label="Group">
          {thailys.map((t) => {
            const c = perThaily[t] ?? { done: 0, total: 0 };
            const dot = c.done === 0 ? "empty" : c.done === c.total ? "" : "partial";
            return (
              <button key={t} className="tab" role="tab" aria-selected={t === activeTab}
                onClick={() => setActiveTab(t)}>
                <span className={`dot ${dot}`} />
                {groupLabel(activeDept, t)}
                <span className="count">{c.done}/{c.total}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input type="search" placeholder="Search size, colour, design or SR no…"
            value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        </div>
        <div className="filter-toggle" role="group" aria-label="Filter by photo status">
          {(["all", "todo", "done"] as const).map((f) => (
            <button key={f} aria-pressed={statusFilter === f} onClick={() => setStatusFilter(f)}>
              {f === "all" ? "All" : f === "todo" ? "No photo" : "Photographed"}
            </button>
          ))}
        </div>
        <button className="filters-btn" onClick={() => setFilterOpen(true)} aria-label="Open filters">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
          Filters{activeFilters > 0 && <span className="fbadge">{activeFilters}</span>}
        </button>
      </div>

      {activeFilters > 0 && (
        <div className="active-filters">
          {[...colours].map((c) => (
            <button key={c} className="afchip" onClick={() => toggleColour(c)}>{c} ✕</button>
          ))}
          {(invMin || invMax) && (
            <button className="afchip" onClick={() => { setInvMin(""); setInvMax(""); }}>
              Stock {invMin || "0"}–{invMax || "∞"} ✕
            </button>
          )}
          <button className="afclear" onClick={clearFilters}>Clear all</button>
        </div>
      )}

      <div className="count-line">
        Showing <b>{shown.length}</b> of <b>{totalInTab}</b> in {groupLabel(activeDept, activeTab)}
      </div>

      <main onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
        <div className="grid">
          {shown.length === 0 ? (
            <div className="empty-grid">No designs match your search or filter.</div>
          ) : (
            shown.map((i) => {
              const k = keyOf(i.department, i.thaily, i.sr);
              const busy = busyKey === k;
              const has = Boolean(i.photoUrl);
              return (
                <article className="card" key={i.id}>
                  <div className={`shot${busy ? " busy" : ""}`} onClick={() => onShotClick(i)}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") onShotClick(i); }}
                    aria-label={`Serial ${i.sr}${has ? ", view or retake photo" : ", take photo"}`}>
                    <span className="sr-badge">#{i.sr}</span>
                    <span className={`stat ${has ? "done" : "todo"}`} aria-hidden="true">
                      {has ? <Check /> : <Cam w={14} />}
                    </span>
                    {has ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={i.photoUrl!} alt={`Design ${i.sr}${i.size ? `, ${i.size}` : ""}`} loading="lazy" />
                        <div className="retake-hint"><Cam w={13} /><span>Tap to view / retake</span></div>
                      </>
                    ) : (
                      <div className="empty-state"><Cam w={30} /><span>TAKE LIVE PHOTO</span></div>
                    )}
                    {busy && <div className="spinner"><div /></div>}
                  </div>
                  <div className="body">
                    <div className="row-top">
                      <span className="size">{i.size || "—"}</span>
                      <span className="uom-inv">
                        <span className="qty">{i.inventory ?? "—"}</span>{" "}
                        <span className="uom">{i.uom || ""}</span>
                      </span>
                    </div>
                    {/^\s*m/i.test(i.uom ?? "") && i.qty_pcs != null && (
                      <div className="pcs-note">≈ {i.qty_pcs.toLocaleString()} Pcs</div>
                    )}
                    {i.name && <div className="name">{i.name}</div>}
                    <div className="chips">
                      {i.character && <span className="chip design">{i.character}</span>}
                      {(i.colour ?? "").split(/[-/]/).map((x) => x.trim()).filter(Boolean)
                        .map((c, idx) => <span className="chip" key={idx}>{c}</span>)}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </main>

      <div className="foot">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 3 7v6c0 5 3.5 8 9 9 5.5-1 9-4 9-9V7l-9-5Z" /></svg>
        <span>Photos are stored in the cloud and shared with everyone.</span>
      </div>

      {lightbox && lbItem && (
        <div className="lb" role="dialog" aria-modal="true" aria-label="Design photo"
          onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null); }}>
          <div className="lb-card">
            <div className="lb-img">
              {lbItem.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lbItem.photoUrl} alt={`Design ${lbItem.sr}`} />
              ) : (
                <div className="lb-empty"><Cam w={34} /><span>No photo yet</span></div>
              )}
              <button className="lb-nav prev" onClick={() => stepLightbox(-1)} disabled={lbIndex <= 0} aria-label="Previous item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <button className="lb-nav next" onClick={() => stepLightbox(1)} disabled={lbIndex < 0 || lbIndex >= shown.length - 1} aria-label="Next item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </button>
              {lbIndex >= 0 && <span className="lb-pos">{lbIndex + 1} / {shown.length}</span>}
            </div>
            <div className="lb-meta">
              <span className="k">{lbItem.department} · {groupLabel(lbItem.department, lbItem.thaily)} · #{lbItem.sr}</span>
              {lbItem.name && <h3>{lbItem.name}</h3>}
              <div className="lb-details">
                <div><span className="dk">Size</span><span className="dv">{lbItem.size || "—"}</span></div>
                <div><span className="dk">Inventory</span><span className="dv">{lbItem.inventory ?? "—"} {lbItem.uom || ""}</span></div>
                {/^\s*m/i.test(lbItem.uom ?? "") && lbItem.qty_pcs != null && (
                  <div><span className="dk">Pieces (calc)</span><span className="dv">{lbItem.qty_pcs.toLocaleString()} Pcs</span></div>
                )}
                {lbItem.character && (
                  <div className="full"><span className="dk">Design</span><span className="dv">{lbItem.character}</span></div>
                )}
                {lbItem.colour && (
                  <div className="full">
                    <span className="dk">Colour</span>
                    <span className="lb-chips">
                      {lbItem.colour.split(/[-/]/).map((c) => c.trim()).filter(Boolean)
                        .map((c, idx) => <span className="chip" key={idx}>{c}</span>)}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="lb-actions">
              <button className="btn primary" onClick={() => { const t = lightbox; beginCapture(t); }}>
                <Cam w={15} /> {lbItem.photoUrl ? "Retake" : "Take photo"}
              </button>
              <button className="btn" onClick={() => setLightbox(null)}>Close</button>
              {lbItem.photoUrl && <button className="btn danger" onClick={doRemove}>Remove</button>}
            </div>
          </div>
        </div>
      )}

      {filterOpen && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Filters"
          onClick={(e) => { if (e.target === e.currentTarget) setFilterOpen(false); }}>
          <div className="sheet-card">
            <div className="sheet-head">
              <h3>Filters</h3>
              <button className="cam-x" style={{ background: "var(--surface-2)", color: "var(--ink)" }} onClick={() => setFilterOpen(false)} aria-label="Close">✕</button>
            </div>

            <div className="sheet-section">
              <div className="sheet-label">Stock range ({activeDept === "Digital Print" ? "Pcs/Mtr" : "units"})</div>
              <div className="range-row">
                <input type="number" inputMode="numeric" placeholder="Min" value={invMin} onChange={(e) => setInvMin(e.target.value)} />
                <span className="range-dash">–</span>
                <input type="number" inputMode="numeric" placeholder="Max" value={invMax} onChange={(e) => setInvMax(e.target.value)} />
              </div>
            </div>

            <div className="sheet-section">
              <div className="sheet-label">Colour {colours.size > 0 && `· ${colours.size} selected`}</div>
              {availColours.length === 0 ? (
                <p className="hint-note" style={{ margin: 0 }}>No colours on these items.</p>
              ) : (
                <div className="fchips">
                  {availColours.map((c) => (
                    <button key={c} className={`fchip${colours.has(c) ? " on" : ""}`} onClick={() => toggleColour(c)}>{c}</button>
                  ))}
                </div>
              )}
            </div>

            <div className="sheet-actions">
              <button className="btn" onClick={clearFilters} disabled={activeFilters === 0}>Clear all</button>
              <button className="btn primary" onClick={() => setFilterOpen(false)}>
                Show {shown.length} result{shown.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}

      {camTarget && (
        <CameraModal
          title={`${camTarget.department} · ${groupLabel(camTarget.department, camTarget.thaily)}`}
          subtitle={`Serial #${camTarget.sr}`}
          onCapture={onCaptured}
          onClose={() => setCamTarget(null)}
        />
      )}
      <div className={`toast${toast ? " show" : ""}`}>{toast}</div>
    </>
  );
}
