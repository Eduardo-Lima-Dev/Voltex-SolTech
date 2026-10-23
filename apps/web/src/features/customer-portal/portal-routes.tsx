import { RouteObject } from 'react-router-dom';
import { PortalLogin } from './portal-login';
import { PortalAccess } from './portal-access';
import { PortalDashboard } from './portal-dashboard';

export const PORTAL_ROUTES: RouteObject[] = [
  {
    path: '/portal',
    children: [
      {
        path: 'entrar',
        element: <PortalLogin />,
      },
      {
        path: 'acesso/:token',
        element: <PortalAccess />,
      },
      {
        path: 'dashboard',
        element: <PortalDashboard />,
      },
      {
        index: true,
        element: <PortalLogin />,
      },
    ],
  },
];
