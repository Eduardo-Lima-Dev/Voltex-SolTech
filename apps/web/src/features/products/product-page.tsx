import { CheckCircle2, Hammer } from 'lucide-react';
import { Link } from 'react-router';
import type { Product } from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@voltex/ui';
import { productById } from './registry';

/** Tela de cada produto enquanto ele não existe: mostra o que virá e em qual fase. */
export function ProductPage({ id }: { id: Product }) {
  const product = productById(id);
  const phase = product.availability.status === 'soon' ? product.availability.phase : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <product.icon className="size-6" aria-hidden />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          <p className="text-muted-foreground">{product.tagline}</p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Hammer className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle className="text-base">Em desenvolvimento</CardTitle>
            {phase ? <Badge variant="secondary">{phase}</Badge> : null}
          </div>
          <CardDescription>
            Esta área ainda não está disponível. Veja o que vem por aí:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {product.highlights.map((highlight) => (
              <li key={highlight} className="flex items-start gap-2 text-sm">
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-brand-cyan-strong dark:text-brand-cyan"
                  aria-hidden
                />
                {highlight}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Button asChild variant="outline">
        <Link to="/">Voltar ao início</Link>
      </Button>
    </div>
  );
}
