import { TriangleAlert } from 'lucide-react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button } from '@voltex/ui';

/** Rede de segurança: qualquer erro inesperado de renderização cai aqui em vez de uma tela branca. */
export function RouteErrorPage() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : undefined;
  return (
    <div
      className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 px-4 text-center"
      role="alert"
    >
      <TriangleAlert className="size-12 text-warning" aria-hidden />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Algo deu errado</h1>
        <p className="max-w-md text-muted-foreground">
          {status === 404
            ? 'Esta página não existe.'
            : 'Ocorreu um erro inesperado ao mostrar esta tela. Tente recarregar a página.'}
        </p>
      </div>
      <Button onClick={() => window.location.reload()}>Recarregar</Button>
    </div>
  );
}
