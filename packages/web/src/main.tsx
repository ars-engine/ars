import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from './Home';
import { ProfileWorkspace } from './ProfileWorkspace';
import { Shell } from './Shell';
import './styles.css';

const rootRoute = createRootRoute({ component: Shell });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home });
const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: '/p/$profileId/$stage', component: ProfileWorkspace });
const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, profileRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 2000, refetchOnWindowFocus: false, retry: 1 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
