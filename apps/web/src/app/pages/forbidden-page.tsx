import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@voltex/ui';

export function ForbiddenPage() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 px-4 text-center">
      <ShieldAlert className="size-12 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Sem acesso a esta área</h1>
        <p className="max-w-md text-muted-foreground">
          Seu perfil não tem permissão para ver esta página. Se você acha que deveria ter, fale com
          o administrador da sua empresa.
        </p>
      </div>
      <Button asChild>
        <Link to="/">Voltar ao início</Link>
      </Button>
    </div>
  );
}
