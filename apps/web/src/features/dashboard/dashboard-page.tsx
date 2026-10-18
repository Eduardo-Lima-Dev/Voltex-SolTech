import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Lock } from 'lucide-react';
import { Link } from 'react-router';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@voltex/ui';
import { useAuth, useCurrentUser } from '@/features/auth/auth-provider';
import { PRODUCTS } from '@/features/products/registry';
import { roleLabel } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';

const CHECK_LABELS: Record<string, string> = {
  database: 'Banco de dados',
  redis: 'Filas (Redis)',
  storage: 'Armazenamento',
};

function SystemStatus() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: endpoints.health,
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Status dos serviços</CardTitle>
        <CardDescription>Visível para quem administra a empresa.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive">Não foi possível consultar o status.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-3">
            {Object.entries(data.checks).map(([name, check]) => (
              <li
                key={name}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>{CHECK_LABELS[name] ?? name}</span>
                <Badge variant={check.status === 'up' ? 'green' : 'red'}>
                  {check.status === 'up' ? 'Operando' : 'Falhou'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const user = useCurrentUser();
  const { can } = useAuth();
  const firstName = user.name.split(' ')[0];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {firstName}</h1>
        <p className="text-muted-foreground">
          {user.tenantName} · {roleLabel(user.role)}
        </p>
      </header>

      <section aria-labelledby="produtos" className="space-y-4">
        <h2 id="produtos" className="text-lg font-medium">
          Produtos da suíte
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {PRODUCTS.map((product) => {
            const allowed = can(product.permission);
            const soon = product.availability.status === 'soon';
            const body = (
              <Card
                className={
                  allowed ? 'h-full transition-shadow hover:shadow-md' : 'h-full opacity-60'
                }
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <product.icon className="size-5" aria-hidden />
                    </span>
                    {allowed ? (
                      soon ? (
                        <Badge variant="secondary">
                          Em breve ·{' '}
                          {product.availability.status === 'soon' ? product.availability.phase : ''}
                        </Badge>
                      ) : (
                        <Badge variant="green">Disponível</Badge>
                      )
                    ) : (
                      <Badge variant="outline">
                        <Lock /> Sem acesso
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="pt-2 text-base">{product.name}</CardTitle>
                  <CardDescription>{product.tagline}</CardDescription>
                </CardHeader>
                {allowed ? (
                  <CardContent className="mt-auto flex items-center gap-1 text-sm font-medium text-brand-cyan-strong dark:text-brand-cyan">
                    Abrir <ArrowRight className="size-4" aria-hidden />
                  </CardContent>
                ) : null}
              </Card>
            );
            return allowed ? (
              <Link
                key={product.id}
                to={product.path}
                className="rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {body}
              </Link>
            ) : (
              <div key={product.id} aria-disabled>
                {body}
              </div>
            );
          })}
        </div>
      </section>

      {can('platform.tenant.manage') ? <SystemStatus /> : null}
    </div>
  );
}
