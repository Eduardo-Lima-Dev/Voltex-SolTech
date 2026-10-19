import { ArrowRight, Lock } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@voltex/ui';
import { useAuth, useCurrentUser } from '@/features/auth/auth-provider';
import { PRODUCTS } from '@/features/products/registry';
import { roleLabel } from '@/i18n/labels';

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
    </div>
  );
}
