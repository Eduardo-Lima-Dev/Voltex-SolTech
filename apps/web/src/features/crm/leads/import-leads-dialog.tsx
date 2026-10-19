import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from '@voltex/ui';
import type { ImportLeadsResult } from '@voltex/shared';
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
  Input,
  Spinner,
} from '@voltex/ui';
import { Field } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { LEADS_CSV_TEMPLATE, parseLeadsCsv, type LeadsCsvResult } from './leads-csv';

export function ImportLeadsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [parsed, setParsed] = useState<LeadsCsvResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ImportLeadsResult | null>(null);

  const close = (next: boolean) => {
    if (!next) {
      setParsed(null);
      setFileName('');
      setResult(null);
    }
    onOpenChange(next);
  };

  const run = useMutation({
    mutationFn: () => endpoints.leads.import({ rows: parsed?.rows ?? [] }),
    onSuccess: async (data) => {
      setResult(data);
      toast.success(
        `${data.created} lead(s) importado(s), ${data.duplicates} duplicado(s) ignorado(s)`,
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.leads() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível importar o arquivo.')),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setParsed(parseLeadsCsv(await file.text()));
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([LEADS_CSV_TEMPLATE], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo-leads.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar leads de uma planilha</DialogTitle>
          <DialogDescription>
            Colunas: nome (obrigatória), telefone, email, documento, segmento, cidade, uf, origem e
            observacoes. Leads que já existem (mesmo telefone, e-mail ou documento) são ignorados.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={downloadTemplate}
          >
            <Download /> Baixar modelo
          </Button>
          <Field id="leads-file" label="Arquivo da planilha (CSV)">
            <Input
              id="leads-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </Field>
          {parsed && !result ? (
            <div className="space-y-2 text-sm" aria-live="polite">
              <p>
                <strong>{fileName}</strong>: {parsed.rows.length} lead(s) válido(s)
                {parsed.errors.length > 0 ? `, ${parsed.errors.length} com problema` : ''}.
              </p>
              {parsed.errors.length > 0 ? (
                <Alert variant="warning">
                  <AlertTitle>Corrija o arquivo e envie de novo</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-auto pl-5">
                      {parsed.errors.slice(0, 20).map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                      {parsed.errors.length > 20 ? (
                        <li>… e mais {parsed.errors.length - 20}.</li>
                      ) : null}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}
          {result ? (
            <Alert variant="info" aria-live="polite">
              <AlertTitle>Importação concluída</AlertTitle>
              <AlertDescription className="space-y-1">
                <p>
                  {result.created} novo(s) · {result.duplicates} duplicado(s) ignorado(s)
                </p>
                {result.duplicateRows.length > 0 ? (
                  <ul className="max-h-32 list-disc overflow-auto pl-5">
                    {result.duplicateRows.slice(0, 15).map((d) => (
                      <li key={d.row}>
                        Linha {d.row} ({d.name}): já existe com o mesmo {d.matchedBy.join(' e ')}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {result ? 'Fechar' : 'Cancelar'}
          </Button>
          {result ? null : (
            <Button
              type="button"
              disabled={
                !parsed || parsed.errors.length > 0 || parsed.rows.length === 0 || run.isPending
              }
              onClick={() => run.mutate()}
            >
              {run.isPending ? <Spinner /> : <Upload />}
              Importar {parsed && parsed.errors.length === 0 ? parsed.rows.length : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
