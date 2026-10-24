// Save a client report as a PDF file, in the browser: each A4 page of the
// report (the first page, then every `.dl-report-page`) is drawn to an image at
// twice screen resolution and placed on its own A4 page. The maps are the still
// pictures each heat map hands over (WebGL canvases can't be copied reliably).
// The libraries are loaded only when someone downloads.

const A4 = { w: 210, h: 297, margin: 10 };
/** The report's design width (A4 at 96 dpi), so the file looks the same on any screen. */
const PAPER_PX = 794;

// While drawing: the paper at full width, the map pictures in place of the live maps, no on-screen page rules.
const EXPORT_CSS = `
.dl-exporting { width: ${PAPER_PX}px !important; max-width: none !important; box-shadow: none !important; border-radius: 0 !important; }
.dl-exporting .print\\:hidden { display: none !important; }
.dl-exporting .print\\:block { display: block !important; }
.dl-exporting .dl-report-page { border-top-width: 0 !important; }
`;

/** Printing the report page: A4, a page per `.dl-report-page`, nothing of the app around it. */
export const REPORT_PRINT_CSS = `
@page { size: A4 portrait; margin: 10mm; }
.dl-report-page { break-before: page; }
@media print {
  html, body { height: auto !important; background: #fff !important; overflow: visible !important; }
  body > *:not(.dl-report-overlay) { display: none !important; }
  .dl-report-overlay { position: static !important; inset: auto !important; overflow: visible !important; background: #fff !important; }
  .dl-report-toolbar { display: none !important; }
  .dl-report-wrap { padding: 0 !important; }
  .dl-report-paper { box-shadow: none !important; max-width: none !important; border-radius: 0 !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;

/** "Charity Right - Awareness - proof of play 28 September – 4 October 2026.pdf", safe as a file name everywhere. */
export function reportFileName(advertiser: string, campaign: string, period: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${clean(advertiser)} - ${clean(campaign)} - proof of play ${clean(period)}.pdf`;
}

export async function downloadReportPdf(paper: HTMLElement, fileName: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  const [{ toJpeg }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);

  const style = document.createElement("style");
  style.textContent = EXPORT_CSS;
  document.head.appendChild(style);
  paper.classList.add("dl-exporting");
  try {
    // Let the layout settle at full width.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    // The first page, then each page; the footer is set at the foot of the last.
    const children = [...paper.children] as HTMLElement[];
    const pages = children.filter((el) => el.classList.contains("dl-report-first") || el.classList.contains("dl-report-page"));
    const footer = children.find((el) => el.tagName === "FOOTER");
    const fontEmbedCSS = await embeddedFonts();
    const draw = (el: HTMLElement) => toJpeg(el, { quality: 0.9, pixelRatio: 2, backgroundColor: "#ffffff", fontEmbedCSS });

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    const box = { w: A4.w - 2 * A4.margin, h: A4.h - 2 * A4.margin };
    const foot = footer ? await draw(footer) : null;
    const footSize = foot ? await imageSize(foot) : null;
    const footH = footSize ? (box.w * footSize.h) / footSize.w : 0;
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(i, pages.length);
      const url = await draw(pages[i]);
      const size = await imageSize(url);
      // Full width, unless the page is taller than A4: then full height.
      let w = box.w;
      let h = (box.w * size.h) / size.w;
      if (h > box.h) {
        w = (box.h * size.w) / size.h;
        h = box.h;
      }
      if (i > 0) pdf.addPage();
      pdf.addImage(url, "JPEG", A4.margin + (box.w - w) / 2, A4.margin, w, h, undefined, "FAST");
      if (foot && i === pages.length - 1) {
        // At the foot of the page if there's room, otherwise on a page of its own.
        if (h + footH > box.h) pdf.addPage();
        pdf.addImage(foot, "JPEG", A4.margin, A4.h - A4.margin - footH, box.w, footH, undefined, "FAST");
      }
    }
    onProgress?.(pages.length, pages.length);
    pdf.setProperties({ title: fileName.replace(/\.pdf$/, ""), creator: "DigiLite" });
    pdf.save(fileName);
  } finally {
    paper.classList.remove("dl-exporting");
    style.remove();
  }
}

let fontCss: Promise<string | undefined> | null = null;

/**
 * The page's web fonts (Google Fonts, Latin only) as CSS with the font files
 * inlined, so the drawn pages use them. The browser won't let the drawing
 * library read another site's stylesheet itself.
 */
function embeddedFonts(): Promise<string | undefined> {
  fontCss ??= (async () => {
    try {
      const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]')];
      const css = (await Promise.all(links.map((l) => fetch(l.href).then((r) => r.text())))).join("\n");
      // Google's CSS marks each block with its subset: keep "latin" only.
      const blocks = css.split(/(?=\/\*\s*[\w-]+\s*\*\/)/).filter((b) => /^\/\*\s*latin\s*\*\//.test(b));
      const inlined = await Promise.all(
        blocks.map(async (b) => {
          const m = b.match(/url\((https:[^)]+)\)/);
          if (!m) return b;
          const blob = await (await fetch(m[1])).blob();
          const data = await new Promise<string>((res) => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result));
            fr.readAsDataURL(blob);
          });
          return b.replace(m[1], data);
        }),
      );
      return inlined.join("\n") || undefined;
    } catch {
      // The fonts fall back to the system's; the report still reads well.
      fontCss = null;
      return undefined;
    }
  })();
  return fontCss;
}

function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Couldn't draw the report"));
    img.src = url;
  });
}
