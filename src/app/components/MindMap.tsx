"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Check, CodeXml, Copy, Download, Maximize2, Minimize2, Move, Scan, TriangleAlert, ZoomIn, ZoomOut } from "lucide-react";
import type { Mermaid } from "mermaid";
import { sanitizeMindmap } from "@/lib/mindmap";

/* ------------------------------------------------------------------ */
/* Mermaid is loaded at runtime from its prebuilt browser bundle      */
/* (copied to public/vendor by scripts/vendor-mermaid.mjs) instead of  */
/* being bundled: it is several MB and exhausts the bundler's memory   */
/* on smaller machines. Only the type import below touches the package.*/
/* ------------------------------------------------------------------ */

const MERMAID_SRC = "/vendor/mermaid.min.js";

function slugFile(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "mind-map";
}

let mermaidPromise: Promise<Mermaid> | null = null;

const BRANCH_COLORS = [
  "#3b5bdb", "#2b8a3e", "#c2410c", "#7048e8", "#0c8599", "#c2255c",
  "#5c7cfa", "#2f9e44", "#e8590c", "#845ef7", "#1098ad", "#d6336c",
];

function loadMermaidScript(): Promise<Mermaid> {
  const global = window as unknown as { mermaid?: Mermaid };
  if (global.mermaid) return Promise.resolve(global.mermaid);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = MERMAID_SRC;
    script.async = true;
    script.onload = () =>
      global.mermaid ? resolve(global.mermaid) : reject(new Error("The mind map engine did not initialise."));
    script.onerror = () => {
      script.remove(); // allow a clean retry later
      reject(new Error("Could not load the mind map engine."));
    };
    document.head.append(script);
  });
}

export function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = loadMermaidScript();
    mermaidPromise.catch(() => {
      mermaidPromise = null; // a failed load (e.g. offline) can be retried
    });
  }
  return mermaidPromise;
}

/** Configure Mermaid for the current light/dark theme (cheap; called before each render). */
function configure(mermaid: Mermaid, dark: boolean) {
  const themeVariables: Record<string, string | boolean> = {
    darkMode: dark,
    background: dark ? "#1a1a19" : "#ffffff",
    fontSize: "15px",
    primaryColor: dark ? "#2a3466" : "#e8ecfa",
    primaryTextColor: dark ? "#ecece7" : "#1c1c1a",
    primaryBorderColor: dark ? "#8aa2ff" : "#2747c4",
    lineColor: dark ? "#6f6f68" : "#96968e",
    textColor: dark ? "#ecece7" : "#1c1c1a",
    // Mermaid styles the mindmap root with the git palette.
    git0: dark ? "#8aa2ff" : "#2747c4",
    gitBranchLabel0: dark ? "#0c1230" : "#ffffff",
  };
  BRANCH_COLORS.forEach((color, i) => {
    themeVariables[`cScale${i}`] = color;
    themeVariables[`cScaleLabel${i}`] = "#ffffff";
  });
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: getComputedStyle(document.body).fontFamily,
    themeVariables,
    mindmap: { padding: 16, maxNodeWidth: 220 },
  });
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/* ------------------------------------------------------------------ */

interface View {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 4;

interface MindMapProps {
  code: string;
  title: string;
  notes: string;
  active?: boolean;
}

export default function MindMap({ code, title, notes, active = true }: MindMapProps) {
  const renderId = `mm-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const interacted = useRef(false);

  const [svg, setSvg] = useState<string | null>(null);
  const [usedCode, setUsedCode] = useState(code);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [fullscreen, setFullscreen] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [themeKey, setThemeKey] = useState(0);

  // Redraw when the app switches between light and dark.
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeKey((k) => k + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Render with Mermaid; if the stored code fails, re-sanitise (or derive from the notes) and retry.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mermaid = await loadMermaid();
      configure(mermaid, isDark());
      const candidates = [...new Set([code, sanitizeMindmap(code, title, notes)].filter((c): c is string => !!c?.trim()))];
      let lastError: unknown = new Error("No mind map was generated.");
      for (const [i, candidate] of candidates.entries()) {
        try {
          await mermaid.parse(candidate);
          const result = await mermaid.render(`${renderId}-${themeKey}-${i}`, candidate);
          if (cancelled) return;
          setSvg(result.svg);
          setUsedCode(candidate);
          return;
        } catch (err) {
          lastError = err;
        }
      }
      if (!cancelled) setError(lastError instanceof Error ? lastError.message : String(lastError));
    })();
    return () => {
      cancelled = true;
    };
  }, [code, title, notes, renderId, themeKey]);

  // Give the SVG its natural pixel size so we can pan/zoom it with a transform.
  useLayoutEffect(() => {
    const el = contentRef.current?.querySelector("svg");
    if (!el) return;
    const box = el.viewBox?.baseVal;
    const w = box?.width || el.getBoundingClientRect().width;
    const h = box?.height || el.getBoundingClientRect().height;
    el.setAttribute("width", String(w));
    el.setAttribute("height", String(h));
    el.style.maxWidth = "none";
    setSize({ w, h });
  }, [svg]);

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !size) return;
    const { clientWidth: cw, clientHeight: ch } = vp;
    if (!cw || !ch) return;
    const scale = Math.min(Math.max(Math.min(cw / size.w, ch / size.h) * 0.92, MIN_SCALE), 1.6);
    setView({ scale, x: (cw - size.w * scale) / 2, y: (ch - size.h * scale) / 2 });
  }, [size]);

  // Fit when first shown, when entering/leaving focus mode, and on resize until the user takes over.
  useEffect(() => {
    if (!active) return;
    interacted.current = false;
    fit();
    const vp = viewportRef.current;
    if (!vp) return;
    const observer = new ResizeObserver(() => {
      if (!interacted.current) fit();
    });
    observer.observe(vp);
    return () => observer.disconnect();
  }, [active, fit, fullscreen]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    interacted.current = true;
    setView((v) => {
      const vp = viewportRef.current;
      const px = cx ?? (vp ? vp.clientWidth / 2 : 0);
      const py = cy ?? (vp ? vp.clientHeight / 2 : 0);
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const ratio = scale / v.scale;
      return { scale, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
    });
  }, []);

  // Wheel / trackpad-pinch zoom around the cursor (non-passive so the page doesn't scroll).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoomAt, svg]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { id: d.id, x: e.clientX, y: e.clientY };
    interacted.current = true;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const downloadSvg = () => {
    const el = contentRef.current?.querySelector("svg");
    if (!el) return;
    const clone = el.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.style.backgroundColor = isDark() ? "#1a1a19" : "#ffffff";
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: `${slugFile(title)}-mind-map.svg` }).click();
    URL.revokeObjectURL(url);
  };

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(usedCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const rendering = !svg && !error;

  return (
    <div
      className={fullscreen ? "fixed inset-0 z-50 flex flex-col bg-bg p-3 sm:p-6" : "flex flex-col"}
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? "Mind map focus mode" : undefined}
    >
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs text-faint">
          <Move className="size-3.5" /> Drag to pan · scroll or pinch to zoom · double-click to zoom in
        </p>
        <div className="flex items-center gap-1.5">
          <button type="button" className="icon-btn" onClick={() => zoomAt(1 / 1.25)} aria-label="Zoom out" disabled={!svg}>
            <ZoomOut className="size-4" />
          </button>
          <span className="w-14 text-center font-mono text-xs text-muted tabular-nums">{Math.round(view.scale * 100)}%</span>
          <button type="button" className="icon-btn" onClick={() => zoomAt(1.25)} aria-label="Zoom in" disabled={!svg}>
            <ZoomIn className="size-4" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              interacted.current = false;
              fit();
            }}
            aria-label="Fit to screen"
            disabled={!svg}
          >
            <Scan className="size-4" />
          </button>
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          <button type="button" className="icon-btn" onClick={() => setShowSource((s) => !s)} aria-label="Toggle Mermaid source" aria-pressed={showSource}>
            <CodeXml className="size-4" />
          </button>
          <button type="button" className="icon-btn" onClick={downloadSvg} aria-label="Download SVG" disabled={!svg}>
            <Download className="size-4" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setFullscreen((f) => !f)}
            aria-label={fullscreen ? "Exit focus mode" : "Enter focus mode"}
          >
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          zoomAt(1.5, e.clientX - rect.left, e.clientY - rect.top);
        }}
        className={`mindmap-canvas relative touch-none overflow-hidden rounded-lg border border-line bg-surface select-none ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        } ${fullscreen ? "flex-1" : "h-[calc(100vh-17rem)] min-h-[440px]"}`}
        style={{ backgroundImage: "radial-gradient(color-mix(in oklab, var(--ink) 12%, transparent) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
        aria-label={`Mind map of ${title}`}
        role="img"
      >
        {rendering && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-3 text-sm text-muted">
              <div className="size-10 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
              Drawing your concept map…
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="max-w-md text-center">
              <TriangleAlert className="mx-auto size-8 text-warn" />
              <p className="mt-3 font-medium text-ink">This mind map couldn&apos;t be drawn.</p>
              <p className="mt-1 text-sm text-muted">The raw Mermaid source is available with the code button above.</p>
            </div>
          </div>
        )}
        {svg && (
          <div
            ref={contentRef}
            className="absolute top-0 left-0 origin-top-left will-change-transform"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            // Mermaid output is sanitised (securityLevel: "strict").
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>

      {showSource && (
        <div className="mt-4 overflow-hidden rounded-lg border border-line bg-subtle animate-fade-in">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-muted">
            <span className="font-mono">mindMapCode · Mermaid</span>
            <button type="button" onClick={copySource} className="flex items-center gap-1 hover:text-ink">
              {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="max-h-72 overflow-auto p-4 font-mono text-xs leading-relaxed text-ink">{usedCode}</pre>
        </div>
      )}
    </div>
  );
}
