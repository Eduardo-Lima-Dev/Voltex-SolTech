import { Navigate, Outlet } from 'react-router';
import { ForbiddenPage } from '@/app/pages/forbidden-page';
import { useAuth } from '@/features/auth/auth-provider';
import { OPERATIONS_TABS } from './operations-nav';

/** Casca da Operação: as telas ficam no submenu da barra lateral. */
export function OperationsLayout() {
  const { can } = useAuth();
  if (!OPERATIONS_TABS.some((tab) => can(tab.permission))) return <ForbiddenPage />;
  return <Outlet />;
}

export function OperationsIndexRedirect() {
  const { can } = useAuth();
  const first = OPERATIONS_TABS.find((tab) => can(tab.permission));
  return first ? <Navigate to={`/operations/${first.path}`} replace /> : <ForbiddenPage />;
}
