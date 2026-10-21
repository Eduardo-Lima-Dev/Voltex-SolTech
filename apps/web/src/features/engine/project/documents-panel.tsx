import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ProjectDocumentItemDto } from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

const STATUS_LABEL = {
  PENDING: 'Pendente',
  READY: 'Pronto',
  NOT_APPLICABLE: 'Não se aplica',
} as const;
const STATUS_BADGE = { PENDING: 'yellow', READY: 'green', NOT_APPLICABLE: 'outline' } as const;

/** Pacote de documentos da solicitação de acesso (EnergIF EF-R04): o que já está pronto e o que falta. */
export function DocumentsPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<{
    item: ProjectDocumentItemDto;
    status: 'READY' | 'NOT_APPLICABLE' | 'PENDING';
  } | null>(null);
  const [note, setNote] = useState('');
  const items = useQuery({
    queryKey: ['engineering', 'documents', projectId],
    queryFn: () => endpoints.engineering.documentItems(projectId),
  });
  const update = useMutation({
    mutationFn: () =>
      endpoints.engineering.updateDocumentItem(
        projectId,
        (target as NonNullable<typeof target>).item.code,
        { status: target!.status, note: note.trim() || null },
      ),
    onSuccess: async () => {
      setTarget(null);
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['engineering', 'documents', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['engineering', 'timeline', projectId] });
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível atualizar o item.')),
  });
  if (items.isPending) return <Skeleton className="h-48 w-full" />;
  if (items.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar o pacote.</p>;
  const required = items.data.filter((i) => i.required && i.status !== 'NOT_APPLICABLE');
  const ready = required.filter((i) => i.status === 'READY').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documentos da solicitação de acesso</CardTitle>
        <CardDescription>
          {ready} de {required.length} obrigatórios prontos. A lista vem da distribuidora do projeto
          (ou do padrão da empresa) e de uma base de 2023: confirme com a concessionária.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y" aria-label="Pacote de documentos">
          {items.data.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"
            >
              <div className="space-y-1">
                <p className="font-medium">
                  {item.title}{' '}
                  {item.required ? (
                    <span className="text-xs font-normal text-muted-foreground">(obrigatório)</span>
                  ) : null}
                </p>
                {item.suggestion ? (
                  <p className="text-xs text-muted-foreground">{item.suggestion}</p>
                ) : null}
                {item.note ? <p className="text-xs">Obs.: {item.note}</p> : null}
                <p className="text-xs text-muted-foreground">Fonte: {item.source}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_BADGE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                {canEdit ? (
                  <Can permission="engine.project.write">
                    {item.status !== 'READY' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTarget({ item, status: 'READY' });
                          setNote(item.note ?? '');
                        }}
                      >
                        Marcar pronto
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setTarget({ item, status: 'PENDING' });
                          setNote(item.note ?? '');
                        }}
                      >
                        Reabrir
                      </Button>
                    )}
                    {item.status !== 'NOT_APPLICABLE' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setTarget({ item, status: 'NOT_APPLICABLE' });
                          setNote('');
                        }}
                      >
                        Não se aplica
                      </Button>
                    ) : null}
                  </Can>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target?.item.title}</DialogTitle>
            <DialogDescription>
              {target?.status === 'NOT_APPLICABLE'
                ? 'Explique por que o item não se aplica.'
                : 'Observação opcional (onde está o arquivo, quem assinou...).'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="doc-note">Observação</Label>
            <Input id="doc-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Voltar
            </Button>
            <Button
              disabled={
                update.isPending || (target?.status === 'NOT_APPLICABLE' && note.trim().length < 3)
              }
              onClick={() => update.mutate()}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
