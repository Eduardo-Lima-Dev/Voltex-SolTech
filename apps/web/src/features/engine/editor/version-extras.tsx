import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, NativeSelect } from '@voltex/ui';
import { queryKeys } from '@/features/admin/query-keys';
import { useAuth } from '@/features/auth/auth-provider';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';

const DELIVERABLES = [
  { file: 'report.pdf', label: 'Memorial técnico (PDF)', name: 'memorial-tecnico.pdf' },
  { file: 'single-line.pdf', label: 'Unifilar (PDF)', name: 'unifilar.pdf' },
  { file: 'single-line.svg', label: 'Unifilar (SVG)', name: 'unifilar.svg' },
  { file: 'single-line.dxf', label: 'Unifilar (DXF)', name: 'unifilar.dxf' },
] as const;

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Baixa memorial e unifilar. Antes da aprovação trazem marca de rascunho. */
export function DeliverablesPanel({
  versionId,
  approved = false,
}: {
  versionId: string;
  approved?: boolean;
}) {
  const { can } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [attachedMessage, setAttachedMessage] = useState<string | null>(null);
  const attach = useMutation({
    mutationFn: () => endpoints.engineering.attachHomologation(versionId),
    onMutate: () => {
      setError(null);
      setAttachedMessage(null);
    },
    onSuccess: (r) =>
      setAttachedMessage(
        r.attached.length
          ? `Anexado ao checklist de homologação: ${r.attached.map((a) => a.code).join(', ')}.`
          : 'Nada novo para anexar: os itens já têm documento.',
      ),
    onError: (e) => setError(errorMessage(e)),
  });
  const download = useMutation({
    mutationFn: async (item: (typeof DELIVERABLES)[number]) =>
      saveBlob(await endpoints.engineering.deliverable(versionId, item.file), item.name),
    onMutate: () => setError(null),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <section className="space-y-2 rounded border p-4" aria-label="Entregáveis">
      <h3 className="font-medium">Entregáveis</h3>
      <p className="text-sm text-muted-foreground">
        Até a aprovação, os arquivos saem marcados como rascunho e não substituem o projeto elétrico
        assinado.
      </p>
      <div className="flex flex-wrap gap-2">
        {DELIVERABLES.map((item) => (
          <Button
            key={item.file}
            variant="outline"
            size="sm"
            disabled={download.isPending}
            onClick={() => download.mutate(item)}
          >
            {item.label}
          </Button>
        ))}
        {approved && can('engine.project.write') ? (
          <Button size="sm" disabled={attach.isPending} onClick={() => attach.mutate()}>
            Anexar à homologação
          </Button>
        ) : null}
      </div>
      {attachedMessage ? <p className="text-sm">{attachedMessage}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const KIND_LABEL = { ADDED: 'incluído', REMOVED: 'removido', CHANGED: 'alterado' } as const;
const show = (value: unknown): string =>
  value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);

/** Compara esta versão com outra do mesmo projeto: o que mudou no desenho e nos indicadores. */
export function ComparePanel({ versionId, projectId }: { versionId: string; projectId: string }) {
  const [other, setOther] = useState('');
  const project = useQuery({
    queryKey: queryKeys.engineeringProject(projectId),
    queryFn: () => endpoints.engineering.project(projectId),
  });
  const compare = useQuery({
    queryKey: [...queryKeys.engineeringVersion(versionId), 'compare', other],
    queryFn: () => endpoints.engineering.compare(versionId, other),
    enabled: Boolean(other),
  });
  const others = (project.data?.versions ?? []).filter((v) => v.id !== versionId);
  if (others.length === 0) return null;
  return (
    <section className="space-y-3 rounded border p-4" aria-label="Comparação de versões">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-medium">Comparar com outra versão</h3>
        <NativeSelect
          aria-label="Versão para comparar"
          value={other}
          onChange={(event) => setOther(event.target.value)}
        >
          <option value="">Escolha…</option>
          {others.map((v) => (
            <option key={v.id} value={v.id}>
              Versão {v.number}
            </option>
          ))}
        </NativeSelect>
      </div>
      {compare.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(compare.error)}
        </p>
      ) : null}
      {compare.data ? (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Da versão {compare.data.from.number} para a versão {compare.data.to.number}.
          </p>
          {compare.data.resultChanges.length === 0 ? (
            <p>Os indicadores são iguais.</p>
          ) : (
            <table className="w-full text-left">
              <caption className="mb-1 text-left font-medium">Indicadores</caption>
              <thead>
                <tr>
                  <th>Indicador</th>
                  <th>Antes</th>
                  <th>Depois</th>
                  <th>Diferença</th>
                </tr>
              </thead>
              <tbody>
                {compare.data.resultChanges.map((c) => (
                  <tr key={c.metric}>
                    <td>{c.label}</td>
                    <td>{show(c.before ?? undefined)}</td>
                    <td>{show(c.after ?? undefined)}</td>
                    <td>{c.delta === null ? '—' : formatNumber(c.delta, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {compare.data.designChanges.length === 0 ? (
            <p>O desenho é igual.</p>
          ) : (
            <table className="w-full text-left">
              <caption className="mb-1 text-left font-medium">Desenho</caption>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Mudança</th>
                  <th>Antes</th>
                  <th>Depois</th>
                </tr>
              </thead>
              <tbody>
                {compare.data.designChanges.map((c) => (
                  <tr key={c.path}>
                    <td className="font-mono text-xs">{c.path}</td>
                    <td>{KIND_LABEL[c.kind]}</td>
                    <td>{show(c.before)}</td>
                    <td>{show(c.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {compare.data.truncated ? (
            <p className="text-muted-foreground">
              Lista cortada: há mais mudanças que as exibidas.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Links do relatório técnico para o cliente final (só versão aprovada). */
export function ShareLinksPanel({ versionId }: { versionId: string }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<string | null>(null);
  const key = [...queryKeys.engineeringVersion(versionId), 'share-links'];
  const links = useQuery({
    queryKey: key,
    queryFn: () => endpoints.engineering.shareLinks(versionId),
  });
  const create = useMutation({
    mutationFn: () => endpoints.engineering.createShareLink(versionId, 30),
    onSuccess: (link) => {
      setCreated(`${window.location.origin}${link.path}`);
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => endpoints.engineering.revokeShareLink(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return (
    <section className="space-y-3 rounded border p-4" aria-label="Relatório para o cliente">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">Relatório para o cliente</h3>
          <p className="text-sm text-muted-foreground">
            Resumo do projeto aprovado, sem custos nem margem. O endereço aparece só uma vez.
          </p>
        </div>
        {can('engine.project.write') ? (
          <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
            Gerar link (30 dias)
          </Button>
        ) : null}
      </div>
      {create.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(create.error)}
        </p>
      ) : null}
      {created ? (
        <p className="break-all rounded border bg-muted p-2 text-sm">
          Copie agora: <strong>{created}</strong>
        </p>
      ) : null}
      <ul className="space-y-1 text-sm">
        {(links.data ?? []).map((link) => (
          <li key={link.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Criado em {formatDateTime(link.createdAt)} · válido até{' '}
              {formatDateTime(link.expiresAt)} · {link.viewCount} visualização(ões)
            </span>
            {link.revokedAt ? (
              <Badge variant="outline">revogado</Badge>
            ) : can('engine.project.write') ? (
              <Button size="sm" variant="outline" onClick={() => revoke.mutate(link.id)}>
                Revogar
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
