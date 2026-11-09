import { ArrowDownIcon, ArrowSquareOutIcon, ArrowUpIcon, CheckCircleIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlayCircleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { SelectField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { useData } from '@/data/useData';
import type { Video, VideoSection } from '@/data/types';
import { useDrawerItem } from '@/hooks/useDrawerItem';
import { plural } from '@/lib/format';

const NEW_SECTION = '__new__';
/** Entries still pointing at a YouTube search instead of Vimalnath's own video. */
const isSearchLink = (url: string) => /youtube\.com\/results/i.test(url);

type Position = { section: number; video: number };
type Draft = Video & { section: string; newSection: string };

function urlError(url: string) {
  if (!url.trim()) return 'Paste the video’s link.';
  try {
    return new URL(url.trim()).protocol === 'https:' ? null : 'Use a secure link that starts with https://.';
  } catch {
    return 'Enter the full link, e.g. https://www.youtube.com/watch?v=…';
  }
}

export default function VideosPage() {
  const { db, update } = useData();
  const toast = useToast();
  const drawer = useDrawerItem<Position | null>();
  const [draft, setDraft] = useState<Draft>({ title: '', detail: '', url: '', section: '0', newSection: '' });
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Position | null>(null);

  const sections = db.videoSections;
  const total = sections.reduce((sum, section) => sum + section.videos.length, 0);
  const searchLinks = sections.reduce((sum, section) => sum + section.videos.filter((video) => isSearchLink(video.url)).length, 0);

  const open = (position: Position | null) => {
    const video = position ? sections[position.section]!.videos[position.video]! : { title: '', detail: '', url: '' };
    setDraft({ ...video, section: String(position?.section ?? 0), newSection: '' });
    setTouched(new Set());
    drawer.show(position);
  };

  const editing = drawer.item;
  const errors: Record<string, string | null> = {
    title: draft.title.trim() ? null : 'Enter the video’s title.',
    url: urlError(draft.url),
    newSection: draft.section === NEW_SECTION && !draft.newSection.trim() ? 'Name the new section.' : null,
  };
  const shown = (key: string) => (touched.has(key) ? errors[key] : null);
  const touch = (key: string) => () => setTouched((current) => new Set(current).add(key));
  const originalVideo = editing ? sections[editing.section]?.videos[editing.video] : undefined;
  const dirty = editing
    ? JSON.stringify({ title: draft.title, detail: draft.detail, url: draft.url, section: draft.section }) !== JSON.stringify({ ...originalVideo, section: String(editing.section) })
    : Boolean(draft.title || draft.url || draft.detail);

  const save = () => {
    setTouched(new Set(Object.keys(errors)));
    if (Object.values(errors).some(Boolean)) return;
    const video: Video = { title: draft.title.trim(), detail: draft.detail.trim(), url: draft.url.trim() };
    update('videoSections', (current) => {
      let next: VideoSection[] = current.map((section) => ({ ...section, videos: [...section.videos] }));
      if (editing) next[editing.section]!.videos.splice(editing.video, 1);
      if (draft.section === NEW_SECTION) next.push({ title: draft.newSection.trim(), videos: [video] });
      else if (editing && Number(draft.section) === editing.section) next[editing.section]!.videos.splice(editing.video, 0, video);
      else next[Number(draft.section)]!.videos.push(video);
      next = next.filter((section) => section.videos.length);
      return next;
    }, { area: 'content', summary: editing ? `Edited the video “${video.title}”` : `Added the video “${video.title}”`, to: '/videos' });
    drawer.close();
    toast({ message: editing ? `${video.title} saved.` : `${video.title} added to Installation Videos.` });
  };

  const move = (position: Position, direction: -1 | 1) => {
    update('videoSections', (current) =>
      current.map((section, index) => {
        if (index !== position.section) return section;
        const videos = [...section.videos];
        const target = position.video + direction;
        [videos[position.video], videos[target]] = [videos[target]!, videos[position.video]!];
        return { ...section, videos };
      }),
      { area: 'content', summary: `Moved the video “${sections[position.section]!.videos[position.video]!.title}” ${direction < 0 ? 'up' : 'down'}`, to: '/videos' },
    );
  };

  const remove = (position: Position) => {
    const previous = sections;
    const video = sections[position.section]!.videos[position.video]!;
    update('videoSections', (current) =>
      current
        .map((section, index) => (index === position.section ? { ...section, videos: section.videos.filter((_, i) => i !== position.video) } : section))
        .filter((section) => section.videos.length),
      { area: 'content', summary: `Deleted the video “${video.title}”`, to: '/videos' },
    );
    toast({ message: `${video.title} deleted.`, action: { label: 'Undo', onAction: () => update('videoSections', () => previous, { area: 'content', summary: `Restored the video “${video.title}”`, to: '/videos' }) } });
  };

  return (
    <>
      <PageHeader
        title="Installation Videos"
        description={`The how-to videos under Menu › Installation Videos in the app. ${plural(total, 'video')} in ${plural(sections.length, 'section')}.`}
        actions={
          <Button variant="primary" icon={PlusIcon} onClick={() => open(null)}>
            New Video
          </Button>
        }
      />

      {searchLinks > 0 && (
        <p className="notice notice--warning" style={{ marginBottom: 'var(--space-5)' }}>
          <MagnifyingGlassIcon size={16} weight="bold" aria-hidden />
          <span>
            {plural(searchLinks, 'video')} still open a YouTube search rather than a Vimalnath video. Edit each one and paste its video link.
          </span>
        </p>
      )}

      {sections.length === 0 ? (
        <Card>
          <EmptyState icon={PlayCircleIcon} title="No videos yet" action={<Button variant="primary" onClick={() => open(null)}>New Video</Button>}>
            Add installation videos so fabricators can follow along on site.
          </EmptyState>
        </Card>
      ) : (
        <div className="stack-lg">
          {sections.map((section, sectionIndex) => (
            <Card key={section.title} aria-labelledby={`videos-${sectionIndex}`}>
              <CardHeader id={`videos-${sectionIndex}`} title={section.title} description={plural(section.videos.length, 'video')} />
              <ul className="list">
                {section.videos.map((video, videoIndex) => {
                  const position = { section: sectionIndex, video: videoIndex };
                  return (
                    <li key={`${video.title}-${videoIndex}`} className="list-row">
                      <PlayCircleIcon size={28} weight="fill" color="#ff3b30" aria-hidden style={{ flexShrink: 0 }} />
                      <div className="list-row__main">
                        <p className="list-row__title">{video.title}</p>
                        <p className="list-row__meta">{video.detail}</p>
                      </div>
                      {isSearchLink(video.url) ? (
                        <Badge tone="warning" icon={MagnifyingGlassIcon}>
                          Needs a video link
                        </Badge>
                      ) : (
                        <Badge tone="success" icon={CheckCircleIcon}>
                          Video linked
                        </Badge>
                      )}
                      <span className="row" style={{ gap: 0 }}>
                        <a className="icon-btn" href={video.url} target="_blank" rel="noreferrer" aria-label={`Open ${video.title} in a new tab`} title="Open link">
                          <ArrowSquareOutIcon size={18} aria-hidden />
                        </a>
                        <IconButton icon={ArrowUpIcon} label={`Move ${video.title} up`} disabled={videoIndex === 0} onClick={() => move(position, -1)} />
                        <IconButton icon={ArrowDownIcon} label={`Move ${video.title} down`} disabled={videoIndex === section.videos.length - 1} onClick={() => move(position, 1)} />
                        <IconButton icon={PencilSimpleIcon} label={`Edit ${video.title}`} onClick={() => open(position)} />
                        <IconButton icon={TrashIcon} tone="danger" label={`Delete ${video.title}`} onClick={() => setDeleting(position)} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={drawer.open}
        onClose={drawer.close}
        onSubmit={save}
        dirty={dirty}
        title={editing ? 'Edit video' : 'New video'}
        description={editing ? originalVideo?.title : 'Add a how-to video to the app.'}
        footer={
          <>
            <Button onClick={drawer.close}>Cancel</Button>
            <Button type="submit" variant="primary">
              {editing ? 'Save' : 'Add Video'}
            </Button>
          </>
        }
      >
        <div className="stack-lg">
          <TextField
            label="Video link"
            required
            type="url"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={draft.url}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            onBlur={touch('url')}
            error={shown('url')}
            hint="Opens in the YouTube app on people’s phones."
            data-autofocus
          />
          <TextField label="Title" required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} onBlur={touch('title')} error={shown('title')} />
          <TextField label="Description" value={draft.detail} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} hint="One line under the title, e.g. what the video covers." />
          <SelectField
            label="Section"
            value={draft.section}
            onChange={(event) => setDraft({ ...draft, section: event.target.value })}
            options={[...sections.map((section, index) => ({ value: String(index), label: section.title })), { value: NEW_SECTION, label: 'New section…' }]}
          />
          {draft.section === NEW_SECTION && (
            <TextField label="New section name" required value={draft.newSection} onChange={(event) => setDraft({ ...draft, newSection: event.target.value })} onBlur={touch('newSection')} error={shown('newSection')} placeholder="e.g. Wardrobe systems" />
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting ? sections[deleting.section]?.videos[deleting.video]?.title : 'video'}?`}
        body="It will no longer appear under Installation Videos in the app."
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
