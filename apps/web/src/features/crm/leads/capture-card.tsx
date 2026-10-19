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

/** Texto pronto para mandar a quem faz o site: o técnico fica aqui, longe de quem trabalha com vendas. */
const instructionsFor = (url: string) =>
  `Olá! Preciso que o formulário do nosso site envie os contatos para o nosso CRM.

Endereço para envio (método POST, conteúdo em JSON):
${url}

Campos: name (nome), phone (telefone) e/ou email, e consent: true (a pessoa autorizou o contato).
Opcional: utm.source, utm.medium e utm.campaign para sabermos de qual campanha veio.

Exemplo:
{ "name": "Maria Silva", "phone": "(85) 98888-7777", "consent": true, "utm": { "source": "instagram" } }

Cada pessoa que preencher aparece como um novo lead no CRM, já com a origem.`;

/** Receber contatos do site: o dono do negócio só copia e repassa; quem faz o site cuida do resto. */
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
      toast.success('Novo endereço gerado. O anterior deixou de funcionar.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.leadCaptureKey });
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Não foi possível gerar um novo endereço.')),
  });

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Receber contatos do seu site</CardTitle>
        <CardDescription>
          Quem preencher o formulário do seu site ou da sua página de campanha vira um lead aqui,
          sem digitar nada. Para ligar o formulário a este CRM, mande as instruções abaixo para quem
          cuida do seu site.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar o endereço.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() =>
                  void copy(
                    instructionsFor(captureUrl(data.key)),
                    'Instruções copiadas: é só colar numa mensagem',
                  )
                }
              >
                <Copy /> Copiar instruções para quem faz o site
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
                <RefreshCw /> Gerar novo endereço
              </Button>
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Ver o endereço do formulário
              </summary>
              <div className="mt-2 flex items-center gap-2">
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
                  onClick={() => void copy(captureUrl(data.key), 'Endereço copiado')}
                >
                  <Copy />
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                A pessoa precisa autorizar o contato (consentimento) e informar telefone ou e-mail.
              </p>
            </details>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Gerar um novo endereço?"
        description="O endereço atual deixa de funcionar na hora. Depois, mande o novo para quem cuida do seu site, senão os contatos deixam de chegar."
        confirmLabel="Gerar novo endereço"
        onConfirm={() => rotate.mutate()}
      />
    </Card>
  );
}
