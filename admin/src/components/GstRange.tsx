import { SelectField, TextField } from '@/components/Field';
import type { RangeChoice, RangeState } from '@/data/gst';

const CHOICES: { value: RangeChoice; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'previous', label: 'Last month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'previousQuarter', label: 'Last quarter' },
  { value: 'fy', label: 'This financial year' },
  { value: 'previousFy', label: 'Last financial year' },
  { value: 'custom', label: 'Custom dates' },
];

/** The period a page covers: a day, week, month, quarter or financial year, or chosen days. Used by GST, reports and expenses. */
export function GstRange({ value, onChange }: { value: RangeState; onChange: (value: RangeState) => void }) {
  return (
    <div className="row-wrap" style={{ alignItems: 'flex-end', gap: 'var(--space-3)' }}>
      <SelectField label="Period" value={value.choice} onChange={(event) => onChange({ ...value, choice: event.target.value as RangeChoice })} options={CHOICES} />
      {value.choice === 'custom' && (
        <>
          <TextField label="From" type="date" value={value.from} onChange={(event) => onChange({ ...value, from: event.target.value })} />
          <TextField label="To" type="date" value={value.to} onChange={(event) => onChange({ ...value, to: event.target.value })} />
        </>
      )}
    </div>
  );
}
