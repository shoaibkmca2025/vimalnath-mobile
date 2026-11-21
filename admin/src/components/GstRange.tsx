import { Segmented, TextField } from '@/components/Field';
import type { RangeChoice, RangeState } from '@/data/gst';

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
