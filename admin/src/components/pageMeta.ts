import { createContext, useContext } from 'react';

export type Crumb = { label: string; to?: string };
export type PageMeta = { title: string; crumbs: Crumb[] };

/** Lets each page's header tell the shell what to show in the breadcrumbs and the tab title. */
export const PageMetaContext = createContext<(meta: PageMeta) => void>(() => {});

export const useSetPageMeta = () => useContext(PageMetaContext);
