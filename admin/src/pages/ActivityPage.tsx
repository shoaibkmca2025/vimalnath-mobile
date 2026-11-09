import { BookOpenIcon, CalculatorIcon, ClockCounterClockwiseIcon, GearSixIcon, ImagesIcon, ReceiptIcon, type Icon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, Segmented } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useData } from '@/data/useData';
import type { ActivityArea } from '@/data/types';
import { formatRelativeDay, plural } from '@/lib/format';

type Filter = 'all' | ActivityArea;

const AREAS: Record<ActivityArea, { label: string; icon: Icon }> = {
  orders: { label: 'Orders', icon: ReceiptIcon },
  catalogue: { label: 'Catalogue', icon: BookOpenIcon },
  calculators: { label: 'Calculators', icon: CalculatorIcon },
  content: { label: 'App content', icon: ImagesIcon },
  settings: { label: 'Settings', icon: GearSixIcon },
};

const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });
const PAGE = 60;

export default function ActivityPage() {
  const { db } = useData();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const area = (Object.keys(AREAS) as string[]).includes(params.get('area') ?? '') ? (params.get('area') as ActivityArea) : 'all';

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: db.activity.length };
    for (const entry of db.activity) map[entry.area] = (map[entry.area] ?? 0) + 1;
    return map;
  }, [db.activity]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return db.activity.filter((entry) => (area === 'all' || entry.area === area) && (!needle || `${entry.summary} ${entry.by}`.toLowerCase().includes(needle)));
  }, [db.activity, area, query]);

  // Group the visible entries by calendar day, newest first.
  const days: { label: string; entries: typeof rows }[] = [];
  for (const entry of rows.slice(0, limit)) {
    const label = formatRelativeDay(entry.at);
    const last = days[days.length - 1];
    if (last?.label === label) last.entries.push(entry);
    else days.push({ label, entries: [entry] });
  }

  return (
    <>
      <PageHeader title="Activity" description="Every change made in this admin and every order placed in the app, newest first." />

      <div className="toolbar">
        <Segmented<Filter>
          label="Area"
          value={area}
          onChange={(next) => {
            setLimit(PAGE);
            setParams(next === 'all' ? {} : { area: next }, { replace: true });
          }}
          options={[{ value: 'all', label: 'All', count: counts.all }, ...(Object.keys(AREAS) as ActivityArea[]).map((value) => ({ value, label: AREAS[value].label, count: counts[value] ?? 0 }))]}
        />
        <SearchInput label="Search activity" placeholder="Order number, product or name" value={query} onChange={setQuery} />
      </div>

      {days.length ? (
        <div className="stack-lg">
          {days.map((day, index) => (
            <section key={day.label} aria-labelledby={`day-${index}`}>
              <h2 className="section-title" id={`day-${index}`}>
                {day.label}
              </h2>
              <Card>
                <ol className="list">
                  {day.entries.map((entry) => {
                    const { icon: AreaIcon, label } = AREAS[entry.area];
                    return (
                      <li key={entry.id} className="list-row">
                        <span className="icon-tile" aria-hidden>
                          <AreaIcon size={18} />
                        </span>
                        <span className="list-row__main">
                          {entry.to ? (
                            <Link to={entry.to} className="list-row__title" style={{ color: 'var(--text)', display: 'block' }}>
                              {entry.summary}
                            </Link>
                          ) : (
                            <span className="list-row__title" style={{ display: 'block' }}>
                              {entry.summary}
                            </span>
                          )}
                          <span className="list-row__meta">
                            {entry.by} · {label}
                          </span>
                        </span>
                        <time className="num muted" dateTime={entry.at} style={{ fontSize: 'var(--text-sm)' }}>
                          {time.format(new Date(entry.at))}
                        </time>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </section>
          ))}
          {rows.length > limit && (
            <div className="row" style={{ justifyContent: 'center' }}>
              <Button onClick={() => setLimit((current) => current + PAGE)}>Show {plural(Math.min(PAGE, rows.length - limit), 'more entry', 'more entries')}</Button>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <EmptyState icon={ClockCounterClockwiseIcon} title={db.activity.length ? 'Nothing matches' : 'No activity yet'}>
            {db.activity.length ? 'Try another area or search.' : 'Changes you make in the admin will be listed here.'}
          </EmptyState>
        </Card>
      )}
    </>
  );
}
