import { Navigate, Outlet } from 'react-router';
import { ForbiddenPage } from '@/app/pages/forbidden-page';
import { useAuth } from '@/features/auth/auth-provider';
import { ENGINE_TABS } from './engine-nav';

/** Casca do Solar Engine Studio: as telas ficam no submenu da barra lateral. */
export function EngineLayout() {
  const { can } = useAuth();
  if (!ENGINE_TABS.some((tab) => can(tab.permission))) return <ForbiddenPage />;
  return <Outlet />;
}

export function EngineIndexRedirect() {
  const { can } = useAuth();
  const first = ENGINE_TABS.find((tab) => can(tab.permission));
  return first ? <Navigate to={`/engine/${first.path}`} replace /> : <ForbiddenPage />;
}
