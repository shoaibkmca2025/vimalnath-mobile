import { InfoIcon, PencilSimpleIcon, PlusIcon, RulerIcon, TrashIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';

import { Button, IconButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, TextAreaField, TextField } from '@/components/Field';
import { OptimizerTester } from '@/components/OptimizerTester';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { useData } from '@/data/useData';
import type { Section } from '@/data/types';
import { useDrawerItem } from '@/hooks/useDrawerItem';
import { formatNumber, plural } from '@/lib/format';

type Draft = Omit<Section, 'bar'> & { bar: string };
const EMPTY: Draft = { code: '', name: '', system: '', bar: '6000', dimensions: '', description: '' };

export default function SectionsPage() {
  const { db, update } = useData();
  const toast = useToast();
  const [query, setQuery] = useState('');
  // null = adding a new section; otherwise the code of the one being edited.
  const drawer = useDrawerItem<{ code: string | null }>();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Section | null>(null);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? db.sections.filter((section) => [section.code, section.name, section.system].some((field) => field.toLowerCase().includes(needle))) : db.sections;
  }, [db.sections, query]);

  const systems = useMemo(() => [...new Set(db.sections.map((section) => section.system))].sort(), [db.sections]);

  const open = (section: Section | null) => {
    setDraft(section ? { ...section, bar: String(section.bar) } : EMPTY);
    setTouched(new Set());
    drawer.show({ code: section?.code ?? null });
  };

  const editing = drawer.item?.code ?? null;
  const original = editing ? db.sections.find((section) => section.code === editing) : undefined;
  const bar = Number(draft.bar);
  const errors: Record<string, string | null> = {
    code: !draft.code.trim()
      ? 'Enter the section code, e.g. S-101.'
      : db.sections.some((section) => section.code.toLowerCase() === draft.code.trim().toLowerCase() && section.code !== editing)
        ? `${draft.code.trim()} is already in the library.`
        : null,
    name: draft.name.trim() ? null : 'Enter the profile name.',
    bar: !Number.isInteger(bar) || bar < 500 || bar > 12000 ? 'Enter the standard bar length in mm, between 500 and 12,000.' : null,
  };
  const shown = (key: string) => (touched.has(key) ? errors[key] : null);
  const touch = (key: string) => () => setTouched((current) => new Set(current).add(key));
  const dirty = JSON.stringify(draft) !== JSON.stringify(original ? { ...original, bar: String(original.bar) } : EMPTY);

  const save = () => {
    setTouched(new Set(Object.keys(errors)));
    if (Object.values(errors).some(Boolean)) return;
    const saved: Section = { code: draft.code.trim(), name: draft.name.trim(), system: draft.system.trim(), bar, dimensions: draft.dimensions.trim(), description: draft.description.trim() };
    update('sections', (sections) => (editing ? sections.map((section) => (section.code === editing ? saved : section)) : [...sections, saved]), {
      area: 'calculators',
      summary: editing ? `Edited bar section ${saved.code}` : `Added bar section ${saved.code}`,
      to: '/sections',
    });
    drawer.close();
    toast({ message: editing ? `${saved.code} saved.` : `${saved.code} added to the section library.` });
  };

  const remove = (section: Section) => {
    const previous = db.sections;
    update('sections', (sections) => sections.filter((item) => item.code !== section.code), { area: 'calculators', summary: `Deleted bar section ${section.code}`, to: '/sections' });
    toast({ message: `${section.code} deleted.`, action: { label: 'Undo', onAction: () => update('sections', () => previous, { area: 'calculators', summary: `Restored bar section ${section.code}`, to: '/sections' }) } });
  };

  const columns: Column<Section>[] = [
    {
      key: 'code',
      header: 'Section',
      sortValue: (section) => section.code,
      cell: (section) => (
        <>
          <button type="button" className="cell-title mono link-reset" onClick={() => open(section)}>
            {section.code}
          </button>
          <div className="cell-sub">{section.name}</div>
        </>
      ),
    },
    { key: 'system', header: 'System', sortValue: (section) => section.system, cell: (section) => section.system },
    { key: 'dimensions', header: 'Profile size', cell: (section) => section.dimensions || <span className="muted">—</span> },
    { key: 'bar', header: 'Standard bar', align: 'num', sortValue: (section) => section.bar, cell: (section) => `${formatNumber(section.bar)} mm` },
    {
      key: 'actions',
      header: 'Actions',
      hideHeader: true,
      align: 'actions',
      cell: (section) => (
        <>
          <IconButton icon={PencilSimpleIcon} label={`Edit ${section.code}`} onClick={() => open(section)} />
          <IconButton icon={TrashIcon} tone="danger" label={`Delete ${section.code}`} onClick={() => setDeleting(section)} />
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Bar Sections"
        description="The profile library people choose from in the Bar Optimizer. The standard bar length fills in the cut plan."
        actions={
          <Button variant="primary" icon={PlusIcon} onClick={() => open(null)}>
            New Section
          </Button>
        }
      />

      <p className="notice notice--warning" style={{ marginBottom: 'var(--space-4)' }}>
        <InfoIcon size={16} weight="bold" aria-hidden />
        <span>
          The app’s sections are still the sample records carried over from the web prototype. Replace them with Vimalnath’s approved profiles, codes and bar lengths.
        </span>
      </p>

      <div className="toolbar">
        <SearchInput label="Search sections" placeholder="Code, name or system" value={query} onChange={setQuery} />
        <span className="spacer" />
        <span className="muted">{plural(db.sections.length, 'section')}</span>
      </div>

      <Card className="table-card">
        <DataTable
          caption="Bar sections"
          rows={rows}
          columns={columns}
          getRowId={(section) => section.code}
          onRowClick={open}
          resetKey={query}
          empty={
            <EmptyState icon={RulerIcon} title={db.sections.length ? 'No sections match' : 'No sections yet'} action={!db.sections.length && <Button variant="primary" onClick={() => open(null)}>New Section</Button>}>
              {db.sections.length ? 'Try another code or name.' : 'Add the profiles fabricators cut, with their standard bar length.'}
            </EmptyState>
          }
        />
      </Card>

      {db.sections.length > 0 && (
        <div style={{ marginTop: 'var(--space-6)' }}>
          <OptimizerTester sections={db.sections} />
        </div>
      )}

      <Drawer
        open={drawer.open}
        onClose={drawer.close}
        onSubmit={save}
        dirty={dirty}
        title={editing ? `Edit ${editing}` : 'New section'}
        description={editing ? original?.name : 'Add a profile to the Bar Optimizer’s library.'}
        footer={
          <>
            <Button onClick={drawer.close}>Cancel</Button>
            <Button type="submit" variant="primary">
              {editing ? 'Save' : 'Add Section'}
            </Button>
          </>
        }
      >
        <div className="stack-lg">
          <div className="grid-2">
            <TextField label="Code" required value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} onBlur={touch('code')} error={shown('code')} spellCheck={false} data-autofocus />
            <TextField
              label="Standard bar"
              required
              suffix="mm"
              inputMode="numeric"
              value={draft.bar}
              onChange={(event) => setDraft({ ...draft, bar: event.target.value.replace(/\D/g, '') })}
              onBlur={touch('bar')}
              error={shown('bar')}
            />
          </div>
          <TextField label="Name" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} onBlur={touch('name')} error={shown('name')} placeholder="e.g. Sliding frame" />
          <div className="grid-2">
            <TextField label="System" value={draft.system} onChange={(event) => setDraft({ ...draft, system: event.target.value })} list="system-suggestions" placeholder="e.g. Sliding" />
            <TextField label="Profile size" value={draft.dimensions} onChange={(event) => setDraft({ ...draft, dimensions: event.target.value })} placeholder="e.g. 45 × 25 mm" />
          </div>
          <datalist id="system-suggestions">
            {systems.map((system) => (
              <option key={system} value={system} />
            ))}
          </datalist>
          <TextAreaField label="Description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} hint="One sentence shown in the section picker." rows={3} />
        </div>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.code ?? 'section'}?`}
        body="It disappears from the Bar Optimizer’s section picker. Saved cut plans on people’s phones aren’t affected."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove(deleting);
          setDeleting(null);
        }}
      />
    </>
  );
}
