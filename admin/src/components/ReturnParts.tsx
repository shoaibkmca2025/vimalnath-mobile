import { CheckIcon, FilePdfIcon, PaperclipIcon, XIcon } from '@phosphor-icons/react';
import { useRef, useState } from 'react';

import { Badge } from '@/components/Badge';
import { useToast } from '@/components/useToast';
import { RETURN_STATUS, SUPPLIER_RETURN_STATUS } from '@/data/returns';
import type { ReturnStatus, SupplierReturnStatus } from '@/data/types';
import { sized, upload } from '@/lib/upload';

export function ReturnStatusBadge({ status }: { status: ReturnStatus }) {
  return <Badge tone={RETURN_STATUS[status].tone}>{RETURN_STATUS[status].label}</Badge>;
}

export function SupplierReturnStatusBadge({ status }: { status: SupplierReturnStatus }) {
  return <Badge tone={SUPPLIER_RETURN_STATUS[status].tone}>{SUPPLIER_RETURN_STATUS[status].label}</Badge>;
}

/**
 * Where a return is on its way: done steps ticked, the current one marked, the rest still to come. A return that stopped
 * (rejected or cancelled) shows the step it stopped at.
 */
export function Steps<S extends string>({ steps, labels, current, stopped }: { steps: S[]; labels: Record<S, { label: string }>; current: S; stopped?: { label: string } }) {
  const at = steps.indexOf(current);
  return (
    <ol className="steps" aria-label="Progress">
      {steps.map((step, index) => {
        const state = stopped ? (index < Math.max(at, 1) ? 'done' : 'todo') : index < at || (index === at && index === steps.length - 1) ? 'done' : index === at ? 'current' : 'todo';
        return (
          <li key={step} className="steps__item" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="steps__mark" aria-hidden>
              {state === 'done' ? <CheckIcon size={12} weight="bold" /> : index + 1}
            </span>
            <span className="steps__label">{labels[step].label}</span>
          </li>
        );
      })}
      {stopped && (
        <li className="steps__item" data-state="stopped">
          <span className="steps__mark" aria-hidden>
            <XIcon size={12} weight="bold" />
          </span>
          <span className="steps__label">{stopped.label}</span>
        </li>
      )}
    </ol>
  );
}

/** Photos and PDFs attached to a return: thumbnails that open the file. */
export function AttachmentList({ files, onRemove }: { files: string[]; onRemove?: (url: string) => void }) {
  if (!files.length) return null;
  return (
    <ul className="attachments">
      {files.map((url, index) => (
        <li key={url} className="attachments__item">
          <a href={url} target="_blank" rel="noreferrer" aria-label={`Open attachment ${index + 1}`}>
            {url.endsWith('.pdf') ? (
              <span className="attachments__pdf">
                <FilePdfIcon size={28} aria-hidden />
                PDF
              </span>
            ) : (
              <img src={sized(url, 'sm')} alt="" loading="lazy" />
            )}
          </a>
          {onRemove && (
            <button type="button" className="attachments__remove" aria-label={`Remove attachment ${index + 1}`} onClick={() => onRemove(url)}>
              <XIcon size={12} weight="bold" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Uploads one or more photos or PDFs and hands back their addresses. */
export function AttachButton({ onAdd, label = 'Attach Photos or PDFs', disabled }: { onAdd: (urls: string[]) => void; label?: string; disabled?: boolean }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    const urls: string[] = [];
    try {
      for (const [index, file] of [...files].entries()) {
        urls.push(await upload(file, (share) => setProgress((index + share) / files.length)));
      }
    } catch (problem) {
      toast({ tone: 'error', message: problem instanceof Error ? problem.message : 'Couldn’t upload it.' });
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
    if (urls.length) onAdd(urls);
  };
  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden onChange={(event) => void pick(event.target.files)} />
      <button type="button" className="btn btn--secondary btn--sm" disabled={disabled || progress !== null} onClick={() => input.current?.click()}>
        <PaperclipIcon size={16} aria-hidden />
        {progress === null ? label : `Uploading… ${Math.round(progress * 100)}%`}
      </button>
    </>
  );
}
