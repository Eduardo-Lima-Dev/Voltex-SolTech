import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Plus } from 'lucide-react';
import { useState } from 'react';
import type {
  EquipmentKind,
  EquipmentStatus,
  CatalogLinkDocumentDto,
  ExternalReferenceDto,
  ImportPreviewDto,
} from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, fieldErrors, isApiError } from '@/lib/api/errors';
import { formatDate } from '@/lib/format';
import { queryKeys } from '../query-keys';
import {
  KIND_LABELS,
  KIND_SINGULAR,
  ORIGIN_LABELS,
  STATUS_LABELS,
  specSummary,
} from './catalog-fields';
import { EquipmentFormDialog, type EquipmentFormValues } from './equipment-form-dialog';
import { ImportDialog } from './import-dialog';
import { ItemDetailDialog } from './item-detail-dialog';

const STATUS_BADGE = { DRAFT: 'secondary', APPROVED: 'green', RETIRED: 'outline' } as const;
const KINDS = Object.keys(KIND_LABELS) as EquipmentKind[];
const PAGE_SIZE = 20;

function EquipmentList({ kind }: { kind: EquipmentKind }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EquipmentStatus | ''>('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const filters = {
    kind,
    search: search || undefined,
    status: status || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const list = useQuery({
    queryKey: queryKeys.catalog(filters),
    queryFn: () => endpoints.catalog.list(filters),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: (values: EquipmentFormValues) =>
      endpoints.catalog.create({ kind, ...values, origin: 'MANUAL' } as never),
    onSuccess: async (created) => {
      toast.success('Rascunho criado. O responsável técnico precisa aprová-lo para uso.');
      setCreating(false);
      setServerErrors({});
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalog() });
      setOpenId(created.id);
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) toast.error(error.message);
      else {
        setServerErrors(fieldErrors(error));
        toast.error(errorMessage(error, 'Não foi possível criar o equipamento.'));
      }
    },
  });

  const total = list.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>{KIND_LABELS[kind]}</CardTitle>
          <CardDescription>
            Só itens <strong>aprovados</strong> entram nos projetos. Depois de aprovada, a ficha não
            muda: para corrigir, crie uma nova revisão.
          </CardDescription>
        </div>
        <Can permission="platform.catalog.manage">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              <FileUp /> Importar
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Novo {KIND_SINGULAR[kind]}
            </Button>
          </div>
        </Can>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="grid gap-1">
            <Label htmlFor={`search-${kind}`}>Buscar</Label>
            <Input
              id={`search-${kind}`}
              placeholder="Fabricante ou modelo"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`status-${kind}`}>Situação</Label>
            <NativeSelect
              id={`status-${kind}`}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as EquipmentStatus | '');
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              <option value="DRAFT">Rascunho</option>
              <option value="APPROVED">Aprovado</option>
              <option value="RETIRED">Aposentado</option>
            </NativeSelect>
          </div>
        </div>

        {list.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : list.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar o catálogo.</p>
        ) : list.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nada por aqui ainda. Cadastre um {KIND_SINGULAR[kind]} ou importe uma planilha, um
            arquivo .PAN/.OND ou uma ficha em PDF.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipamento</TableHead>
                <TableHead>Ficha</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {item.manufacturer} {item.model}
                    <span className="ml-2 text-xs text-muted-foreground">rev. {item.revision}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {specSummary(item.kind, item.spec as unknown as Record<string, unknown>)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[item.status]}>{STATUS_LABELS[item.status]}</Badge>
                    {(item.kind === 'MODULE' || item.kind === 'INVERTER') &&
                    item.inmetroStatus === 'VERIFIED' ? (
                      <Badge variant="outline" className="ml-1">
                        INMETRO
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {ORIGIN_LABELS[item.origin]}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Abrir ${item.manufacturer} ${item.model}`}
                      onClick={() => setOpenId(item.id)}
                    >
                      Abrir
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {pages > 1 ? (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span>
              Página {page} de {pages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        ) : null}
      </CardContent>

      <EquipmentFormDialog
        open={creating}
        onOpenChange={setCreating}
        kind={kind}
        title={`Novo ${KIND_SINGULAR[kind]}`}
        description="Preencha a ficha técnica conforme o datasheet. Ela entra como rascunho."
        pending={create.isPending}
        serverErrors={serverErrors}
        onSubmit={(values) => create.mutate(values)}
      />
      <ImportDialog open={importing} onOpenChange={setImporting} defaultKind={kind} />
      <ItemDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </Card>
  );
}

function SourceCards({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const sources = useQuery({
    queryKey: queryKeys.catalogSources,
    queryFn: () => endpoints.catalog.sources(),
  });
  if (sources.isPending) return <Skeleton className="h-24 w-full" />;
  if (sources.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar as fontes.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="Fontes de equipamentos">
      {sources.data.map((source) => (
        <li
          key={source.key}
          className={`space-y-2 rounded-lg border p-3 ${selected === source.key ? 'border-primary' : ''}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{source.label}</h3>
            <div className="flex gap-1">
              <Badge variant={source.enabled ? 'green' : 'secondary'}>
                {source.enabled ? 'Ligada' : 'Desligada'}
              </Badge>
              {source.licenseStatus !== 'CLEARED' ? (
                <Badge variant="yellow">Termos a conferir</Badge>
              ) : null}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{source.notes}</p>
          <p className="text-xs text-muted-foreground">
            {source.documentCount} registro(s)
            {source.indexedAt ? ` · atualizado em ${formatDate(source.indexedAt)}` : ''}
          </p>
          <Button size="sm" variant="outline" onClick={() => onSelect(source.key)}>
            Buscar nesta fonte
          </Button>
        </li>
      ))}
    </ul>
  );
}

function SourceDocuments({ source }: { source: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [equipment, setEquipment] = useState<'' | 'MODULE' | 'INVERTER' | 'OTHER'>('');
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const filters = {
    search: search || undefined,
    equipment: equipment || undefined,
    page: 1,
    pageSize: 20,
  };
  const list = useQuery({
    queryKey: queryKeys.catalogSourceDocuments(source, filters),
    queryFn: () => endpoints.catalog.sourceDocuments(source, filters),
  });
  const refresh = useMutation({
    mutationFn: () => endpoints.catalog.refreshSource(source),
    onSuccess: async (r) => {
      toast.success(`Lista atualizada: ${r.found} documento(s) em ${r.pages} página(s).`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalogSources });
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'sources', source] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível atualizar a lista.')),
  });
  const read = useMutation({
    mutationFn: (id: string) => endpoints.catalog.previewSourceDocument(id),
    onSuccess: (result) => setPreview(result),
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível ler a ficha.')),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-56 gap-1">
          <Label htmlFor="src-search">Buscar fichas técnicas</Label>
          <Input
            id="src-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Marca ou modelo"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="src-equipment">Tipo</Label>
          <NativeSelect
            id="src-equipment"
            value={equipment}
            onChange={(e) => setEquipment(e.target.value as typeof equipment)}
          >
            <option value="">Todos</option>
            <option value="INVERTER">Inversor</option>
            <option value="MODULE">Módulo</option>
            <option value="OTHER">Outros</option>
          </NativeSelect>
        </div>
        <Can permission="platform.catalog.manage">
          <Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? <Spinner /> : null} Atualizar lista da fonte
          </Button>
        </Can>
      </div>
      {list.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : list.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os documentos.</p>
      ) : list.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum documento. Use <strong>Atualizar lista da fonte</strong> para ler a listagem do
          site (só os links são guardados).
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Documento</TableHead>
              <TableHead>Marca</TableHead>
              <TableHead>Tipo</TableHead>
              <Can permission="platform.catalog.manage">
                <TableHead className="text-right">Ações</TableHead>
              </Can>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.data.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="font-medium">
                  {doc.title}
                  <div className="text-xs font-normal text-muted-foreground">{doc.docType}</div>
                </TableCell>
                <TableCell>{doc.brand || '—'}</TableCell>
                <TableCell>
                  {doc.equipmentHint === 'INVERTER'
                    ? 'Inversor'
                    : doc.equipmentHint === 'MODULE'
                      ? 'Módulo'
                      : 'Outro'}
                </TableCell>
                <Can permission="platform.catalog.manage">
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={read.isPending}
                      onClick={() => read.mutate(doc.id)}
                    >
                      Ver prévia e importar
                    </Button>
                  </TableCell>
                </Can>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {preview ? (
        <ImportDialog
          open
          onOpenChange={(open) => !open && setPreview(null)}
          defaultKind="INVERTER"
          initialPreview={preview}
        />
      ) : null}
    </div>
  );
}

const EQUIPMENT_LABEL: Record<string, string> = {
  MODULE: 'Módulo',
  INVERTER: 'Inversor',
  PROTECTION: 'Proteção',
  CABLE: 'Cabo',
  BATTERY: 'Bateria',
  CHARGE_CONTROLLER: 'Controlador de carga',
  OFFGRID_INVERTER: 'Inversor off-grid',
  GENERATOR: 'Gerador',
  OTHER: 'Outro',
};
const CONFIDENCE_BADGE = { HIGH: 'green', MEDIUM: 'yellow', LOW: 'secondary' } as const;
const CONFIDENCE_LABEL = { HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa' } as const;

/** Fontes da empresa: o endereço colado é analisado e os arquivos (PDF, CSV, PAN, OND) são catalogados. */
function LinkSources({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const links = useQuery({
    queryKey: queryKeys.catalogSourceLinks,
    queryFn: () => endpoints.catalog.sourceLinks(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.catalogSourceLinks });
  const add = useMutation({
    mutationFn: () => endpoints.catalog.addSourceLink({ url, ...(label ? { label } : {}) }),
    onSuccess: async (link) => {
      toast.success(
        link.status === 'ERROR'
          ? 'Fonte cadastrada, mas não achei arquivos.'
          : `Fonte analisada: ${link.documentCount} arquivo(s) em ${link.pagesRead || 1} página(s).`,
      );
      setUrl('');
      setLabel('');
      await refresh();
      onSelect(`link:${link.id}`);
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível cadastrar a fonte.')),
  });
  const analyze = useMutation({
    mutationFn: (id: string) => endpoints.catalog.analyzeSourceLink(id),
    onSuccess: async () => {
      toast.success('Fonte analisada de novo.');
      await queryClient.invalidateQueries({ queryKey: ['catalog', 'source-links'] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível analisar.')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => endpoints.catalog.removeSourceLink(id),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível remover.')),
  });

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <h3 className="font-medium">Suas fontes (por link)</h3>
        <p className="text-sm text-muted-foreground">
          Cole o endereço de uma página de downloads de um fabricante ou distribuidor, ou de um
          arquivo (PDF, CSV, PAN, OND). O sistema lê a página, encontra os arquivos, entende o que
          cada um parece ser (ficha técnica, manual, certificado; módulo, inversor, cabo, proteção)
          e mostra o porquê. <strong>Você escolhe</strong> o que importar.
        </p>
      </div>
      <Can permission="platform.catalog.manage">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) add.mutate();
          }}
        >
          <div className="grid min-w-72 flex-1 gap-1">
            <Label htmlFor="link-url">Endereço (link)</Label>
            <Input
              id="link-url"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="link-label">Nome (opcional)</Label>
            <Input id="link-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button type="submit" disabled={add.isPending || !url.trim()}>
            {add.isPending ? <Spinner /> : null} Adicionar e analisar
          </Button>
        </form>
      </Can>
      {links.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : links.data && links.data.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Fontes cadastradas por link">
          {links.data.map((link) => (
            <li
              key={link.id}
              className={`space-y-2 rounded-lg border p-3 ${selected === `link:${link.id}` ? 'border-primary' : ''}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-medium">{link.label}</h4>
                <Badge variant={link.status === 'ERROR' ? 'red' : 'green'}>
                  {link.status === 'ERROR' ? 'Sem arquivos' : 'Analisada'}
                </Badge>
              </div>
              <p className="text-xs break-all text-muted-foreground">{link.url}</p>
              <p className="text-xs text-muted-foreground">
                {link.documentCount} arquivo(s)
                {Object.entries(link.byEquipment)
                  .map(([k, n]) => ` · ${n} ${EQUIPMENT_LABEL[k]?.toLowerCase() ?? k}`)
                  .join('')}
                {link.lastAnalyzedAt ? ` · analisada em ${formatDate(link.lastAnalyzedAt)}` : ''}
              </p>
              {link.lastError ? <p className="text-xs text-destructive">{link.lastError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onSelect(`link:${link.id}`)}>
                  Buscar nesta fonte
                </Button>
                <Can permission="platform.catalog.manage">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={analyze.isPending}
                    onClick={() => analyze.mutate(link.id)}
                  >
                    Analisar de novo
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remover ${link.label}`}
                    onClick={() => remove.mutate(link.id)}
                  >
                    Remover
                  </Button>
                </Can>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma fonte cadastrada ainda.</p>
      )}
    </div>
  );
}

function LinkDocuments({ linkId }: { linkId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [equipment, setEquipment] = useState('');
  const [preview, setPreview] = useState<{ preview: ImportPreviewDto; kind: EquipmentKind } | null>(
    null,
  );
  const filters = {
    search: search || undefined,
    equipment: (equipment || undefined) as never,
    page: 1,
    pageSize: 25,
  };
  const list = useQuery({
    queryKey: queryKeys.catalogLinkDocuments(linkId, filters),
    queryFn: () => endpoints.catalog.linkDocuments(linkId, filters),
  });
  const read = useMutation({
    mutationFn: async (doc: CatalogLinkDocumentDto) => {
      const kind = (doc.equipmentHint === 'OTHER' ? 'MODULE' : doc.equipmentHint) as EquipmentKind;
      return { preview: await endpoints.catalog.previewLinkDocument(doc.id, kind), kind };
    },
    onSuccess: (result) => setPreview(result),
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível ler o arquivo.')),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-56 gap-1">
          <Label htmlFor="ld-search">Buscar nos arquivos da fonte</Label>
          <Input
            id="ld-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Marca ou modelo"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ld-equipment">Tipo</Label>
          <NativeSelect
            id="ld-equipment"
            value={equipment}
            onChange={(e) => setEquipment(e.target.value)}
          >
            <option value="">Todos</option>
            {Object.entries(EQUIPMENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {list.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : list.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os arquivos.</p>
      ) : list.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum arquivo encontrado.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Arquivo</TableHead>
              <TableHead>O que parece ser</TableHead>
              <TableHead>Confiança</TableHead>
              <Can permission="platform.catalog.manage">
                <TableHead className="text-right">Ações</TableHead>
              </Can>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.data.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="font-medium">
                  {doc.title}
                  <div className="text-xs font-normal text-muted-foreground">
                    {doc.brand || 'marca não identificada'} · .{doc.fileType.toUpperCase()}
                  </div>
                </TableCell>
                <TableCell>
                  {EQUIPMENT_LABEL[doc.equipmentHint]} · {doc.docType.toLowerCase()}
                </TableCell>
                <TableCell>
                  <span title={doc.reasons.join('; ')}>
                    <Badge variant={CONFIDENCE_BADGE[doc.confidence]}>
                      {CONFIDENCE_LABEL[doc.confidence]}
                    </Badge>
                  </span>
                </TableCell>
                <Can permission="platform.catalog.manage">
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={read.isPending}
                      onClick={() => read.mutate(doc)}
                    >
                      Ver prévia e importar
                    </Button>
                  </TableCell>
                </Can>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {preview ? (
        <ImportDialog
          open
          onOpenChange={(open) => !open && setPreview(null)}
          defaultKind={preview.kind}
          initialPreview={preview.preview}
          onCreated={() => void queryClient.invalidateQueries({ queryKey: queryKeys.catalog() })}
        />
      ) : null}
    </div>
  );
}

function References() {
  const [source, setSource] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Fontes de equipamentos</CardTitle>
          <CardDescription>
            Bibliotecas e sites públicos de onde você pode trazer fichas técnicas. Você escolhe uma,
            busca, confere a prévia e <strong>só então importa</strong>: tudo entra como rascunho,
            aguardando a aprovação do responsável técnico. A ligação de cada fonte é feita no
            servidor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SourceCards selected={source} onSelect={setSource} />
          <LinkSources selected={source} onSelect={setSource} />
          {source?.startsWith('link:') ? (
            <LinkDocuments linkId={source.slice(5)} />
          ) : source && source !== 'cec-library' ? (
            <SourceDocuments source={source} />
          ) : null}
        </CardContent>
      </Card>
      {source === 'cec-library' || source === null ? <CecReferences /> : null}
    </div>
  );
}

function CecReferences() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [adopting, setAdopting] = useState<ExternalReferenceDto | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const filters = { search: search || undefined, page: 1, pageSize: 20 };
  const list = useQuery({
    queryKey: queryKeys.catalogReferences(filters),
    queryFn: () => endpoints.catalog.references(filters),
  });
  const adopt = useMutation({
    mutationFn: (values: EquipmentFormValues) =>
      endpoints.catalog.adopt((adopting as ExternalReferenceDto).id, values.spec),
    onSuccess: async () => {
      toast.success('Adotado como rascunho no seu catálogo.');
      setAdopting(null);
      setServerErrors({});
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalog() });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) toast.error(error.message);
      else {
        setServerErrors(fieldErrors(error));
        toast.error(errorMessage(error, 'Não foi possível adotar.'));
      }
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Referências externas</CardTitle>
        <CardDescription>
          Equipamentos de bibliotecas públicas (como a CEC/SAM, do mercado norte-americano). Você
          escolhe quais <strong>adotar</strong>: viram rascunho no seu catálogo, com a origem
          registrada, e só valem depois de aprovados. Confira se o equipamento é vendido e
          homologado no Brasil.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid max-w-sm gap-1">
          <Label htmlFor="ref-search">Buscar</Label>
          <Input
            id="ref-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Fabricante ou modelo"
          />
        </div>
        {list.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : list.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as referências.</p>
        ) : list.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma referência carregada. A biblioteca CEC/SAM só é carregada quando a fonte é
            ligada no servidor, depois de conferida a licença (veja <strong>Fontes de dados</strong>
            ).
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipamento</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Coletado em</TableHead>
                <Can permission="platform.catalog.manage">
                  <TableHead className="text-right">Ações</TableHead>
                </Can>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.data.map((ref) => (
                <TableRow key={ref.id}>
                  <TableCell className="font-medium">
                    {ref.manufacturer} {ref.model}
                    <div className="text-xs font-normal text-muted-foreground">
                      {ref.attribution}
                    </div>
                  </TableCell>
                  <TableCell>{ref.kind === 'MODULE' ? 'Módulo' : 'Inversor'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(ref.collectedAt)}
                  </TableCell>
                  <Can permission="platform.catalog.manage">
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setAdopting(ref)}>
                        Adotar
                      </Button>
                    </TableCell>
                  </Can>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {adopting ? (
        <EquipmentFormDialog
          open
          onOpenChange={(open) => !open && setAdopting(null)}
          kind={adopting.kind}
          title={`Adotar ${adopting.manufacturer} ${adopting.model}`}
          description="Complete o que a biblioteca não traz (por exemplo, as dimensões do módulo)."
          initial={{
            manufacturer: adopting.manufacturer,
            model: adopting.model,
            spec: adopting.spec,
          }}
          lockIdentity
          submitLabel="Adotar como rascunho"
          pending={adopt.isPending}
          serverErrors={serverErrors}
          onSubmit={(values) => adopt.mutate(values)}
        />
      ) : null}
    </Card>
  );
}

function Prices() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const prices = useQuery({
    queryKey: queryKeys.catalogPrices,
    queryFn: () => endpoints.catalog.prices(),
  });
  const run = useMutation({
    mutationFn: ({ dryRun }: { dryRun: boolean }) =>
      endpoints.catalog.importPrices(file as File, dryRun),
    onSuccess: async (result) => {
      if (result.dryRun) {
        toast.message(
          `${result.rowsRead} linha(s): ${result.rowsRead - result.errors.length - result.unmatched.length} prontas, ${result.unmatched.length} sem equipamento aprovado, ${result.errors.length} com erro.`,
        );
        setReport(result);
      } else {
        toast.success(`${result.created} preço(s) importado(s).`);
        setReport(result);
        setFile(null);
        await queryClient.invalidateQueries({ queryKey: queryKeys.catalogPrices });
      }
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível importar a planilha.')),
  });
  const [report, setReport] = useState<Awaited<
    ReturnType<typeof endpoints.catalog.importPrices>
  > | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tabelas de preço</CardTitle>
        <CardDescription>
          Preços de distribuidores com vigência. Cada linha aponta para um equipamento{' '}
          <strong>aprovado</strong> (fabricante e modelo) ou é um insumo avulso (só descrição).
          Colunas: fabricante; modelo; descricao; fornecedor; sku; preco_reais; vigencia_inicio;
          vigencia_fim.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Can permission="platform.catalog.manage">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="price-file">Planilha (CSV)</Label>
              <Input
                id="price-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setReport(null);
                }}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!file || run.isPending}
              onClick={() => run.mutate({ dryRun: true })}
            >
              Conferir
            </Button>
            <Button
              size="sm"
              disabled={!file || run.isPending}
              onClick={() => run.mutate({ dryRun: false })}
            >
              {run.isPending ? <Spinner /> : null}
              Importar
            </Button>
          </div>
        </Can>
        {report ? (
          <div className="space-y-1 rounded border p-3 text-sm">
            <p>
              {report.dryRun ? 'Conferência' : 'Importação'}: {report.rowsRead} linha(s) lidas,{' '}
              {report.created} criadas.
            </p>
            {report.unmatched.map((u) => (
              <p key={u.row} className="text-muted-foreground">
                Linha {u.row}: {u.manufacturer} {u.model} não está aprovado no catálogo.
              </p>
            ))}
            {report.errors.map((e) => (
              <p key={e.row} className="text-destructive">
                Linha {e.row}: {e.message}
              </p>
            ))}
          </div>
        ) : null}
        {prices.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : prices.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os preços.</p>
        ) : prices.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum preço cadastrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Preço</TableHead>
                <TableHead>Vigência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prices.data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.description}</TableCell>
                  <TableCell>{p.supplier}</TableCell>
                  <TableCell className="tabular-nums">
                    {(p.priceCents / 100).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(p.validFrom)}
                    {p.validTo ? ` a ${formatDate(p.validTo)}` : ' em diante'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function CatalogPage() {
  return (
    <Tabs defaultValue="MODULE" className="space-y-4">
      <TabsList className="flex-wrap">
        {KINDS.map((k) => (
          <TabsTrigger key={k} value={k}>
            {KIND_LABELS[k]}
          </TabsTrigger>
        ))}
        <TabsTrigger value="references">Referências externas</TabsTrigger>
        <TabsTrigger value="prices">Preços</TabsTrigger>
      </TabsList>
      {KINDS.map((k) => (
        <TabsContent key={k} value={k}>
          <EquipmentList kind={k} />
        </TabsContent>
      ))}
      <TabsContent value="references">
        <References />
      </TabsContent>
      <TabsContent value="prices">
        <Prices />
      </TabsContent>
    </Tabs>
  );
}
