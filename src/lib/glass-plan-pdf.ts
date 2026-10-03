import { formatInchSize } from '@/lib/format';
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
          @page { size: A4; margin: 28px; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, Helvetica, Arial, sans-serif; color: #0b1f4d; }
          .header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 2px solid #0b1f4d; padding-bottom: 14px; margin-bottom: 22px; }
          .brand { font-size: 12px; letter-spacing: 1.5px; color: #5a6b8c; text-transform: uppercase; }
          .title { font-size: 24px; font-weight: 700; margin-top: 4px; }
          .meta { text-align: right; font-size: 12px; color: #5a6b8c; }
          .meta b { color: #0b1f4d; }
          section { margin-bottom: 16px; padding: 16px 18px; border-radius: 14px; }
          section h2 { margin: 0 0 4px; font-size: 12px; letter-spacing: 0.6px; text-transform: uppercase; }
          section .value { font-size: 23px; font-weight: 700; }
          section .inches { margin-top: 2px; font-size: 15px; font-weight: 600; color: #5a6b8c; }
          section .note { margin-top: 4px; font-size: 12px; color: #5a6b8c; }
          .cutting { background: #e6eeff; }
          .cutting h2, .cutting .value { color: #0f3fb8; }
          .glass { background: #edf2ff; }
          .glass h2, .glass .value { color: #2458e8; }
          .material { background: #eef3ff; }
          .material h2 { color: #3867f0; }
          .material-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid rgba(11,31,77,0.1); }
          .material-row:last-child { border-bottom: none; }
          .material-row small { display: block; margin-top: 2px; font-size: 10px; color: #5a6b8c; }
          .footer { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e1e8f7; font-size: 10px; color: #93a1bd; }
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
            <div>${escapeHtml(formatInchSize(result.openingWidth, result.openingHeight))}</div>
          </div>
        </div>

        <section class="cutting">
          <h2>Cutting Size</h2>
          <div class="value">${result.cuttingWidth} × ${result.cuttingHeight} mm</div>
          <div class="inches">${escapeHtml(formatInchSize(result.cuttingWidth, result.cuttingHeight))}</div>
          <div class="note">Per panel</div>
        </section>

        <section class="glass">
          <h2>Glass Size</h2>
          <div class="value">${result.glassWidth} × ${result.glassHeight} mm</div>
          <div class="inches">${escapeHtml(formatInchSize(result.glassWidth, result.glassHeight))}</div>
          <div class="note">Qty ${result.glassQuantity}</div>
        </section>

        <section class="material">
          <h2>Material List</h2>
          ${result.materials
            .map(
              (item) =>
                `<div class="material-row"><span>${escapeHtml(item.label)}${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}</span><span>${escapeHtml(item.value)}</span></div>`,
            )
            .join('')}
        </section>

        <div class="footer">Vimalnath Sales Corporation · Glass Cutting & Material Calculator · Generated on ${escapeHtml(generatedOn)}</div>
      </body>
    </html>
  `;
}
