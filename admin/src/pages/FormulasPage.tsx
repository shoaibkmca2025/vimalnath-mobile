import { CheckCircleIcon, InfoIcon, WarningIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { SelectField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useData } from '@/data/useData';
import type { CutlistSystemId } from '@/data/types';
import { formatInchSize, formatInches } from '@/generated/app-lib/format';
import { computeGlassPlan, getSystemRange, parsePanelCount, type GlassPlanResult } from '@/generated/app-lib/glass-calculator';
import { formatNumber, plural } from '@/lib/format';

/** From the note on telescopicFormula in the app: Vimalnath checked these four, the rest follow the same rule. */
const CHECKED = new Set(['1+0', '1+1', '2+0', '2+1']);

type Status = 'checked' | 'extended' | 'placeholder';
const STATUS: Record<Status, { label: string; tone: 'success' | 'info' | 'warning'; detail: string }> = {
  checked: { label: 'Confirmed', tone: 'success', detail: 'Confirmed by Vimalnath' },
  extended: { label: 'Same rule', tone: 'info', detail: 'Uses the confirmed telescopic rule, not separately checked' },
  placeholder: { label: 'Placeholder', tone: 'warning', detail: 'Opening − 20 mm, split evenly, until a formula is supplied' },
};

const systemCode = (name: string) => name.match(/\d+\s*\+\s*\d+/)?.[0].replace(/\s+/g, '') ?? '';

function statusOf(name: string): Status {
  if (!getSystemRange(name)) return 'placeholder';
  return CHECKED.has(systemCode(name)) ? 'checked' : 'extended';
}

/** A size inside the allowed range, for the worked example: the middle, rounded to 10 mm. */
function exampleSize(name: string) {
  const range = getSystemRange(name);
  if (!range) return { width: 600 * parsePanelCount(name), height: 2400 };
  return { width: Math.round((range.minWidth + range.maxWidth) / 20) * 10, height: 2400 };
}

const mm = (value: number) => `${formatNumber(value)} mm`;

export default function FormulasPage() {
  const { db } = useData();
  const [params, setParams] = useSearchParams();

  const rows = useMemo(
    () =>
      db.cutlist.systems.flatMap((system) =>
        (db.cutlist.configurations[system.id] ?? []).map((configuration) => {
          const size = exampleSize(configuration.name);
          const outcome = computeGlassPlan(configuration.name, size.width, size.height, parsePanelCount(configuration.name));
          return {
            system: system.id as CutlistSystemId,
            systemName: system.name,
            name: configuration.name,
            panels: parsePanelCount(configuration.name),
            range: getSystemRange(configuration.name),
            status: statusOf(configuration.name),
            size,
            example: 'result' in outcome ? outcome.result : null,
          };
        }),
      ),
    [db.cutlist],
  );

  const selectedName = rows.some((row) => row.name === params.get('config')) ? params.get('config')! : (rows[3]?.name ?? rows[0]?.name ?? '');
  const selected = rows.find((row) => row.name === selectedName);
  const counts = { checked: 0, extended: 0, placeholder: 0 };
  for (const row of rows) counts[row.status] += 1;

  return (
    <>
      <PageHeader
        title="Glass Formulas"
        description="How the app’s Cutlist tab turns an opening into cutting sizes, glass sizes and a material list. Everything here runs the app’s own calculator."
      />

      <div className="stack-lg">
        <p className="notice">
          <InfoIcon size={16} weight="bold" aria-hidden />
          <span>
            Formulas are part of the app’s code (<span className="mono">src/lib/glass-calculator.ts</span>), so changing one needs an app update. Use this page to check them
            against the shop floor and to see which systems still need a confirmed formula.
          </span>
        </p>

        <div className="stats">
          <SummaryTile status="checked" count={counts.checked} />
          <SummaryTile status="extended" count={counts.extended} />
          <SummaryTile status="placeholder" count={counts.placeholder} />
          <div className="card stat">
            <p className="stat__label">Configurations in the app</p>
            <p className="stat__value">{formatNumber(rows.length)}</p>
            <p className="stat__foot">Across {plural(db.cutlist.systems.length, 'system')}</p>
          </div>
        </div>

        <div className="editor">
          <Card aria-labelledby="rule-title">
            <CardHeader id="rule-title" title="Telescopic sliding rule" description="“2+1” means 2 sliding panels and 1 fixed panel." />
            <div className="card__body stack-lg">
              <ol className="formula">
                <li>
                  <span className="formula__name">Panels</span>
                  <span className="formula__expr">sliding + fixed</span>
                </li>
                <li>
                  <span className="formula__name">Cutting width</span>
                  <span className="formula__expr">(opening width + 16 mm × sliding panels) ÷ panels</span>
                </li>
                <li>
                  <span className="formula__name">Cutting height</span>
                  <span className="formula__expr">opening height − 92 mm</span>
                </li>
                <li>
                  <span className="formula__name">Glass size</span>
                  <span className="formula__expr">cutting width − 21 mm × cutting height − 21 mm</span>
                </li>
                <li>
                  <span className="formula__name">Glass quantity</span>
                  <span className="formula__expr">one per panel</span>
                </li>
                <li>
                  <span className="formula__name">Allowed opening</span>
                  <span className="formula__expr">width from 600 mm × panels; height 1,800 – 2,998 mm</span>
                </li>
                <li>
                  <span className="formula__name">Warning</span>
                  <span className="formula__expr">shown when a panel is wider than the printed 950 mm</span>
                </li>
              </ol>
              <div>
                <h3 className="subhead">Material list</h3>
                <dl className="kv kv--compact">
                  <dt>Vertical</dt>
                  <dd>2 nos — 2.5 m up to a 2,489 mm cutting height, 3 m above</dd>
                  <dt>Horizontal</dt>
                  <dd>1+0 and 1+1: one 2.5 m bar per panel. Others: a top and bottom piece per panel at the cutting width, cut from 2.5 m and 3 m bars</dd>
                  <dt>Top track</dt>
                  <dd>
                    1+0 and 1+1: one 2.5 m track per panel. 2+1, 3+1, 4+1: one per panel at the opening width. 2+0, 3+0, 4+0: one per panel at the opening + one cutting
                    width + 200 mm, so the panels can slide clear. Lengths round up to whole feet
                  </dd>
                  <dt>Track cap</dt>
                  <dd>2 nos (2.5 m)</dd>
                  <dt>Handle</dt>
                  <dd>Sliding handle / latch handle, 1+1</dd>
                  <dt>Sliding kit</dt>
                  <dd>1 nos, named after the system (1+0 takes the 0+1 kit)</dd>
                  <dt>Gasket</dt>
                  <dd>3 per panel (8 mm)</dd>
                  <dt>Connector</dt>
                  <dd>4 per panel</dd>
                  <dt>Middle, D. connector</dt>
                  <dd>According to design</dd>
                </dl>
              </div>
            </div>
          </Card>

          <div className="stack editor__aside">
            {selected && <Tester key={selected.name} row={selected} names={rows.map((row) => row.name)} onPick={(name) => setParams({ config: name }, { replace: true })} />}
          </div>
        </div>

        <Card className="table-card" aria-labelledby="configs-title">
          <CardHeader id="configs-title" title="Every configuration" description="Worked examples use the middle of the allowed width and a 2,400 mm height." />
          <div className="table-scroll">
            <table className="table">
              <caption className="visually-hidden">Glass formula for every configuration in the app</caption>
              <thead>
                <tr>
                  <th scope="col">Configuration</th>
                  <th scope="col">Formula</th>
                  <th scope="col">Allowed opening</th>
                  <th scope="col">Example opening</th>
                  <th scope="col">Cutting size</th>
                  <th scope="col">Glass size</th>
                  <th scope="col" className="is-num">
                    Glass qty
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Try it</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} aria-current={row.name === selectedName || undefined}>
                    <td>
                      <span className="cell-title">{row.name}</span>
                      <div className="cell-sub">
                        {row.systemName} · {plural(row.panels, 'panel')}
                      </div>
                    </td>
                    <td>
                      <Badge tone={STATUS[row.status].tone} icon={row.status === 'placeholder' ? WarningIcon : CheckCircleIcon}>
                        {STATUS[row.status].label}
                      </Badge>
                    </td>
                    <td className="num">{row.range ? `${formatNumber(row.range.minWidth)}–${formatNumber(row.range.maxWidth)} × ${formatNumber(row.range.minHeight)}–${formatNumber(row.range.maxHeight)}` : 'Any size'}</td>
                    <td className="num">
                      {formatNumber(row.size.width)} × {formatNumber(row.size.height)}
                    </td>
                    <td className="num">{row.example ? `${row.example.cuttingWidth} × ${row.example.cuttingHeight}` : '—'}</td>
                    <td className="num">{row.example ? `${row.example.glassWidth} × ${row.example.glassHeight}` : '—'}</td>
                    <td className="is-num">{row.example?.glassQuantity ?? '—'}</td>
                    <td>
                      <Button size="sm" variant="plain" onClick={() => setParams({ config: row.name }, { replace: true })} aria-label={`Try ${row.name}`}>
                        Try
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function SummaryTile({ status, count }: { status: Status; count: number }) {
  const meta = STATUS[status];
  return (
    <div className="card stat">
      <p className="stat__label">
        <Badge tone={meta.tone} icon={status === 'placeholder' ? WarningIcon : CheckCircleIcon}>
          {meta.label}
        </Badge>
      </p>
      <p className="stat__value">{formatNumber(count)}</p>
      <p className="stat__foot">{meta.detail}</p>
    </div>
  );
}

type Row = { name: string; panels: number; range: ReturnType<typeof getSystemRange>; status: Status; size: { width: number; height: number } };

/** The app's calculator on a size you type, showing exactly what a phone would. */
function Tester({ row, names, onPick }: { row: Row; names: string[]; onPick: (name: string) => void }) {
  const [width, setWidth] = useState(String(row.size.width));
  const [height, setHeight] = useState(String(row.size.height));
  const w = Number(width);
  const h = Number(height);
  const ready = w > 0 && h > 0;
  const outcome = ready ? computeGlassPlan(row.name, Math.round(w), Math.round(h), row.panels) : null;
  const result: GlassPlanResult | null = outcome && 'result' in outcome ? outcome.result : null;
  const widthLabel = /synchro|folding/i.test(row.name) ? 'Width' : 'Length';

  return (
    <Card aria-labelledby="tester-title">
      <CardHeader id="tester-title" title="Try a size" description="The same result the app shows for this opening." />
      <div className="card__body stack">
        <SelectField label="Configuration" value={row.name} onChange={(event) => onPick(event.target.value)} options={names.map((name) => ({ value: name, label: name }))} />
        <div className="form-grid">
          <TextField label={widthLabel} type="number" inputMode="numeric" min={1} suffix="mm" value={width} onChange={(event) => setWidth(event.target.value)} hint={w > 0 ? formatInches(w) : undefined} />
          <TextField label="Height" type="number" inputMode="numeric" min={1} suffix="mm" value={height} onChange={(event) => setHeight(event.target.value)} hint={h > 0 ? formatInches(h) : undefined} />
        </div>
        {row.range && (
          <p className="field__hint">
            Allowed: {formatNumber(row.range.minWidth)}–{formatNumber(row.range.maxWidth)} × {formatNumber(row.range.minHeight)}–{formatNumber(row.range.maxHeight)} mm
          </p>
        )}
        <div aria-live="polite" className="stack">
          {outcome && 'error' in outcome && (
            <p className="field__error" role="alert">
              <WarningIcon size={16} weight="bold" aria-hidden /> {outcome.error}
            </p>
          )}
          {result && (
            <>
              {result.warning && (
                <p className="notice notice--warning">
                  <WarningIcon size={16} weight="bold" aria-hidden />
                  <span>{result.warning}</span>
                </p>
              )}
              <div className="size-cards">
                <div className="size-card size-card--cutting">
                  <p className="size-card__title">Cutting size</p>
                  <p className="size-card__value num">
                    {result.cuttingWidth} × {result.cuttingHeight} mm
                  </p>
                  <p className="size-card__detail">{formatInchSize(result.cuttingWidth, result.cuttingHeight)} · per panel</p>
                </div>
                <div className="size-card size-card--glass">
                  <p className="size-card__title">Glass size</p>
                  <p className="size-card__value num">
                    {result.glassWidth} × {result.glassHeight} mm
                  </p>
                  <p className="size-card__detail">
                    {formatInchSize(result.glassWidth, result.glassHeight)} · Qty: {result.glassQuantity}
                  </p>
                </div>
              </div>
              <div>
                <h3 className="subhead">Material list</h3>
                <dl className="kv kv--compact">
                  {result.materials.map((item) => (
                    <div key={item.label} style={{ display: 'contents' }}>
                      <dt>{item.label}</dt>
                      <dd>
                        {item.value}
                        {item.note && <span className="cell-sub" style={{ display: 'block', whiteSpace: 'normal' }}>{item.note}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <p className="field__hint">Opening {mm(result.openingWidth)} × {mm(result.openingHeight)}.</p>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
