import { IconContext } from '@phosphor-icons/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { ToastProvider } from '@/components/Toast';
import { applyTheme, readTheme } from '@/lib/theme';
import { router } from '@/router';

import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/components.css';
import '@/styles/details.css';

applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconContext.Provider value={{ size: 18, weight: 'regular', mirrored: false }}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </IconContext.Provider>
  </StrictMode>,
);
