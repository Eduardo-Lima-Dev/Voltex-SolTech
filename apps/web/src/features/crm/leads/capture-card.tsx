import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from '@voltex/ui';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
} from '@voltex/ui';
import { queryKeys } from '@/features/admin/query-keys';
import { ConfirmDialog } from '@/features/admin/company/confirm-delete';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

const captureUrl = (key: string) => `${window.location.origin}/api/v1/public/leads/${key}`;

/** Endereço do formulário público da empresa: o site ou landing page envia os leads para cá. */
export function CaptureCard() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.leadCaptureKey,
    queryFn: endpoints.leads.captureKey,
  });

  const rotate = useMutation({
    mutationFn: endpoints.leads.rotateCaptureKey,
    onSuccess: async () => {
      toast.success('Chave trocada. A anterior deixou de funcionar.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.leadCaptureKey });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível trocar a chave.')),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copiado');
    } catch {
      toast.error('Não foi possível copiar. Selecione e copie manualmente.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Formulário de captação</CardTitle>
        <CardDescription>
          Envie os leads do seu site ou landing page para cá (POST em JSON). É obrigatório informar
          telefone ou e-mail e o consentimento da pessoa (<code>consent: true</code>).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar a chave.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                aria-label="Endereço de captação"
                value={captureUrl(data.key)}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copiar endereço"
                onClick={() => void copy(captureUrl(data.key))}
              >
                <Copy />
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
                <RefreshCw /> Trocar chave
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
              {`{ "name": "Maria Silva", "phone": "(85) 98888-7777",\n  "utm": { "source": "instagram" }, "consent": true }`}
            </pre>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Trocar a chave de captação?"
        description="O endereço atual deixa de funcionar imediatamente: atualize os formulários que o usam."
        confirmLabel="Trocar chave"
        onConfirm={() => rotate.mutate()}
      />
    </Card>
  );
}
