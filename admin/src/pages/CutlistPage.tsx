import { InfoIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { Drawer } from '@/components/Drawer';
import { Segmented, TextField } from '@/components/Field';
import { ImagePicker } from '@/components/ImagePicker';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { useData } from '@/data/useData';
import type { Configuration, CutlistSystem, CutlistSystemId } from '@/data/types';
import { useDrawerItem } from '@/hooks/useDrawerItem';
import { plural } from '@/lib/format';

const pad = (n: number) => String(n).padStart(2, '0');

export default function CutlistPage() {
  const { db, update } = useData();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const systemId = (db.cutlist.systems.some((system) => system.id === params.get('system')) ? params.get('system') : 'telescopic') as CutlistSystemId;
  const system = db.cutlist.systems.find((item) => item.id === systemId)!;
  const configurations = db.cutlist.configurations[systemId] ?? [];

  const configDrawer = useDrawerItem<number>();
  const [configDraft, setConfigDraft] = useState<Configuration | null>(null);
  const systemDrawer = useDrawerItem<CutlistSystem>();
  const [systemDraft, setSystemDraft] = useState<CutlistSystem | null>(null);
  const [touched, setTouched] = useState(false);

  const editConfig = (index: number) => {
    setConfigDraft(configurations[index]!);
    setTouched(false);
    configDrawer.show(index);
  };

  const editSystem = () => {
    setSystemDraft(system);
    setTouched(false);
    systemDrawer.show(system);
  };

  const configError = configDraft && !configDraft.name.trim() ? 'Enter the configuration’s name, e.g. 2+1 Sliding System.' : null;
  const systemError = systemDraft && !systemDraft.name.trim() ? 'Enter the system’s name.' : null;

  const saveConfig = () => {
    setTouched(true);
    if (!configDraft || configError || configDrawer.item === null) return;
    const index = configDrawer.item;
    const saved = { ...configDraft, name: configDraft.name.trim() };
    update('cutlist', (cutlist) => ({
      ...cutlist,
      configurations: { ...cutlist.configurations, [systemId]: cutlist.configurations[systemId].map((item, i) => (i === index ? saved : item)) },
    }), { area: 'calculators', summary: `Edited the ${saved.name} configuration`, to: `/cutlist?system=${systemId}` });
    configDrawer.close();
    toast({ message: `${saved.name} saved.` });
  };

  const saveSystem = () => {
    setTouched(true);
    if (!systemDraft || systemError) return;
    const saved = { ...systemDraft, name: systemDraft.name.trim(), subtitle: systemDraft.subtitle.trim() };
    update('cutlist', (cutlist) => ({ ...cutlist, systems: cutlist.systems.map((item) => (item.id === saved.id ? saved : item)) }), {
      area: 'calculators',
      summary: `Edited the ${saved.name} system card`,
      to: `/cutlist?system=${saved.id}`,
    });
    systemDrawer.close();
    toast({ message: `${saved.name} saved.` });
  };

  return (
    <>
      <PageHeader title="Cutlist Systems" description="The sliding systems in the app’s Cutlist tab and the configurations people pick before calculating glass sizes." />

      <div className="toolbar">
        <Segmented<CutlistSystemId>
          label="System"
          value={systemId}
          onChange={(next) => setParams({ system: next }, { replace: true })}
          options={db.cutlist.systems.map((item) => ({ value: item.id, label: item.name, count: db.cutlist.configurations[item.id]?.length ?? 0 }))}
        />
      </div>

      <div className="stack-lg">
        <Card aria-labelledby="system-title">
          <CardHeader
            id="system-title"
            title={system.name}
            description={system.subtitle}
            action={
              <Button size="sm" icon={PencilSimpleIcon} onClick={editSystem}>
                Edit System
              </Button>
            }
          />
          <div className="card__body split">
            {system.photo && <img src={system.photo} alt={`${system.name} cover photo`} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 'var(--radius-md)' }} />}
            <p className="notice">
              <InfoIcon size={16} weight="bold" aria-hidden />
              <span>
                Each configuration’s glass sizes come from its formula in the app, matched by the panel count in its name (for example 2+1). Rename one only if
                the panel count stays the same.
              </span>
            </p>
          </div>
        </Card>

        <section aria-labelledby="configs-title">
          <h2 id="configs-title" style={{ marginBottom: 'var(--space-3)' }}>
            {plural(configurations.length, 'configuration')}
          </h2>
          <div className="media-grid">
            {configurations.map((configuration, index) => (
              <button key={`${configuration.name}-${index}`} type="button" className="media-card" onClick={() => editConfig(index)} aria-label={`Edit ${configuration.name}`}>
                <img className="media-card__image" src={configuration.image} alt="" loading="lazy" width={300} height={300} />
                <span className="media-card__body">
                  <span style={{ fontWeight: 600 }}>{configuration.name}</span>
                  <span className="cell-sub">Configuration {pad(index + 1)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <Drawer
        open={configDrawer.open}
        onClose={configDrawer.close}
        onSubmit={saveConfig}
        dirty={Boolean(configDraft && configDrawer.item !== null && JSON.stringify(configDraft) !== JSON.stringify(configurations[configDrawer.item]))}
        title="Edit configuration"
        description={`${system.name} · configuration ${pad((configDrawer.item ?? 0) + 1)}`}
        footer={
          <>
            <Button onClick={configDrawer.close}>Cancel</Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </>
        }
      >
        {configDraft && (
          <div className="stack-lg">
            <TextField label="Name" required value={configDraft.name} onChange={(event) => setConfigDraft({ ...configDraft, name: event.target.value })} onBlur={() => setTouched(true)} error={touched ? configError : null} data-autofocus />
            <ImagePicker label="Diagram" value={configDraft.image} allowRemove={false} onChange={(image) => image && setConfigDraft({ ...configDraft, image })} hint="A square diagram of the panels. JPG, PNG or WebP, up to 500 KB." />
          </div>
        )}
      </Drawer>

      <Drawer
        open={systemDrawer.open}
        onClose={systemDrawer.close}
        onSubmit={saveSystem}
        dirty={Boolean(systemDraft && systemDrawer.item && JSON.stringify(systemDraft) !== JSON.stringify(systemDrawer.item))}
        title="Edit system"
        description={systemDrawer.item?.name}
        footer={
          <>
            <Button onClick={systemDrawer.close}>Cancel</Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </>
        }
      >
        {systemDraft && (
          <div className="stack-lg">
            <TextField label="Name" required value={systemDraft.name} onChange={(event) => setSystemDraft({ ...systemDraft, name: event.target.value })} onBlur={() => setTouched(true)} error={touched ? systemError : null} data-autofocus />
            <TextField label="Subtitle" value={systemDraft.subtitle} onChange={(event) => setSystemDraft({ ...systemDraft, subtitle: event.target.value })} hint="One line under the name on the Cutlist card." />
            <ImagePicker label="Cover photo" shape="wide" value={systemDraft.photo} onChange={(photo) => setSystemDraft({ ...systemDraft, photo })} hint="A room photo showing the whole system, 4:3. Up to 500 KB." />
          </div>
        )}
      </Drawer>
    </>
  );
}
