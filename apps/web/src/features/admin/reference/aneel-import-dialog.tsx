import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CloudDownload, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { toast } from '@voltex/ui';
import type { AneelImportResult } from '@voltex/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { queryKeys } from '../query-keys';

const DATASET_URL =
  'https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica';

/** Busca concessionárias e a tarifa residencial vigente no portal de Dados Abertos da ANEEL. */
export function AneelImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<AneelImportResult | null>(null);

  const close = (next: boolean) => {
    if (!next) setResult(null);
    onOpenChange(next);
  };

  const run = useMutation({
    mutationFn: endpoints.aneel.import,
    onSuccess: async (data) => {
      setResult(data);
      toast.success('Importação da ANEEL concluída');
      await queryClient.invalidateQueries({ queryKey: queryKeys.distributors });
      await queryClient.invalidateQueries({ queryKey: queryKeys.tariffs() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível importar da ANEEL.')),
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar da ANEEL</DialogTitle>
          <DialogDescription>
            Cadastra as distribuidoras e a tarifa residencial convencional (Grupo B, subgrupo B1)
            vigente de cada uma, direto dos Dados Abertos da ANEEL (atualizados toda semana).
          </DialogDescription>
        </DialogHeader>

        <Alert variant="warning">
          <AlertTitle>Valores sem impostos</AlertTitle>
          <AlertDescription>
            A ANEEL publica TUSD + TE <strong>sem ICMS, PIS e COFINS</strong>. A tarifa da fatura do
            cliente é maior e tem prioridade nos cálculos quando informada. Grupo A, tarifa branca e
            demais modalidades não são importados.
          </AlertDescription>
        </Alert>

        {result ? (
          <Alert variant="info" aria-live="polite">
            <AlertTitle>Importação concluída</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>
                {result.rowsRead.toLocaleString('pt-BR')} linhas lidas · distribuidoras:{' '}
                {result.distributorsCreated} novas, {result.distributorsUpdated} atualizadas ·
                tarifas: {result.tariffsCreated} novas, {result.tariffsUpdated} atualizadas,{' '}
                {result.tariffsUnchanged} sem mudança.
              </p>
              <p className="text-xs">
                Fonte: {result.source.dataset} · licença {result.source.license}. A UF das
                distribuidoras não vem no arquivo: complete se precisar.
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">
            O arquivo é grande (mais de 150 MB) e pode levar alguns minutos. Pode rodar de novo
            quando quiser: só o que mudou é atualizado.{' '}
            <a
              className="inline-flex items-center gap-1 underline"
              href={DATASET_URL}
              target="_blank"
              rel="noreferrer"
            >
              Ver a fonte <ExternalLink className="size-3" aria-hidden />
            </a>
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {result ? 'Fechar' : 'Cancelar'}
          </Button>
          {result ? null : (
            <Button type="button" disabled={run.isPending} onClick={() => run.mutate()}>
              {run.isPending ? <Spinner /> : <CloudDownload />}
              {run.isPending ? 'Importando…' : 'Importar agora'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
