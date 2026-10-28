import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
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
import type { PortalMilestoneDto } from '@voltex/shared';
import { endpoints } from '@/lib/api/endpoints';
import { formatDate, formatDateTime } from '@/lib/format';

export function Milestones({ items }: { items: PortalMilestoneDto[] }) {
  return (
    <ol className="space-y-2" aria-label="Etapas do projeto">
      {items.map((m) => (
        <li key={m.key} className="flex items-start gap-2 text-sm">
          {m.done ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-label="Concluída" />
          ) : (
            <Circle
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-label="Pendente"
            />
          )}
          <span className={m.done ? '' : 'text-muted-foreground'}>
            {m.label}
            {m.date ? <span className="text-muted-foreground"> · {formatDate(m.date)}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Lista de projetos do cliente, cada um com a situação e as etapas. */
export function PortalHomePage() {
  const projects = useQuery({
    queryKey: ['portal', 'projects'],
    queryFn: endpoints.portal.projects,
  });
  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Meus projetos</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe cada etapa do seu sistema de energia solar.
        </p>
      </header>
      {projects.isPending ? <Skeleton className="h-48 w-full" /> : null}
      {projects.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os seus projetos.
        </p>
      ) : null}
      {projects.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">Você ainda não tem projetos neste portal.</p>
      ) : null}
      {projects.data?.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Link to={`/portal/projetos/${p.id}`} className="hover:underline">
                {p.title}
              </Link>
              <Badge variant="secondary">{p.statusLabel}</Badge>
            </CardTitle>
            <CardDescription className="font-mono">{p.projectCode}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {p.nextVisit?.start ? (
              <p className="text-sm">
                Próxima atividade: <strong>{p.nextVisit.title}</strong>, em{' '}
                {formatDateTime(p.nextVisit.start)}.
              </p>
            ) : null}
            <Milestones items={p.milestones} />
          </CardContent>
        </Card>
      ))}
    </>
  );
}
