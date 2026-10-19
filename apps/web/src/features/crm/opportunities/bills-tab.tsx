import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router';
import { toast } from '@voltex/ui';
import type { EnergyBillStatus } from '@voltex/shared';
import { Badge, Button, Skeleton, Spinner } from '@voltex/ui';
import { Can } from '@/app/guards';
import { queryKeys } from '@/features/admin/query-keys';
import { BILL_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime, formatPercent } from '@/lib/format';

const STATUS_BADGE: Record<EnergyBillStatus, 'secondary' | 'yellow' | 'green' | 'outline'> = {
  UPLOADED: 'secondary',
  PARSED: 'yellow',
  VALIDATED: 'green',
  REJECTED: 'outline',
};

export function BillsTab({ opportunityId }: { opportunityId: string }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const bills = useQuery({
    queryKey: queryKeys.opportunityBills(opportunityId),
    queryFn: () => endpoints.energyBills.list({ opportunityId }),
  });

  const upload = useMutation({
    mutationFn: (file: File) => endpoints.energyBills.upload(file, { opportunityId }),
    onSuccess: async (bill) => {
      toast.success(
        bill.status === 'PARSED'
          ? 'Fatura enviada. Revise os campos lidos.'
          : 'Fatura enviada. Preencha os campos na revisão.',
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.opportunityBills(opportunityId) });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.opportunityTimeline(opportunityId),
      });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível enviar a fatura.')),
  });

  const download = async (id: string) => {
    try {
      const { url } = await endpoints.energyBills.downloadUrl(id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível gerar o link do arquivo.'));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Envie a fatura (PDF ou foto). Os campos lidos sempre passam por revisão antes de alimentar o
        cálculo.
      </p>
      <Can permission={['crm.energy-bill.write', 'platform.document.write']}>
        <div>
          <input
            ref={input}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            aria-label="Arquivo da fatura"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
          <Button size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? <Spinner /> : <FileUp />}
            Enviar fatura
          </Button>
        </div>
      </Can>
      {bills.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : bills.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar as faturas.</p>
      ) : bills.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma fatura enviada.</p>
      ) : (
        <ul className="divide-y">
          {bills.data.map((bill) => (
            <li
              key={bill.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{bill.filename}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDateTime(bill.createdAt)}
                  {bill.overallConfidence !== null
                    ? ` · confiança média da leitura ${formatPercent(bill.overallConfidence)}`
                    : ' · sem leitura automática'}
                  {bill.rejectedReason ? ` · recusada: ${bill.rejectedReason}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_BADGE[bill.status]}>{BILL_STATUS_LABELS[bill.status]}</Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Baixar ${bill.filename}`}
                  onClick={() => void download(bill.id)}
                >
                  <Download />
                </Button>
                <Can permission="crm.energy-bill.write">
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/crm/oportunidades/${opportunityId}/faturas/${bill.id}`}>
                      {bill.status === 'VALIDATED' ? 'Ver / revalidar' : 'Revisar'}
                    </Link>
                  </Button>
                </Can>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
