import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Role, type MfaSetupDto } from '@voltex/shared';
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
  Skeleton,
  Switch,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { MfaSetupForm, RecoveryCodes } from '@/features/auth/mfa-parts';
import { ROLE_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api';

const STATUS_KEY = ['mfa', 'status'];

function AccountMfaCard() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: endpoints.auth.mfa.status });
  const [setup, setSetup] = useState<MfaSetupDto | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: STATUS_KEY });

  const start = useMutation({
    mutationFn: endpoints.auth.mfa.setup,
    onSuccess: setSetup,
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível iniciar o cadastro.')),
  });
  const confirm = useMutation({
    mutationFn: (value: string) => endpoints.auth.mfa.confirm({ code: value }),
    onSuccess: async (result) => {
      setSetup(null);
      setCodes(result.recoveryCodes);
      await refresh();
    },
  });
  const disable = useMutation({
    mutationFn: () => endpoints.auth.mfa.disable({ password, code: code.trim() }),
    onSuccess: async () => {
      toast.success('Verificação em duas etapas desativada.');
      setPassword('');
      setCode('');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível desativar.')),
  });

  if (status.isPending) return <Skeleton className="h-40 w-full" />;
  if (status.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível carregar a segurança da conta.
      </p>
    );
  const s = status.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Verificação em duas etapas
          <Badge variant={s.enabled ? 'green' : 'outline'}>
            {s.enabled ? 'Ativa' : 'Desativada'}
          </Badge>
        </CardTitle>
        <CardDescription>
          Além da senha, o login pede um código do aplicativo autenticador no seu celular.
          {s.required ? ' A sua empresa exige este recurso para o seu perfil.' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {codes ? (
          <RecoveryCodes
            codes={codes}
            onDone={() => {
              setCodes(null);
              toast.success('Verificação em duas etapas ativada.');
            }}
          />
        ) : setup ? (
          <MfaSetupForm
            setup={setup}
            busy={confirm.isPending}
            error={
              confirm.isError
                ? errorMessage(confirm.error, 'Código incorreto. Tente de novo.')
                : null
            }
            onConfirm={(value) => confirm.mutate(value)}
          />
        ) : s.enabled ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Códigos de recuperação restantes: <strong>{s.recoveryCodesLeft}</strong>
            </p>
            {s.required ? (
              <p className="text-sm text-muted-foreground">
                Não é possível desativar enquanto a política da empresa exigir.
              </p>
            ) : (
              <form
                className="grid max-w-sm gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  disable.mutate();
                }}
              >
                <div className="grid gap-1.5">
                  <Label htmlFor="mfa-off-password">Sua senha</Label>
                  <Input
                    id="mfa-off-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mfa-off-code">Código do aplicativo ou de recuperação</Label>
                  <Input
                    id="mfa-off-code"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={disable.isPending || !password || code.trim().length < 6}
                >
                  Desativar
                </Button>
              </form>
            )}
          </div>
        ) : (
          <Button disabled={start.isPending} onClick={() => start.mutate()}>
            Ativar verificação em duas etapas
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CompanyPolicyCard() {
  const queryClient = useQueryClient();
  const policy = useQuery({ queryKey: ['mfa', 'policy'], queryFn: endpoints.auth.mfa.policy });
  const [draft, setDraft] = useState<{ required: boolean; roles: string[] } | null>(null);
  const current = draft ?? policy.data ?? { required: false, roles: [] };
  const save = useMutation({
    mutationFn: () =>
      endpoints.auth.mfa.setPolicy({ required: current.required, roles: current.roles as Role[] }),
    onSuccess: async () => {
      toast.success('Política salva. Vale a partir do próximo login de cada pessoa.');
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['mfa', 'policy'] });
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível salvar a política.')),
  });
  if (policy.isPending) return <Skeleton className="h-32 w-full" />;
  const toggleRole = (role: string) =>
    setDraft({
      ...current,
      roles: current.roles.includes(role)
        ? current.roles.filter((r) => r !== role)
        : [...current.roles, role],
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Política da empresa</CardTitle>
        <CardDescription>
          Quem a empresa obriga a usar a verificação em duas etapas. Quem ainda não tem o aplicativo
          cadastra no próprio login.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <Label htmlFor="mfa-required">Exigir a verificação em duas etapas</Label>
          <Switch
            id="mfa-required"
            checked={current.required}
            onCheckedChange={(required) => setDraft({ ...current, required })}
          />
        </div>
        {current.required ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Perfis (nenhum marcado = todos)</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.values(Role).map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={current.roles.includes(role)}
                    onChange={() => toggleRole(role)}
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <Button disabled={save.isPending || draft === null} onClick={() => save.mutate()}>
          Salvar política
        </Button>
      </CardContent>
    </Card>
  );
}

/** Segurança da conta: verificação em duas etapas do próprio usuário e, para administradores, a política da empresa. */
export function SecurityPage() {
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Segurança da conta</h2>
        <p className="text-muted-foreground">Proteja o seu acesso à plataforma.</p>
      </header>
      <AccountMfaCard />
      <Can permission="platform.tenant.manage">
        <CompanyPolicyCard />
      </Can>
    </div>
  );
}
