import { useLayoutEffect, type ReactNode } from 'react';

import { useSetPageMeta, type Crumb } from '@/components/pageMeta';

type Props = {
  title: string;
  description?: ReactNode;
  /** Parent pages, shown in the top bar's breadcrumbs before this page's title. */
  crumbs?: Crumb[];
  actions?: ReactNode;
};

/** The page's one h1, its purpose in a sentence, and its primary actions. */
export function PageHeader({ title, description, crumbs = [], actions }: Props) {
  const setMeta = useSetPageMeta();
  const crumbKey = JSON.stringify(crumbs);

  useLayoutEffect(() => {
    setMeta({ title, crumbs: JSON.parse(crumbKey) as Crumb[] });
    document.title = `${title} · Vimalnath Admin`;
  }, [setMeta, title, crumbKey]);

  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1>{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
