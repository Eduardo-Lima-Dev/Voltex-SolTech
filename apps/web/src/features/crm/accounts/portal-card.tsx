import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ContactDto, PortalAccessDto, PortalLinkDto } from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { SendMessage } from '@/components/send-message';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/** Acesso do cliente ao portal (link mágico): liberar por e-mail, gerar link e enviar por e-mail, WhatsApp ou cópia. */
export function PortalCard({
  accountId,
  accountName,
  contacts,
}: {
  accountId: string;
  accountName: string;
  contacts: ContactDto[];
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [links, setLinks] = useState<Record<string, PortalLinkDto>>({});
  const key = ['portal-access', accountId];
  const accesses = useQuery({
    queryKey: key,
    queryFn: () => endpoints.portalAccess.list(accountId),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const grant = useMutation({
    mutationFn: () => endpoints.portalAccess.create({ accountId, email: email.trim() }),
    onSuccess: async () => {
      toast.success('Acesso liberado. Gere um link para enviar ao cliente.');
      setEmail('');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível liberar o acesso.')),
  });
  const link = useMutation({
    mutationFn: (id: string) => endpoints.portalAccess.link(id),
    onSuccess: (result, id) => setLinks((prev) => ({ ...prev, [id]: result })),
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível gerar o link.')),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => endpoints.portalAccess.deactivate(id),
    onSuccess: async () => {
      toast.success('Acesso desativado. As sessões abertas foram encerradas.');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível desativar.')),
  });
  const phoneOf = (access: PortalAccessDto) =>
    contacts.find((c) => c.email?.toLowerCase() === access.email)?.phone;

  return (
    <Can permission="crm.portal.manage">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Portal do cliente</CardTitle>
          <CardDescription>
            O cliente acompanha o projeto sem senha, por um link que vale 30 minutos e abre uma
            única vez.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {accesses.isPending ? <Skeleton className="h-10 w-full" /> : null}
          <ul className="space-y-3" aria-label="Acessos ao portal">
            {accesses.data?.map((a) => (
              <li key={a.id} className="space-y-2 rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {a.email}{' '}
                    <Badge variant={a.active ? 'green' : 'outline'}>
                      {a.active ? 'Ativo' : 'Desativado'}
                    </Badge>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {a.lastLoginAt
                        ? `último acesso ${formatDateTime(a.lastLoginAt)}`
                        : 'nunca acessou'}
                    </span>
                  </span>
                  {a.active ? (
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={link.isPending}
                        onClick={() => link.mutate(a.id)}
                      >
                        Gerar link
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(a.id)}
                      >
                        Desativar
                      </Button>
                    </span>
                  ) : null}
                </div>
                {links[a.id] ? (
                  <div className="space-y-2">
                    <p className="break-all rounded bg-muted p-2 font-mono text-xs">
                      {links[a.id]!.url}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Vale até {formatDateTime(links[a.id]!.expiresAt)} e abre uma única vez.
                    </p>
                    <SendMessage
                      template="portal.access"
                      variables={{ nome: accountName, link: links[a.id]!.url }}
                      email={a.email}
                      phone={phoneOf(a)}
                      entityType="PortalAccess"
                      entityId={a.id}
                      accountId={accountId}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              grant.mutate();
            }}
          >
            <div className="grid gap-1.5">
              <label htmlFor="portal-grant-email" className="text-sm font-medium">
                Liberar acesso para o e-mail
              </label>
              <Input
                id="portal-grant-email"
                type="email"
                list="portal-contact-emails"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <datalist id="portal-contact-emails">
                {contacts
                  .filter((c) => c.email)
                  .map((c) => (
                    <option key={c.id} value={c.email!} />
                  ))}
              </datalist>
            </div>
            <Button type="submit" disabled={grant.isPending || !email.trim()}>
              Liberar
            </Button>
          </form>
        </CardContent>
      </Card>
    </Can>
  );
}
