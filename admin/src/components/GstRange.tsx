import { Segmented, TextField } from '@/components/Field';
import { rangeOf, type Range, type RangeChoice } from '@/data/gst';
import { localDay } from '@/data/payments';

export type RangeState = { choice: RangeChoice; from: string; to: string };
export const initialRange = (choice: RangeChoice = 'month'): RangeState => ({ choice, from: '', to: '' });
export const resolveRange = (state: RangeState): Range => rangeOf(state.choice, localDay(), { from: state.from, to: state.to });

/** The period a GST page covers: this or last month, this or last financial year, or chosen days. */
export function GstRange({ value, onChange }: { value: RangeState; onChange: (value: RangeState) => void }) {
  return (
    <div className="row-wrap" style={{ alignItems: 'flex-end', gap: 'var(--space-3)' }}>
      <Segmented<RangeChoice>
        label="Period"
        value={value.choice}
        onChange={(choice) => onChange({ ...value, choice })}
        options={[
          { value: 'month', label: 'This month' },
          { value: 'previous', label: 'Previous month' },
          { value: 'fy', label: 'This FY' },
          { value: 'previousFy', label: 'Previous FY' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {value.choice === 'custom' && (
        <>
          <TextField label="From" type="date" value={value.from} onChange={(event) => onChange({ ...value, from: event.target.value })} />
          <TextField label="To" type="date" value={value.to} onChange={(event) => onChange({ ...value, to: event.target.value })} />
        </>
      )}
    </div>
  );
}
