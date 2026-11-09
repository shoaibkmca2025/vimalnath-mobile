import { WarningIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Card, CardHeader } from '@/components/Card';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import type { Section } from '@/data/types';
import { planBars } from '@/generated/app-lib/bar-optimizer';
import { formatNumber, plural } from '@/lib/format';

/** "1200 x 4", "1200×4", "1200 4" or just "1200" (one piece). */
function parsePieces(text: string) {
  return text
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [length, qty] = line.split(/\s*[x×*]\s*|\s+/i).map(Number);
      return { length: Math.round(length ?? 0), qty: Math.round(qty ?? 1) || 1 };
    });
}

/** The app's Bar Optimizer on a cut list you type: same best-fit plan, same waste figures. */
export function OptimizerTester({ sections }: { sections: Section[] }) {
  const [code, setCode] = useState(sections[0]?.code ?? '');
  const section = sections.find((item) => item.code === code);
  const [bar, setBar] = useState(String(section?.bar ?? 6000));
  const [kerf, setKerf] = useState('0'); // the app's default
  const [pieces, setPieces] = useState('1950 x 4\n1016 x 6\n780 x 2');

  const outcome = planBars({ pieces: parsePieces(pieces), stock: [{ length: Number(bar) }], kerf: Number(kerf) || 0 });

  return (
    <Card aria-labelledby="optimizer-title">
      <CardHeader id="optimizer-title" title="Try the optimizer" description="Runs the app’s Bar Optimizer, so the plan matches what a phone shows." />
      <div className="card__body optimizer">
        <div className="stack">
          <SelectField
            label="Section"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              const next = sections.find((item) => item.code === event.target.value);
              if (next) setBar(String(next.bar));
            }}
            options={sections.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }))}
          />
          <div className="form-grid">
            <TextField label="Standard bar" type="number" inputMode="numeric" min={1} suffix="mm" value={bar} onChange={(event) => setBar(event.target.value)} />
            <TextField label="Cutting loss per cut" type="number" inputMode="decimal" min={0} step={0.5} suffix="mm" value={kerf} onChange={(event) => setKerf(event.target.value)} />
          </div>
          <TextAreaField label="Pieces" value={pieces} onChange={(event) => setPieces(event.target.value)} rows={5} hint="One length per line in mm, with a quantity: 1200 x 4." spellCheck={false} />
        </div>

        <div aria-live="polite">
          {'error' in outcome ? (
            <p className="field__error" role="alert">
              <WarningIcon size={16} weight="bold" aria-hidden /> {outcome.error}
            </p>
          ) : (
            <div className="stack">
              <div className="optimizer__summary">
                <p>
                  <span className="optimizer__figure num">{formatNumber(outcome.plan.bars.length)}</span> {outcome.plan.bars.length === 1 ? 'bar' : 'bars'}
                </p>
                <p>
                  <span className="optimizer__figure num">{outcome.plan.utilization.toFixed(1)}%</span> used
                </p>
                <p>
                  <span className="optimizer__figure num">{formatNumber(outcome.plan.waste)}</span> mm waste
                </p>
              </div>
              <ol className="bars" aria-label="Cut plan">
                {outcome.plan.bars.map((planned, index) => (
                  <li key={index} className="bars__item">
                    <span className="bars__label">
                      Bar {index + 1} · {plural(planned.pieces.length, 'cut')} · {formatNumber(planned.length - planned.used)} mm left
                    </span>
                    <span className="bars__track" aria-hidden>
                      {planned.pieces.map((piece, pieceIndex) => (
                        <span key={pieceIndex} className="bars__piece" style={{ width: `${(piece / planned.length) * 100}%` }} title={`${piece} mm`}>
                          {piece / planned.length > 0.09 ? formatNumber(piece) : ''}
                        </span>
                      ))}
                    </span>
                    <span className="visually-hidden">Pieces: {planned.pieces.map((piece) => `${piece} mm`).join(', ')}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
