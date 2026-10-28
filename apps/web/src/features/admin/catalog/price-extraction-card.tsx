import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  Label,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@voltex/ui';
import type { PriceExtractionDto, PriceExtractionRowDto } from '@voltex/shared';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { queryKeys } from '../query-keys';

interface Draft extends PriceExtractionRowDto {
  selected: boolean;
}

const cellInput = 'h-8 min-w-24 px-2 text-xs';

/**
 * Procurement assistido (12H): a IA lê o PDF/CSV do fornecedor e propõe as linhas; cada uma mostra o trecho do
 * documento de onde saiu. Nada entra na lista de preços até a pessoa conferir e clicar em "Importar".
 */
export function PriceExtractionCard() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<PriceExtractionDto | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const extract = useMutation({
    mutationFn: () => endpoints.ai.procurement.extract(file as File),
    onSuccess: (data) => {
      setExtraction(data);
      setRows(data.rows.map((r) => ({ ...r, selected: r.problems.length === 0 })));
      setFailure(null);
    },
    onError: (error) => setFailure(errorMessage(error, 'Não foi possível ler o documento.')),
  });

  const confirm = useMutation({
    mutationFn: () =>
      endpoints.ai.procurement.confirm(extraction!.id, {
        rows: rows
          .filter((r) => r.selected)
          .map((r) => ({
            index: r.index,
            manufacturer: r.manufacturer,
            model: r.model,
            description: r.description,
            supplier: r.supplier,
            sku: r.sku,
            priceReais: r.priceReais,
            validFrom: r.validFrom,
            validTo: r.validTo,
          })),
      }),
    onSuccess: async ({ result }) => {
      toast.success(`${result.created} preço(s) importado(s).`);
      setExtraction(null);
      setRows([]);
      setFile(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalogPrices });
    },
    onError: (error) =>
      setFailure(errorMessage(error, 'Corrija as linhas marcadas antes de importar.')),
  });

  const discard = useMutation({
    mutationFn: () => endpoints.ai.procurement.discard(extraction!.id),
    onSuccess: () => {
      setExtraction(null);
      setRows([]);
    },
  });

  const edit = (index: number, patch: Partial<Draft>) =>
    setRows((current) => current.map((r) => (r.index === index ? { ...r, ...patch } : r)));
  const selectedCount = rows.filter((r) => r.selected).length;

  return (
    <Can permission="procurement.price.extract">
      <div className="space-y-3 rounded-md border p-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-brand-cyan" aria-hidden />
            Ler tabela de preços com IA
          </h3>
          <p className="text-xs text-muted-foreground">
            Envie o PDF ou CSV do fornecedor. A IA propõe as linhas e você confere antes de
            importar; dados pessoais do documento são removidos antes do envio.
          </p>
        </div>
        {!extraction ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="extract-file">Documento (PDF ou CSV)</Label>
              <Input
                id="extract-file"
                type="file"
                accept=".pdf,.csv,application/pdf,text/csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setFailure(null);
                }}
              />
            </div>
            <Button
              size="sm"
              disabled={!file || extract.isPending}
              onClick={() => extract.mutate()}
            >
              {extract.isPending ? <Spinner /> : null}
              {extract.isPending ? 'Lendo o documento…' : 'Ler com IA'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {extraction.truncated ? (
              <Alert>
                <AlertDescription>
                  O documento é grande: só o começo foi lido. Envie o restante em outro arquivo.
                </AlertDescription>
              </Alert>
            ) : null}
            {extraction.discardedCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {extraction.discardedCount} linha(s) da IA foram descartadas porque o trecho ou o
                preço não confere com o documento.
              </p>
            ) : null}
            {Object.keys(extraction.removed).length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Dados pessoais removidos antes do envio à IA:{' '}
                {Object.entries(extraction.removed)
                  .map(([type, n]) => `${type.toLowerCase()} (${n})`)
                  .join(', ')}
                .
              </p>
            ) : null}
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                A IA não encontrou linhas de preço que se confirmem no documento.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Importar</TableHead>
                      <TableHead>Fabricante</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead>Preço (R$)</TableHead>
                      <TableHead>Vigência início</TableHead>
                      <TableHead>Vigência fim</TableHead>
                      <TableHead>Origem no documento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.index}>
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`Importar linha ${r.index + 1}`}
                            checked={r.selected}
                            onChange={(e) => edit(r.index, { selected: e.target.checked })}
                          />
                        </TableCell>
                        {(['manufacturer', 'model', 'description', 'supplier'] as const).map(
                          (field) => (
                            <TableCell key={field}>
                              <Input
                                className={cellInput}
                                aria-label={`${field} da linha ${r.index + 1}`}
                                value={r[field]}
                                onChange={(e) => edit(r.index, { [field]: e.target.value })}
                              />
                            </TableCell>
                          ),
                        )}
                        <TableCell>
                          <Input
                            className={cellInput}
                            inputMode="decimal"
                            aria-label={`Preço da linha ${r.index + 1}`}
                            value={String(r.priceReais).replace('.', ',')}
                            onChange={(e) => {
                              const n = Number(e.target.value.replace(',', '.'));
                              if (Number.isFinite(n)) edit(r.index, { priceReais: n });
                            }}
                          />
                        </TableCell>
                        {(['validFrom', 'validTo'] as const).map((field) => (
                          <TableCell key={field}>
                            <Input
                              className={cellInput}
                              placeholder="dd/mm/aaaa"
                              aria-label={`${field} da linha ${r.index + 1}`}
                              value={r[field]}
                              onChange={(e) => edit(r.index, { [field]: e.target.value })}
                            />
                          </TableCell>
                        ))}
                        <TableCell className="max-w-64 text-xs text-muted-foreground">
                          <p className="line-clamp-2" title={r.excerpt}>
                            {r.excerpt}
                          </p>
                          {r.match ? (
                            <Badge variant="green">Casou: {r.match.label}</Badge>
                          ) : (
                            <Badge variant="outline">Insumo avulso</Badge>
                          )}
                          {r.problems.map((problem) => (
                            <p key={problem} className="text-destructive">
                              {problem}
                            </p>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={selectedCount === 0 || confirm.isPending}
                onClick={() => confirm.mutate()}
              >
                {confirm.isPending ? <Spinner /> : null}
                Importar {selectedCount} linha(s)
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={discard.isPending}
                onClick={() => discard.mutate()}
              >
                Descartar
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Gerado por IA a partir do documento. Confira cada preço antes de importar.
            </p>
          </div>
        )}
        {failure ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </Can>
  );
}
