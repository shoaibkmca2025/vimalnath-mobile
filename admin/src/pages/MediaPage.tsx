import { BroomIcon, FilePdfIcon, FolderSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Thumb } from '@/components/Thumb';
import { useToast } from '@/components/useToast';
import { readSession } from '@/data/session';
import { api } from '@/lib/api';
import { formatDateTime, plural } from '@/lib/format';

type MediaFile = {
  id: string;
  kind: 'image' | 'pdf';
  name: string;
  bytes: number;
  width: number | null;
  height: number | null;
  uploadedAt: string;
  uploadedBy: string;
  url: string;
  usedBy: { label: string; to: string }[];
};

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Modules 5.4 and 5.5: every photo and PDF uploaded, where each is used, and a way to remove the ones nothing uses. */
export default function MediaPage() {
  const toast = useToast();
  const owner = readSession()?.role === 'owner';
  const [files, setFiles] = useState<MediaFile[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<'all' | 'unused'>('all');
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<MediaFile | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const load = useCallback(
    () =>
      api<MediaFile[]>('/media').then(
        (list) => {
          setFiles(list);
          setFailure(null);
        },
        (error: unknown) => setFailure(error instanceof Error ? error.message : 'Something went wrong.'),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (files ?? []).filter((file) => (view === 'all' || !file.usedBy.length) && (!needle || `${file.name} ${file.usedBy.map((use) => use.label).join(' ')}`.toLowerCase().includes(needle)));
  }, [files, view, query]);
  const unused = (files ?? []).filter((file) => !file.usedBy.length);

  const remove = async (file: MediaFile) => {
    setDeleting(null);
    try {
      await api(`/media/${file.id}`, 'DELETE');
      toast({ message: `${file.name} deleted.` });
    } catch (error) {
      toast({ tone: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
    }
    await load();
  };

  const cleanup = async () => {
    setCleaning(false);
    try {
      const { removed } = await api<{ removed: number }>('/media/cleanup', 'POST');
      toast({ message: removed ? `${plural(removed, 'unused file')} removed.` : 'Nothing to remove.' });
    } catch (error) {
      toast({ tone: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
    }
    await load();
  };

  return (
    <>
      <PageHeader
        title="Media Library"
        description={files ? `Every photo and PDF uploaded to this admin: ${plural(files.length, 'file')}, ${unused.length} not used anywhere.` : 'Every photo and PDF uploaded to this admin.'}
        actions={
          owner && (
            <Button icon={BroomIcon} disabled={!unused.length} onClick={() => setCleaning(true)}>
              Remove Unused Files
            </Button>
          )
        }
      />

      <div className="toolbar">
        <SearchInput label="Search files" placeholder="File name or where it’s used" value={query} onChange={setQuery} />
        <Segmented<'all' | 'unused'>
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unused', label: `Not used (${unused.length})` },
          ]}
        />
      </div>

      <Card>
        {failure ? (
          <p className="card__body notice notice--warning" role="alert">
            {failure}
          </p>
        ) : files && !shown.length ? (
          <EmptyState icon={FolderSimpleIcon} title={files.length ? 'Nothing matches' : 'No uploads yet'}>
            {files.length ? 'Try another search, or show all files.' : 'Photos and PDFs added on any page appear here.'}
          </EmptyState>
        ) : (
          <ul className="list">
            {shown.map((file) => (
              <li key={file.id} className="list-row">
                {file.kind === 'pdf' ? (
                  <span className="thumb thumb--empty" aria-hidden>
                    <FilePdfIcon size={20} />
                  </span>
                ) : (
                  <Thumb src={file.url} fit="cover" />
                )}
                <div className="list-row__main">
                  <a className="list-row__title" href={file.url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                    {file.name}
                  </a>
                  <p className="list-row__meta" style={{ display: 'block' }}>
                    {[size(file.bytes), file.width && file.height ? `${file.width}×${file.height}` : '', `${formatDateTime(file.uploadedAt)}${file.uploadedBy ? ` by ${file.uploadedBy}` : ''}`].filter(Boolean).join(' · ')}
                  </p>
                  {file.usedBy.length > 0 && (
                    <p className="list-row__meta" style={{ display: 'block' }}>
                      Used by{' '}
                      {file.usedBy.map((use, index) => (
                        <span key={`${use.label}-${index}`}>
                          {index > 0 && ', '}
                          <Link to={use.to}>{use.label}</Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                {!file.usedBy.length && <Badge tone="neutral">Not used</Badge>}
                <IconButton icon={TrashIcon} tone="danger" label={`Delete ${file.name}`} disabled={file.usedBy.length > 0} onClick={() => setDeleting(file)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name ?? 'this file'}?`}
        body="Nothing uses it now. Once deleted it can’t be brought back."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
      />
      <ConfirmDialog
        open={cleaning}
        title="Remove unused files?"
        body="Files nothing uses, uploaded more than a day ago. Newer ones stay, in case they belong to a form that isn’t saved yet. Removed files can’t be brought back."
        confirmLabel="Remove"
        destructive
        onCancel={() => setCleaning(false)}
        onConfirm={cleanup}
      />
    </>
  );
}
