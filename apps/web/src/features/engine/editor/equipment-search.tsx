import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CatalogSearchResultDto, EquipmentKind, ImportPreviewDto } from '@voltex/shared';
import { Badge, Button, Input, Label, Spinner, toast } from '@voltex/ui';
import { ImportDialog } from '@/features/admin/catalog/import-dialog';
import { queryKeys } from '@/features/admin/query-keys';
import { useAuth } from '@/features/auth/auth-provider';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

/** Palavras para a busca na internet de cada tipo. */
const KIND_SEARCH: Partial<Record<EquipmentKind, string>> = {
  MODULE: 'módulo fotovoltaico',
  INVERTER: 'inversor solar',
  BATTERY: 'bateria solar estacionária',
  CHARGE_CONTROLLER: 'controlador de carga solar MPPT',
  OFFGRID_INVERTER: 'inversor off-grid híbrido',
  GENERATOR: 'gerador',
};

const ORIGIN_BADGE = {
  CATALOG: 'green',
  LINK: 'secondary',
  SOURCE: 'secondary',
  REFERENCE: 'yellow',
} as const;

/**
 * Busca ao digitar no catálogo da empresa e nas fontes (públicas e cadastradas por link). Cada resultado mostra de onde
 * vem. Escolher o que já está aprovado usa direto; escolher o de uma fonte abre a prévia para importar (a pessoa completa o
 * que faltar) e, depois de aprovado, entra no projeto.
 */
export function EquipmentSearch({
  kind,
  label,
  disabled,
  onPick,
}: {
  kind: EquipmentKind;
  label: string;
  disabled?: boolean;
  /** Recebe o id do equipamento **aprovado** escolhido. */
  onPick: (equipmentId: string) => void;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [link, setLink] = useState('');
  const [addingLink, setAddingLink] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useQuery({
    queryKey: ['catalog', 'search', kind, term],
    // Aberta sem digitar, já lista o que existe do tipo (catálogo, bibliotecas e fontes).
    queryFn: () => endpoints.catalog.search(term, kind, 15),
    enabled: open,
    staleTime: 30_000,
  });

  /** Cadastra o link colado como fonte da empresa: o sistema lê a página/arquivo e a busca passa a achar o que ele traz. */
  const addLink = async () => {
    setAddingLink(true);
    try {
      const created = await endpoints.catalog.addSourceLink({ url: link.trim() });
      toast.success(
        created.status === 'ERROR'
          ? `Link guardado, mas não consegui ler: ${created.lastError ?? 'erro desconhecido'}`
          : `Link analisado: ${created.pagesRead} página(s). Procurando de novo…`,
      );
      setLink('');
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'search'] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalog() });
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível adicionar o link.'));
    } finally {
      setAddingLink(false);
    }
  };

  const choose = async (item: CatalogSearchResultDto) => {
    setOpen(false);
    try {
      if (item.origin === 'CATALOG') {
        if (item.status === 'APPROVED') {
          onPick(item.id);
          setText('');
        } else if (can('engine.project.approve')) {
          setBusy(true);
          await endpoints.catalog.approve(item.id);
          await queryClient.invalidateQueries({ queryKey: queryKeys.catalog() });
          toast.success('Item aprovado e pronto para usar.');
          onPick(item.id);
          setText('');
        } else toast.info('Este item é um rascunho: peça a aprovação do responsável técnico.');
      } else {
        setBusy(true);
        setPreview(
          item.origin === 'REFERENCE'
            ? await endpoints.catalog.previewReference(item.id)
            : item.origin === 'LINK'
              ? await endpoints.catalog.previewLinkDocument(item.id, kind)
              : await endpoints.catalog.previewSourceDocument(item.id, kind),
        );
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível usar este item.'));
    } finally {
      setBusy(false);
    }
  };

  const id = `eq-search-${kind}`;
  return (
    <div className="relative grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search aria-hidden className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          autoComplete="off"
          disabled={disabled}
          className="pl-8"
          placeholder="Digite marca ou modelo (catálogo e fontes)"
          value={text}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && results.data?.[0]) {
              e.preventDefault();
              void choose(results.data[0]);
            }
          }}
        />
        {busy || results.isFetching ? (
          <Spinner className="absolute top-2.5 right-2.5 size-4" />
        ) : null}
      </div>
      {open ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={term ? `Resultados para ${term}` : 'Equipamentos disponíveis'}
          className="absolute top-full z-30 mt-1 max-h-80 w-full min-w-80 overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {results.isError ? (
            <li className="p-2 text-sm text-destructive">Não foi possível buscar.</li>
          ) : results.data && results.data.length === 0 ? (
            <li className="p-2 text-sm text-muted-foreground">
              {term
                ? 'Nada encontrado nas suas fichas, nas bibliotecas e nas fontes cadastradas.'
                : 'Ainda não há nada deste tipo. Digite o nome ou use as opções abaixo.'}
            </li>
          ) : (
            (results.data ?? []).map((item) => (
              <li key={`${item.origin}-${item.id}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => void choose(item)}
                >
                  <span className="font-medium">
                    {item.manufacturer} {item.model}
                  </span>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <Badge variant={ORIGIN_BADGE[item.origin]}>{item.sourceLabel}</Badge>
                    {item.detail}
                    {item.origin !== 'CATALOG' ? ' · importar e usar' : ''}
                  </span>
                </button>
              </li>
            ))
          )}
          <li role="presentation" className="mt-1 space-y-2 border-t p-2 text-xs">
            <p className="font-medium text-foreground">Não achou?</p>
            <a
              className="inline-block text-primary underline underline-offset-2"
              href={`https://www.google.com/search?q=${encodeURIComponent(`${term} ${KIND_SEARCH[kind] ?? ''} ficha técnica datasheet pdf`.trim())}`}
              target="_blank"
              rel="noopener noreferrer"
              onMouseDown={(e) => e.stopPropagation()}
            >
              Procurar “{term || KIND_SEARCH[kind]}” na internet ↗
            </a>
            {can('platform.catalog.manage') ? (
              <form
                className="flex gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addLink();
                }}
              >
                <Input
                  aria-label="Link da ficha ou da página do fabricante"
                  placeholder="Cole aqui o link do PDF ou da página"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  className="h-8"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!/^https?:\/\//i.test(link.trim()) || addingLink}
                >
                  {addingLink ? <Spinner /> : null} Adicionar
                </Button>
              </form>
            ) : null}
          </li>
        </ul>
      ) : null}
      {preview ? (
        <ImportDialog
          open
          onOpenChange={(next) => !next && setPreview(null)}
          defaultKind={kind}
          initialPreview={preview}
          onCreated={(created) => {
            const ready = created.find((c) => c.status === 'APPROVED');
            if (ready) {
              onPick(ready.id);
              setText('');
            }
          }}
        />
      ) : null}
    </div>
  );
}
