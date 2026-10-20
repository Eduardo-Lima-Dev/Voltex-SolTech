import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp } from 'lucide-react';
import { useState } from 'react';
import type {
  EquipmentKind,
  ImportCandidateDto,
  ImportFormat,
  ImportPreviewDto,
} from '@voltex/shared';
import { createEquipmentSchema } from '@voltex/shared';
import { equipmentCsvTemplate } from '@voltex/solar-engine';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Spinner,
  toast,
} from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, fieldErrors } from '@/lib/api/errors';
import { queryKeys } from '../query-keys';
import { KIND_LABELS, ORIGIN_LABELS } from './catalog-fields';
import { EquipmentFormDialog, type EquipmentFormValues } from './equipment-form-dialog';

const FORMATS: { value: ImportFormat; label: string; accept: string }[] = [
  { value: 'csv', label: 'Planilha (CSV)', accept: '.csv,text/csv' },
  { value: 'pan', label: 'Arquivo .PAN do PVsyst (módulo)', accept: '.pan' },
  { value: 'ond', label: 'Arquivo .OND do PVsyst (inversor)', accept: '.ond' },
  {
    value: 'datasheet-pdf',
    label: 'Ficha técnica em PDF (módulo)',
    accept: '.pdf,application/pdf',
  },
];

interface Row extends ImportCandidateDto {
  /** Confirmado pela pessoa para gravar como rascunho. */
  selected: boolean;
}

/** `true` se o candidato já tem tudo o que o cadastro exige e nenhum erro físico. */
const ready = (row: Row): boolean =>
  row.missing.length === 0 &&
  row.manufacturer !== '' &&
  row.model !== '' &&
  !row.issues.some((i) => i.severity === 'ERROR');

/** Marca de ordem de bytes: o Excel só abre o CSV em UTF-8 com ela. */
const BOM = String.fromCharCode(0xfeff);

export function downloadTemplate(kind: EquipmentKind): void {
  const blob = new Blob([`${BOM}${equipmentCsvTemplate(kind)}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `modelo-${kind.toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportDialog({
  open,
  onOpenChange,
  defaultKind,
  initialPreview = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultKind: EquipmentKind;
  /** Prévia já lida (ex.: ficha baixada de uma fonte na internet): abre direto na conferência. */
  initialPreview?: ImportPreviewDto | null;
}) {
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<ImportFormat>('csv');
  const [kind, setKind] = useState<EquipmentKind>(defaultKind);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(initialPreview);
  const [rows, setRows] = useState<Row[]>(
    initialPreview ? initialPreview.candidates.map((c) => ({ ...c, selected: false })) : [],
  );
  const [editing, setEditing] = useState<number | null>(null);

  const read = useMutation({
    mutationFn: () =>
      endpoints.catalog.preview(file as File, format, format === 'csv' ? kind : undefined),
    onSuccess: (result) => {
      setPreview(result);
      setRows(result.candidates.map((c) => ({ ...c, selected: false })));
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível ler o arquivo.')),
  });

  const save = useMutation({
    mutationFn: () => {
      const items = rows
        .filter((r) => r.selected)
        .map((r) => ({
          kind: r.kind,
          manufacturer: r.manufacturer,
          model: r.model,
          spec: r.spec,
          origin: r.origin,
          fieldConfidence: r.fieldConfidence,
          ...(r.referenceCostCents !== undefined
            ? { referenceCostCents: r.referenceCostCents }
            : {}),
        }));
      return endpoints.catalog.commit({ items: items as never });
    },
    onSuccess: async ({ created }) => {
      toast.success(`${created.length} rascunho(s) criado(s). Revise e aprove no catálogo.`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalog() });
      reset();
      onOpenChange(false);
    },
    onError: (error) => {
      const first = Object.entries(fieldErrors(error))[0];
      toast.error(
        first ? `${first[0]}: ${first[1]}` : errorMessage(error, 'Não foi possível gravar.'),
      );
    },
  });

  const reset = () => {
    setFile(null);
    setPreview(null);
    setRows([]);
    setEditing(null);
  };

  const selectable = rows.filter(ready);
  const chosen = rows.filter((r) => r.selected);
  const editingRow = editing !== null ? rows[editing] : undefined;

  const applyEdit = (values: EquipmentFormValues) => {
    if (editing === null || !editingRow) return;
    // A conferência física completa roda no servidor; aqui só confere o formato antes de marcar como pronto.
    const check = createEquipmentSchema.safeParse({
      kind: editingRow.kind,
      ...values,
      origin: editingRow.origin,
      fieldConfidence: editingRow.fieldConfidence,
    });
    setRows((current) =>
      current.map((r, i) =>
        i === editing
          ? {
              ...r,
              manufacturer: values.manufacturer,
              model: values.model,
              spec: values.spec,
              missing: check.success ? [] : r.missing.filter((m) => !(m in values.spec)),
              issues: r.issues.filter(
                (issue) => issue.severity !== 'ERROR' || !(issue.field in values.spec),
              ),
              selected: check.success,
            }
          : r,
      ),
    );
    setEditing(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar equipamentos</DialogTitle>
          <DialogDescription>
            O arquivo é lido e mostrado aqui para você conferir. Nada entra no catálogo sem a sua
            confirmação, e tudo entra como <strong>rascunho</strong>, aguardando a aprovação do
            responsável técnico.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="imp-format">Tipo de arquivo</Label>
              <NativeSelect
                id="imp-format"
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value as ImportFormat);
                  setFile(null);
                }}
              >
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {format === 'csv' ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="imp-kind">Tipo de equipamento da planilha</Label>
                  <NativeSelect
                    id="imp-kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as EquipmentKind)}
                  >
                    {(Object.keys(KIND_LABELS) as EquipmentKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => downloadTemplate(kind)}
                >
                  <Download /> Baixar modelo de planilha
                </Button>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="imp-file">Arquivo</Label>
              <Input
                id="imp-file"
                type="file"
                accept={FORMATS.find((f) => f.value === format)?.accept}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {format === 'datasheet-pdf' ? (
                <p className="text-xs text-muted-foreground">
                  A leitura da ficha é uma sugestão: fabricante e modelo não são lidos, e você
                  confere cada campo contra o PDF. PDF escaneado (imagem) não tem texto para ler.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button disabled={!file || read.isPending} onClick={() => read.mutate()}>
                {read.isPending ? <Spinner /> : <FileUp />} Ler arquivo
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            {preview.errors.map((e, i) => (
              <p
                key={i}
                className="rounded border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive"
              >
                {e.row ? `Linha ${e.row}: ` : ''}
                {e.message}
              </p>
            ))}
            {preview.notes.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {preview.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum equipamento encontrado no arquivo.
              </p>
            ) : (
              <ul className="space-y-3">
                {rows.map((row, index) => (
                  <li key={index} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {row.manufacturer || <em>fabricante a informar</em>}{' '}
                          {row.model || <em>modelo a informar</em>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {KIND_LABELS[row.kind]} · {ORIGIN_LABELS[row.origin]}
                          {row.exists ? ' · já existe: entra como nova revisão' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing(index)}>
                          Conferir e completar
                        </Button>
                        <Label className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={row.selected}
                            disabled={!ready(row)}
                            onChange={(e) =>
                              setRows((cur) =>
                                cur.map((r, i) =>
                                  i === index ? { ...r, selected: e.target.checked } : r,
                                ),
                              )
                            }
                          />
                          Gravar
                        </Label>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {row.missing.length > 0 ? (
                        <Badge variant="red">faltam {row.missing.length} campo(s)</Badge>
                      ) : (
                        <Badge variant="green">ficha completa</Badge>
                      )}
                      {row.issues.map((issue) => (
                        <Badge
                          key={`${issue.code}-${issue.field}`}
                          variant={issue.severity === 'ERROR' ? 'red' : 'yellow'}
                          title={issue.message}
                        >
                          {issue.message}
                        </Badge>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Escolher outro arquivo
              </Button>
              <Button
                disabled={chosen.length === 0 || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? <Spinner /> : null}
                Gravar {chosen.length} rascunho(s)
              </Button>
            </DialogFooter>
            {selectable.length < rows.length ? (
              <p className="text-xs text-muted-foreground">
                Só itens com a ficha completa e sem erro físico podem ser gravados. Use “Conferir e
                completar”.
              </p>
            ) : null}
          </div>
        )}
      </DialogContent>
      {editingRow ? (
        <EquipmentFormDialog
          open
          onOpenChange={(next) => !next && setEditing(null)}
          kind={editingRow.kind}
          title="Conferir a ficha"
          description="Corrija o que estiver errado e preencha o que falta. Campos convertidos ou presumidos vêm marcados."
          initial={{
            manufacturer: editingRow.manufacturer,
            model: editingRow.model,
            spec: editingRow.spec,
            fieldConfidence: editingRow.fieldConfidence,
            missing: editingRow.missing,
          }}
          submitLabel="Usar estes valores"
          onSubmit={applyEdit}
        />
      ) : null}
    </Dialog>
  );
}
