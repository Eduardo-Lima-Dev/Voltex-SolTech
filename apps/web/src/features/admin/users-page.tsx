import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus, Pencil, Search, Trash2, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from '@voltex/ui';
import { canManageRole, Role, type InvitationDto, type UserSummary } from '@voltex/shared';
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  NativeSelect,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  initialsOf,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { Pagination } from '@/components/pagination';
import { useAuth, useCurrentUser } from '@/features/auth/auth-provider';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { INVITATION_STATUS_LABELS, ROLE_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDate, formatDateTime, formatRelativeTime } from '@/lib/format';
import { ConfirmDialog } from './company/confirm-delete';
import { EditUserDialog } from './users/edit-user-dialog';
import { InviteDialog } from './users/invite-dialog';
import { queryKeys } from './query-keys';

const PAGE_SIZE = 10;

function InvitationsCard() {
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.invitations,
    queryFn: endpoints.invitations.list,
  });
  const [revoking, setRevoking] = useState<InvitationDto | null>(null);

  const revoke = useMutation({
    mutationFn: (id: string) => endpoints.invitations.revoke(id),
    onSuccess: async () => {
      toast.success('Convite revogado');
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível revogar o convite.')),
  });

  const badgeVariant = {
    PENDING: 'yellow',
    ACCEPTED: 'green',
    REVOKED: 'secondary',
    EXPIRED: 'outline',
  } as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Convites</CardTitle>
        <CardDescription>Convites enviados e o estado de cada um.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os convites.</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum convite enviado ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead className="w-16 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell className="font-medium">{invitation.email}</TableCell>
                  <TableCell>{ROLE_LABELS[invitation.role]}</TableCell>
                  <TableCell>
                    <Badge variant={badgeVariant[invitation.status]}>
                      {INVITATION_STATUS_LABELS[invitation.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(invitation.expiresAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {invitation.status === 'PENDING' ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Revogar convite de ${invitation.email}`}
                        onClick={() => setRevoking(invitation)}
                      >
                        <UserX />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revogar convite?"
        description={
          <>
            O link enviado para <strong>{revoking?.email}</strong> deixará de funcionar.
          </>
        }
        confirmLabel="Revogar"
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </Card>
  );
}

export function UsersPage() {
  const me = useCurrentUser();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canManage = can('platform.user.manage');

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'' | Role>('');
  const [status, setStatus] = useState<'all' | 'true' | 'false'>('all');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim());

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [deleting, setDeleting] = useState<UserSummary | null>(null);

  const filters = { page, search: debouncedSearch, role, status };
  const users = useQuery({
    queryKey: queryKeys.users(filters),
    queryFn: () =>
      endpoints.users.list({
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        role: role || undefined,
        isActive: status === 'all' ? undefined : status === 'true',
      }),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (id: string) => endpoints.users.remove(id),
    onSuccess: async () => {
      toast.success('Usuário excluído');
      await queryClient.invalidateQueries({ queryKey: queryKeys.users() });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível excluir o usuário.')),
  });

  const manageable = (user: UserSummary) =>
    canManage && user.id !== me.id && canManageRole(me.role, user.role);
  const resetPage =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-col items-start justify-between gap-3 space-y-0 sm:flex-row sm:gap-4">
          <div className="space-y-1.5">
            <CardTitle>Usuários</CardTitle>
            <CardDescription>Pessoas com acesso à sua empresa na suíte.</CardDescription>
          </div>
          <Can permission="platform.user.manage">
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <MailPlus /> Convidar usuário
            </Button>
          </Can>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem_10rem]">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                className="pl-9"
                placeholder="Buscar por nome ou e-mail"
                aria-label="Buscar usuários"
                value={search}
                onChange={(e) => resetPage(setSearch)(e.target.value)}
              />
            </div>
            <NativeSelect
              aria-label="Filtrar por perfil"
              value={role}
              onChange={(e) => resetPage(setRole)(e.target.value as '' | Role)}
            >
              <option value="">Todos os perfis</option>
              {Object.values(Role).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por situação"
              value={status}
              onChange={(e) => resetPage(setStatus)(e.target.value as 'all' | 'true' | 'false')}
            >
              <option value="all">Todos</option>
              <option value="true">Ativos</option>
              <option value="false">Inativos</option>
            </NativeSelect>
          </div>

          {users.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : users.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar os usuários.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Último acesso</TableHead>
                    <TableHead className="w-24 text-right">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.data.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        Nenhum usuário encontrado com esses filtros.
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.data.data.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {user.name}
                                {user.id === me.id ? (
                                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    (você)
                                  </span>
                                ) : null}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {user.email}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{ROLE_LABELS[user.role]}</TableCell>
                        <TableCell>
                          <Badge variant={user.isActive ? 'green' : 'secondary'}>
                            {user.isActive ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className="text-muted-foreground"
                          title={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : undefined}
                        >
                          {user.lastLoginAt ? formatRelativeTime(user.lastLoginAt) : 'Nunca entrou'}
                        </TableCell>
                        <TableCell className="text-right">
                          {manageable(user) ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Editar ${user.name}`}
                                onClick={() => setEditing(user)}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Excluir ${user.name}`}
                                onClick={() => setDeleting(user)}
                              >
                                <Trash2 />
                              </Button>
                            </>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <Pagination
                page={users.data.meta.page}
                pageSize={users.data.meta.pageSize}
                total={users.data.meta.total}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Can permission="platform.user.manage">
        <InvitationsCard />
      </Can>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <EditUserDialog user={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir usuário?"
        description={
          <>
            <strong>{deleting?.name}</strong> perderá o acesso imediatamente. Os registros de
            auditoria dessa pessoa são mantidos.
          </>
        }
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
