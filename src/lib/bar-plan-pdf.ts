import type { Section } from '@/data/sections';
import { formatMm, formatNumber, pad2 } from '@/lib/format';
import { escapeHtml } from '@/lib/pdf-html';

import type { BarPlan } from './bar-optimizer';

export type BarPlanPdfInput = {
  siteName: string;
  section: Section;
  plan: BarPlan;
};

/** Builds the printable HTML for a bar plan — handed to expo-print to render as a PDF. */
export function buildBarPlanHtml({ siteName, section, plan }: BarPlanPdfInput): string {
  const generatedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const stats = [
    { label: 'Bars required', value: String(plan.bars.length) },
    { label: 'Total material', value: formatMm(plan.totalMaterial) },
    { label: 'Estimated waste', value: formatMm(plan.waste) },
    { label: 'Utilization', value: `${plan.utilization.toFixed(1)}%` },
  ];

  const bars = plan.bars
    .map((bar, barIndex) => {
      const segments = bar.pieces
        .map(
          (piece, pieceIndex) => `
            <div class="piece" style="width:${(piece / bar.length) * 100}%">
              <span>${formatNumber(piece)}</span>
            </div>`,
        )
        .join('');
      const wastePct = Math.max(0, ((bar.length - bar.used) / bar.length) * 100);
      return `
        <div class="bar">
          <div class="bar-label">
            <span>BAR ${pad2(barIndex + 1)}</span>
            <span>${formatNumber(bar.used)} / ${formatMm(bar.length)}</span>
          </div>
          <div class="track">
            ${segments}
            ${wastePct > 0 ? `<div class="waste" style="width:${wastePct}%"></div>` : ''}
          </div>
        </div>`;
    })
    .join('');

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { margin: 28px; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, Helvetica, Arial, sans-serif; color: #101827; }
          .header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 2px solid #101827; padding-bottom: 14px; margin-bottom: 20px; }
          .brand { font-size: 12px; letter-spacing: 1.5px; color: #6c7482; text-transform: uppercase; }
          .title { font-size: 26px; font-weight: 700; margin-top: 4px; }
          .meta { text-align: right; font-size: 12px; color: #6c7482; }
          .meta b { color: #101827; }
          .site { margin-bottom: 22px; }
          .site-label { font-size: 11px; letter-spacing: 1px; color: #6c7482; text-transform: uppercase; }
          .site-name { font-size: 20px; font-weight: 700; margin-top: 2px; }
          .section-line { margin-top: 4px; font-size: 13px; color: #6c7482; }
          .stats { display: flex; gap: 10px; margin-bottom: 26px; }
          .stat { flex: 1; background: #f5f7f9; border-radius: 10px; padding: 12px 14px; }
          .stat-label { font-size: 10px; letter-spacing: 0.6px; color: #6c7482; text-transform: uppercase; }
          .stat-value { font-size: 17px; font-weight: 700; margin-top: 4px; }
          h2 { font-size: 13px; letter-spacing: 1px; text-transform: uppercase; color: #6c7482; margin: 0 0 12px; }
          .bar { margin-bottom: 14px; }
          .bar-label { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; margin-bottom: 5px; }
          .track { display: flex; height: 34px; border-radius: 6px; overflow: hidden; background: #263554; }
          .piece {
            display: flex; align-items: center; justify-content: center; min-width: 2px;
            background: linear-gradient(180deg, #7c9dff 0%, #3a63e0 100%);
            border-right: 2px solid #111c31;
            color: #ffffff; font-size: 10px; font-weight: 700; overflow: hidden;
          }
          .waste {
            background: repeating-linear-gradient(45deg, #263554, #263554 4px, #314263 4px, #314263 8px);
          }
          .footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e8ebef; font-size: 10px; color: #9aa1ac; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">Vimalnath Sales Corporation</div>
            <div class="title">Bar Cutting Plan</div>
          </div>
          <div class="meta">
            <div><b>Generated</b> ${escapeHtml(generatedOn)}</div>
            <div><b>Cutting loss</b> ${plan.kerf} mm per cut</div>
            <div><b>Cuts</b> ${plan.cuts}</div>
          </div>
        </div>

        <div class="site">
          <div class="site-label">Site</div>
          <div class="site-name">${escapeHtml(siteName) || 'Untitled site'}</div>
          <div class="section-line">${escapeHtml(section.code)} · ${escapeHtml(section.name)} · ${escapeHtml(section.dimensions)}</div>
        </div>

        <div class="stats">
          ${stats.map((stat) => `<div class="stat"><div class="stat-label">${stat.label}</div><div class="stat-value">${stat.value}</div></div>`).join('')}
        </div>

        <h2>Cut arrangement · ${plan.bars.length} ${plan.bars.length === 1 ? 'bar' : 'bars'} required</h2>
        ${bars}

        <div class="footer">Vimalnath Sales Corporation · Bar optimizer · Generated on ${escapeHtml(generatedOn)}</div>
      </body>
    </html>
  `;
}
