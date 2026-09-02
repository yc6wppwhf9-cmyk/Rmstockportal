"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * In-app camera with a fixed 4:5 framing guide. The captured frame is cropped
 * to exactly the guide window (auto-crop), so every photo comes out in the same
 * portrait shape however the phone was held. Falls back to the native file
 * picker if the browser blocks or lacks camera access.
 */
export function CameraModal({
  title,
  subtitle,
  onCapture,
  onClose,
}: {
  title: string;
  subtitle: string;
  onCapture: (blob: Blob) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async (mode: "environment" | "user") => {
    stop();
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailed("This browser can’t open the camera here.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
        setReady(true);
      }
    } catch {
      setFailed("Camera access was blocked. Allow it in your browser, or choose a photo instead.");
    }
  }, [stop]);

  useEffect(() => {
    start(facing);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  const capture = () => {
    const v = videoRef.current;
    const frame = frameRef.current;
    if (!v || !frame || !v.videoWidth) return;

    // Map the on-screen guide window to the video's intrinsic pixels,
    // accounting for object-fit: cover.
    const vr = v.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const vw = v.videoWidth, vh = v.videoHeight;
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const offX = (vr.width - vw * scale) / 2;
    const offY = (vr.height - vh * scale) / 2;

    let sx = (fr.left - vr.left - offX) / scale;
    let sy = (fr.top - vr.top - offY) / scale;
    let sw = fr.width / scale;
    let sh = fr.height / scale;
    // Clamp inside the frame.
    sx = Math.max(0, Math.min(sx, vw));
    sy = Math.max(0, Math.min(sy, vh));
    sw = Math.min(sw, vw - sx);
    sh = Math.min(sh, vh - sy);

    const outH = Math.min(1280, Math.round(sh));
    const outW = Math.round(outH * (sw / sh));
    const cv = document.createElement("canvas");
    cv.width = outW; cv.height = outH;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    if (facing === "user") { ctx.translate(outW, 0); ctx.scale(-1, 1); } // un-mirror selfie cam
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, outW, outH);
    cv.toBlob((b) => { if (b) { stop(); onCapture(b); } }, "image/jpeg", 0.78);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) { stop(); onCapture(f); }
  };

  return (
    <div className="cam">
      <video ref={videoRef} playsInline muted autoPlay />

      {!failed && (
        <>
          <div className="cam-frame" ref={frameRef}>
            <span className="corner tl" /><span className="corner tr" />
            <span className="corner bl" /><span className="corner br" />
          </div>
          <p className="cam-hint">Fit the design inside the frame — it’s cropped to this box automatically.</p>
        </>
      )}

      <div className="cam-title">
        <div>
          <div className="t">{title}</div>
          <div className="s">{subtitle}</div>
        </div>
        <button className="cam-x" onClick={() => { stop(); onClose(); }} aria-label="Cancel">✕</button>
      </div>

      {failed ? (
        <div className="cam-fallback">
          <p>{failed}</p>
          <button className="btn primary" onClick={() => fileRef.current?.click()}>Choose a photo</button>
          <button className="btn" onClick={() => { stop(); onClose(); }}>Cancel</button>
        </div>
      ) : (
        <div className="cam-bar">
          <button className="cam-side" onClick={() => fileRef.current?.click()} aria-label="Choose from gallery">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
          </button>
          <button className="shutter" onClick={capture} aria-label="Take photo" disabled={!ready} />
          <button className="cam-side" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))} aria-label="Switch camera">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h3l2-2h8l2 2h3v12H3z" /><path d="M12 18a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="m9 9 1.5-1.5M15 15l-1.5 1.5" /></svg>
          </button>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
    </div>
  );
}
