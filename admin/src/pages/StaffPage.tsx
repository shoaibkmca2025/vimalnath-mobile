import { CopyIcon, KeyIcon, PlusIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SelectField, Switch, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { readSession, type Role, type Session } from '@/data/session';
import { useDrawerItem } from '@/hooks/useDrawerItem';
import { api, type ApiError } from '@/lib/api';
import { formatRelativeDay } from '@/lib/format';

type Member = Session & { active: boolean; hasPassword: boolean; lastSignInAt: string | null };
type Draft = { name: string; email: string; role: Role; active: boolean };

const ROLES: { value: Role; label: string }[] = [
  { value: 'owner', label: 'Owner: everything, including staff' },
  { value: 'sales', label: 'Sales: orders and customers' },
  { value: 'catalogue', label: 'Catalogue editor: products, prices and content' },
];
const ROLE_NAME: Record<Role, string> = { owner: 'Owner', sales: 'Sales', catalogue: 'Catalogue editor' };
const EMPTY: Draft = { name: '', email: '', role: 'sales', active: true };
const draftOf = (item: Member | 'new' | null): Draft => (item && item !== 'new' ? { name: item.name, email: item.email, role: item.role, active: item.active } : EMPTY);

export default function StaffPage() {
  const toast = useToast();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const drawer = useDrawerItem<Member | 'new'>();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  useEffect(() => {
    api<Member[]>('/staff').then(setMembers, (error: Error) => setLoadError(error.message));
  }, []);

  const editing = drawer.item === 'new' ? null : drawer.item;

  const open = (item: Member | 'new') => {
    setDraft(draftOf(item));
    setFailure(null);
    drawer.show(item);
  };

  const showLink = (name: string, url: string) => {
    drawer.close();
    setLink({ name, url });
    setLinkOpen(true);
  };

  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(error as ApiError);
    } finally {
      setSaving(false);
    }
  };

  const save = () =>
    run(async () => {
      if (editing) {
        const updated = await api<Member>(`/staff/${editing.id}`, 'PATCH', { name: draft.name, email: draft.email, role: draft.role, active: draft.active });
        // Their own name or role changed, so the sidebar and menu need the new values.
        if (updated.id === readSession()?.id) window.location.reload();
        setMembers((current) => current!.map((member) => (member.id === updated.id ? updated : member)));
        drawer.close();
        toast({ message: `${updated.name} saved.` });
      } else {
        const { staff, link: url } = await api<{ staff: Member; link: string }>('/staff', 'POST', { name: draft.name, email: draft.email, role: draft.role });
        setMembers((current) => [...current!, staff]);
        showLink(staff.name, url);
      }
    });

  const newLink = () =>
    run(async () => {
      const { link: url } = await api<{ link: string }>(`/staff/${editing!.id}/password-link`, 'POST');
      showLink(editing!.name, url);
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link!.url);
      toast({ message: 'Link copied.' });
    } catch {
      toast({ tone: 'error', message: 'Couldn’t copy. Select the link and copy it yourself.' });
    }
  };

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: 'Name',
      sortValue: (member) => member.name,
      cell: (member) => (
        <>
          <button type="button" className="cell-title link-reset" onClick={() => open(member)}>
            {member.name}
          </button>
          <div className="cell-sub">{member.email}</div>
        </>
      ),
    },
    { key: 'role', header: 'Role', sortValue: (member) => ROLE_NAME[member.role], cell: (member) => ROLE_NAME[member.role] },
    {
      key: 'status',
      header: 'Status',
      cell: (member) =>
        !member.active ? <Badge tone="neutral">Deactivated</Badge> : member.hasPassword ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Password not set</Badge>,
    },
    { key: 'last', header: 'Last sign-in', sortValue: (member) => member.lastSignInAt ?? '', cell: (member) => (member.lastSignInAt ? formatRelativeDay(member.lastSignInAt) : 'Never') },
  ];

  const fieldError = (field: string) => (failure?.field === field ? failure.message : null);

  return (
    <>
      <PageHeader
        title="Staff"
        description="Who can use this admin, and what each person can change."
        actions={
          members && (
            <Button variant="primary" icon={PlusIcon} onClick={() => open('new')}>
              Add Staff
            </Button>
          )
        }
      />

      <Card className="table-card">
        {members ? (
          <DataTable caption="Staff" rows={members} columns={columns} getRowId={(member) => String(member.id)} onRowClick={open} initialSort={{ key: 'name', direction: 'asc' }} empty={null} />
        ) : (
          <EmptyState icon={UsersThreeIcon} title={loadError ? 'Couldn’t load staff' : 'Loading staff…'}>
            {loadError}
          </EmptyState>
        )}
      </Card>

      <Drawer
        open={drawer.open}
        title={editing ? editing.name : 'Add Staff'}
        description={editing?.email}
        dirty={JSON.stringify(draft) !== JSON.stringify(draftOf(drawer.item))}
        onClose={drawer.close}
        onSubmit={save}
        footer={
          <>
            <Button onClick={drawer.close}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>
              {editing ? 'Save' : 'Add and Get Link'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField label="Name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} error={fieldError('name')} required autoComplete="off" />
          <TextField label="Email" type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} error={fieldError('email')} required autoComplete="off" />
          <SelectField label="Role" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })} options={ROLES} />
          {editing && <Switch label="Can sign in" description="Turning this off signs them out straight away." checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} />}
          {failure && !failure.field && (
            <p className="notice notice--warning" role="alert">
              {failure.message}
            </p>
          )}
          {editing?.active && (
            <Button icon={KeyIcon} onClick={newLink} disabled={saving}>
              New Password Link
            </Button>
          )}
        </div>
      </Drawer>

      <Drawer open={linkOpen} title="Send this link" description={link ? `For ${link.name}` : undefined} onClose={() => setLinkOpen(false)}>
        <div className="stack">
          <p>
            Send it to {link?.name} on WhatsApp. It lets them set a password, works once, and expires in 3 days. It won’t be shown again.
          </p>
          <TextField label="Link" value={link?.url ?? ''} readOnly onFocus={(event) => event.target.select()} />
          <Button variant="primary" icon={CopyIcon} onClick={copy}>
            Copy Link
          </Button>
        </div>
      </Drawer>
    </>
  );
}
