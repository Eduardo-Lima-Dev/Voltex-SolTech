import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  toast,
} from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/** Documentos que o cliente enviou pelo portal e ainda aguardam revisão (quarentena). */
export function PortalUploadsCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const key = ['portal-uploads', 'PENDING'];
  const uploads = useQuery({
    queryKey: key,
    queryFn: () => endpoints.portalAccess.uploads('PENDING'),
  });
  const mine = uploads.data?.filter((u) => u.projectId === projectId) ?? [];
  const open = useMutation({
    mutationFn: (documentId: string) => endpoints.documents.downloadUrl(documentId),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener'),
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível abrir o arquivo.')),
  });
  const review = useMutation({
    mutationFn: (input: { id: string; accept: boolean }) =>
      endpoints.portalAccess.review(input.id, {
        accept: input.accept,
        ...(notes[input.id]?.trim() ? { note: notes[input.id]!.trim() } : {}),
      }),
    onSuccess: async (_r, input) => {
      toast.success(input.accept ? 'Arquivo aceito e incluído no projeto.' : 'Arquivo recusado.');
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível registrar a revisão.')),
  });
  if (mine.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enviados pelo cliente</CardTitle>
        <CardDescription>
          Ficam em quarentena até você revisar. Aceito, o arquivo passa a fazer parte do projeto.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3" aria-label="Documentos enviados pelo cliente">
          {mine.map((u) => (
            <li key={u.id} className="space-y-2 rounded-md border p-3 text-sm">
              <p>
                <strong>{u.filename}</strong> · enviado em {formatDateTime(u.createdAt)}
                {u.note ? <span className="text-muted-foreground"> — “{u.note}”</span> : null}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={open.isPending}
                  onClick={() => open.mutate(u.documentId)}
                >
                  Abrir
                </Button>
                <Input
                  aria-label={`Observação sobre ${u.filename}`}
                  placeholder="Observação (opcional)"
                  className="max-w-64"
                  value={notes[u.id] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [u.id]: e.target.value })}
                />
                <Button
                  size="sm"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ id: u.id, accept: true })}
                >
                  Aceitar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ id: u.id, accept: false })}
                >
                  Recusar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
