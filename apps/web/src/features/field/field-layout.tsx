import { CloudOff, RefreshCw, Wifi } from 'lucide-react';
import { Link, Navigate, Outlet } from 'react-router';
import { Badge, Button, Logo } from '@voltex/ui';
import { ForbiddenPage } from '@/app/pages/forbidden-page';
import { FullScreenSpinner } from '@/app/guards';
import { useAuth } from '@/features/auth/auth-provider';
import { formatDateTime } from '@/lib/format';
import { FieldProvider, useField } from './field-provider';

function FieldFrame() {
  const { engine, state } = useField();
  const { status, can } = useAuth();
  if (status === 'authenticated' && !can('ops.field.execute') && !can('ops.workorder.write'))
    return <ForbiddenPage />;

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2">
          <Link to="/campo" aria-label="Voltex SolTech — ordens de campo" className="shrink-0">
            <Logo tone="on-dark" title="Voltex SolTech" className="h-8" />
          </Link>
          <div className="min-w-0 flex-1 text-sm">
            <div className="truncate font-medium">{state.user?.name}</div>
            <div className="flex items-center gap-1 text-xs opacity-80">
              {state.online ? (
                <Wifi className="size-3" aria-hidden="true" />
              ) : (
                <CloudOff className="size-3" aria-hidden="true" />
              )}
              {state.online ? 'Online' : 'Sem internet'}
            </div>
          </div>
          {state.pending > 0 ? (
            <Badge variant="yellow" aria-label={`${state.pending} item(ns) para enviar`}>
              {state.pending} p/ enviar
            </Badge>
          ) : null}
          <Button
            size="icon"
            variant="secondary"
            aria-label="Sincronizar agora"
            disabled={!state.online || state.syncing || state.authNeeded}
            onClick={() => void engine.flush().then(() => engine.refresh())}
          >
            <RefreshCw className={state.syncing ? 'animate-spin' : ''} aria-hidden="true" />
          </Button>
        </div>
      </header>
      {state.authNeeded ? (
        <div
          role="alert"
          className="border-b bg-yellow-50 px-4 py-2 text-sm text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100"
        >
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2">
            <span>
              Sua sessão venceu. O que você fizer fica guardado neste aparelho e só será enviado
              depois que entrar de novo.
            </span>
            <Link to="/login" state={{ from: '/campo' }} className="font-medium underline">
              Entrar
            </Link>
          </div>
        </div>
      ) : state.error ? (
        <div role="status" className="border-b bg-muted px-4 py-2 text-sm text-muted-foreground">
          <div className="mx-auto max-w-2xl">{state.error}</div>
        </div>
      ) : null}
      <main id="conteudo" className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-2xl px-4 pb-6 text-xs text-muted-foreground">
        {state.lastSyncAt
          ? `Atualizado em ${formatDateTime(state.lastSyncAt)}`
          : 'Ainda não atualizado'}
      </footer>
    </div>
  );
}

/** Casca do app de campo: fora do menu da suíte, pensada para o celular e para funcionar sem internet. */
export function FieldLayout() {
  return (
    <FieldProvider
      loading={<FullScreenSpinner />}
      noAccess={<Navigate to="/login" replace state={{ from: '/campo' }} />}
    >
      <FieldFrame />
    </FieldProvider>
  );
}
