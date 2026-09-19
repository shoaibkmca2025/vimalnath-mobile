import { escapeHtml } from '@/lib/pdf-html';

import type { GlassPlanResult } from './glass-calculator';

export type GlassPlanPdfInput = {
  systemName: string;
  result: GlassPlanResult;
};

/** Builds the printable HTML for a glass cutting plan — handed to expo-print to render as a PDF. */
export function buildGlassPlanHtml({ systemName, result }: GlassPlanPdfInput): string {
  const generatedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { margin: 28px; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, Helvetica, Arial, sans-serif; color: #101827; }
          .header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 2px solid #101827; padding-bottom: 14px; margin-bottom: 22px; }
          .brand { font-size: 12px; letter-spacing: 1.5px; color: #6c7482; text-transform: uppercase; }
          .title { font-size: 24px; font-weight: 700; margin-top: 4px; }
          .meta { text-align: right; font-size: 12px; color: #6c7482; }
          .meta b { color: #101827; }
          section { margin-bottom: 16px; padding: 16px 18px; border-radius: 14px; }
          section h2 { margin: 0 0 4px; font-size: 12px; letter-spacing: 0.6px; text-transform: uppercase; }
          section .value { font-size: 23px; font-weight: 700; }
          section .note { margin-top: 4px; font-size: 12px; color: #6c7482; }
          .cutting { background: #e9f8f2; }
          .cutting h2, .cutting .value { color: #23a779; }
          .glass { background: #edf2ff; }
          .glass h2, .glass .value { color: #2458e8; }
          .material { background: #f3f0ff; }
          .material h2 { color: #7c5cea; }
          .material-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid rgba(16,24,39,0.08); }
          .material-row:last-child { border-bottom: none; }
          .footer { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e8ebef; font-size: 10px; color: #9aa1ac; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">Vimalnath Sales Corporation</div>
            <div class="title">${escapeHtml(systemName)}</div>
          </div>
          <div class="meta">
            <div><b>Generated</b> ${escapeHtml(generatedOn)}</div>
            <div><b>Opening</b> ${result.openingWidth} × ${result.openingHeight} mm</div>
          </div>
        </div>

        <section class="cutting">
          <h2>Cutting Size</h2>
          <div class="value">${result.cuttingWidth} × ${result.cuttingHeight} mm</div>
          <div class="note">Per panel</div>
        </section>

        <section class="glass">
          <h2>Glass Size</h2>
          <div class="value">${result.glassWidth} × ${result.glassHeight} mm</div>
          <div class="note">Qty ${result.glassQuantity}</div>
        </section>

        <section class="material">
          <h2>Material List</h2>
          ${result.materials.map((item) => `<div class="material-row"><span>${escapeHtml(item.label)}</span><span>${escapeHtml(item.value)}</span></div>`).join('')}
        </section>

        <div class="footer">Vimalnath Sales Corporation · Glass Cutting & Material Calculator · Generated on ${escapeHtml(generatedOn)}</div>
      </body>
    </html>
  `;
}
