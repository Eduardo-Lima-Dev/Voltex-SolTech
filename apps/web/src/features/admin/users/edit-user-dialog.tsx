import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '@voltex/ui';
import { assignableRoles, type Role, type UpdateUserInput, type UserSummary } from '@voltex/shared';
import {
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
  Switch,
} from '@voltex/ui';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { ROLE_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { queryKeys } from '../query-keys';

interface EditUserDialogProps {
  user: UserSummary | null;
  onOpenChange: (open: boolean) => void;
}

export function EditUserDialog({ user, onOpenChange }: EditUserDialogProps) {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const open = user !== null;
  const branches = useQuery({
    queryKey: queryKeys.branches,
    queryFn: endpoints.branches.list,
    enabled: open,
  });
  const teams = useQuery({
    queryKey: queryKeys.teams,
    queryFn: endpoints.teams.list,
    enabled: open,
  });

  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('SDR');
  const [isActive, setIsActive] = useState(true);
  const [branchId, setBranchId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setRole(user.role);
    setIsActive(user.isActive);
    setBranchId(user.branchId ?? '');
    setTeamId(user.teamId ?? '');
    setNameError(null);
  }, [user]);

  const mutation = useMutation({
    mutationFn: (input: UpdateUserInput) => endpoints.users.update((user as UserSummary).id, input),
    onSuccess: async () => {
      toast.success('Usuário atualizado');
      await queryClient.invalidateQueries({ queryKey: queryKeys.users() });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível atualizar o usuário.')),
  });

  if (!user) return <Dialog open={false} onOpenChange={onOpenChange} />;

  const roles = assignableRoles(me.role);
  const isSelf = user.id === me.id;

  const submit = () => {
    if (name.trim().length < 2) {
      setNameError('Informe o nome (mínimo de 2 caracteres)');
      return;
    }
    // Envia só o que mudou: a API audita antes/depois e evita sobrescrever dados sem necessidade.
    const input: UpdateUserInput = {};
    if (name.trim() !== user.name) input.name = name.trim();
    if (role !== user.role) input.role = role;
    if (isActive !== user.isActive) input.isActive = isActive;
    if ((branchId || null) !== user.branchId) input.branchId = branchId || null;
    if ((teamId || null) !== user.teamId) input.teamId = teamId || null;
    if (Object.keys(input).length === 0) {
      onOpenChange(false);
      return;
    }
    mutation.mutate(input);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="edit-name">Nome</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={nameError !== null}
              autoFocus
            />
            {nameError ? (
              <p className="text-sm text-destructive" role="alert">
                {nameError}
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit-role">Perfil</Label>
            <NativeSelect
              id="edit-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              disabled={isSelf}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </NativeSelect>
            {isSelf ? (
              <p className="text-xs text-muted-foreground">
                Você não pode alterar o próprio perfil.
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="edit-branch">Filial</Label>
              <NativeSelect
                id="edit-branch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                <option value="">Sem filial</option>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-team">Time</Label>
              <NativeSelect
                id="edit-team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">Sem time</option>
                {teams.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="edit-active">Usuário ativo</Label>
              <p className="text-xs text-muted-foreground">
                Usuários inativos não conseguem entrar e perdem as sessões abertas.
              </p>
            </div>
            <Switch
              id="edit-active"
              checked={isActive}
              onCheckedChange={setIsActive}
              disabled={isSelf}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
