import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  toast,
} from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const STATUS: Record<string, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em atendimento',
  WAITING_CUSTOMER: 'Aguardando você',
  RESOLVED: 'Resolvido',
  CLOSED: 'Encerrado',
};

export function PortalTicketPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const query = useQuery({
    queryKey: ['portal', 'ticket', id],
    queryFn: () => endpoints.portal.ticket(id),
  });
  const send = useMutation({
    mutationFn: () => endpoints.portal.comment(id, { body: body.trim() }),
    onSuccess: async () => {
      setBody('');
      await queryClient.invalidateQueries({ queryKey: ['portal', 'ticket', id] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível enviar a mensagem.')),
  });
  if (query.isPending) return <Skeleton className="h-48 w-full" />;
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível carregar este chamado.
      </p>
    );
  const t = query.data;
  return (
    <>
      <header className="space-y-1">
        <Link to="/portal" className="text-sm text-muted-foreground hover:text-foreground">
          ← Meus projetos
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t.code} · {t.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          <Badge variant="secondary">{STATUS[t.status] ?? t.status}</Badge> · aberto em{' '}
          {formatDateTime(t.createdAt)}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Conversa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {t.description ? <p className="whitespace-pre-wrap text-sm">{t.description}</p> : null}
          {t.resolution ? (
            <p className="rounded-md border p-3 text-sm">
              <strong>Solução:</strong> {t.resolution}
            </p>
          ) : null}
          <ul className="space-y-3" aria-label="Mensagens">
            {t.comments.map((c) => (
              <li
                key={c.id}
                className={`rounded-md border p-3 text-sm ${c.fromYou ? 'bg-muted/50' : ''}`}
              >
                <p className="mb-1 text-xs text-muted-foreground">
                  {c.fromYou ? 'Você' : c.authorName} · {formatDateTime(c.createdAt)}
                </p>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
          {t.status !== 'CLOSED' ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                send.mutate();
              }}
            >
              <textarea
                aria-label="Sua mensagem"
                className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <Button type="submit" disabled={send.isPending || !body.trim()}>
                Enviar mensagem
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Este chamado foi encerrado.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
