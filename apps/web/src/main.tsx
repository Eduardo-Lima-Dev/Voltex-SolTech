import '@fontsource-variable/inter';
import './index.css';
import './lib/zod-locale';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from './app/providers';
import { createAppRouter } from './app/router';
import { api } from './lib/api';
import { endpoints } from './lib/api/endpoints';
import { createQueryClient } from './lib/query-client';

const queryClient = createQueryClient();
const router = createAppRouter();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AppProviders queryClient={queryClient} client={api} endpoints={endpoints}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
