import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  loginSchema,
  type LoginInput,
  type MfaChallengeDto,
  type MfaSetupDto,
  type SessionResponse,
} from '@voltex/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Spinner,
} from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import { AuthLayout } from './auth-layout';
import { useAuth } from './auth-provider';
import { MfaSetupForm, RecoveryCodes } from './mfa-parts';

function loginErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 401) return 'E-mail ou senha incorretos.';
    if (error.status === 429)
      return 'Muitas tentativas de login. Aguarde um minuto e tente de novo.';
    if (error.isNetworkError)
      return 'Não foi possível conectar ao sistema. Verifique sua conexão com a internet.';
    if (error.status >= 500)
      return 'O sistema encontrou um problema. Tente novamente em instantes.';
  }
  return 'Não foi possível entrar. Tente novamente.';
}

function mfaErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 401)
      return 'Código incorreto ou já usado. Confira o aplicativo e tente de novo.';
    if (error.status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    if (error.status === 422) return error.message;
  }
  return 'Não foi possível confirmar o código. Tente novamente.';
}

/** Segunda etapa do login: código do aplicativo (ou de recuperação). */
function MfaCodeStep({
  challenge,
  onSession,
  onBack,
}: {
  challenge: MfaChallengeDto;
  onSession: (session: SessionResponse) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onSession(
            await endpoints.auth.mfa.verify({ mfaToken: challenge.mfaToken, code: code.trim() }),
          );
        } catch (e) {
          setError(mfaErrorMessage(e));
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        Abra o aplicativo autenticador e informe o código de 6 dígitos. Sem o aparelho, use um
        código de recuperação.
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="mfa-code" className="text-sm font-medium">
          Código
        </label>
        <Input
          id="mfa-code"
          autoComplete="one-time-code"
          inputMode="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
      </div>
      <Button
        type="submit"
        className="h-11 w-full rounded-full"
        disabled={busy || code.trim().length < 6}
      >
        {busy ? <Spinner /> : null}
        Verificar
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
        Voltar
      </Button>
    </form>
  );
}

/** A empresa exige o segundo fator e o usuário ainda não tem aplicativo: cadastra aqui, antes de entrar. */
function MfaEnrollStep({
  challenge,
  onSession,
  onBack,
}: {
  challenge: MfaChallengeDto;
  onSession: (session: SessionResponse) => void;
  onBack: () => void;
}) {
  const [setup, setSetup] = useState<MfaSetupDto | null>(null);
  const [done, setDone] = useState<{ session: SessionResponse; codes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    endpoints.auth.mfa
      .loginSetup(challenge.mfaToken)
      .then(setSetup)
      .catch((e: unknown) => setError(mfaErrorMessage(e)));
  }, [challenge.mfaToken]);

  if (done) return <RecoveryCodes codes={done.codes} onDone={() => onSession(done.session)} />;
  if (!setup)
    return (
      <div className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <Spinner />
        )}
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          Voltar
        </Button>
      </div>
    );
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Sua empresa exige a verificação em duas etapas. Cadastre o aplicativo autenticador para
        entrar.
      </p>
      <MfaSetupForm
        setup={setup}
        busy={busy}
        error={error}
        onConfirm={async (code) => {
          setBusy(true);
          setError(null);
          try {
            const { recoveryCodes, ...session } = await endpoints.auth.mfa.loginConfirm({
              mfaToken: challenge.mfaToken,
              code,
            });
            setDone({ session, codes: recoveryCodes });
          } catch (e) {
            setError(mfaErrorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
        Voltar
      </Button>
    </div>
  );
}

const SITE_URL = (import.meta.env.VITE_SITE_URL?.trim() || null)?.replace(/\/+$/, '') ?? null;

export function LoginPage() {
  const { login, establishSession } = useAuth();
  const [challenge, setChallenge] = useState<MfaChallengeDto | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const submitting = form.formState.isSubmitting;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      // Ao criar a sessão, o GuestOnly redireciona para a página que o usuário pediu (ou para o início).
      const result = await login(values);
      if (result) setChallenge(result);
    } catch (error) {
      setFormError(loginErrorMessage(error));
    }
  });

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="brand-mono text-xs text-brand-cyan-strong dark:text-brand-cyan">
            Acesso à plataforma
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em]">Entrar na sua conta</h1>
          <p className="text-sm text-muted-foreground">
            Use o e-mail e a senha da sua empresa na Voltex SolTech.
          </p>
        </div>

        {challenge?.status === 'MFA_REQUIRED' ? (
          <MfaCodeStep
            challenge={challenge}
            onSession={establishSession}
            onBack={() => setChallenge(null)}
          />
        ) : null}
        {challenge?.status === 'MFA_SETUP_REQUIRED' ? (
          <MfaEnrollStep
            challenge={challenge}
            onSession={establishSession}
            onBack={() => setChallenge(null)}
          />
        ) : null}

        {challenge ? null : (
          <Form {...form}>
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              {formError ? (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="username"
                        inputMode="email"
                        autoFocus
                        placeholder="voce@empresa.com.br"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          className="pr-10"
                          {...field}
                        />
                      </FormControl>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0.5 top-0.5 size-8"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                        aria-pressed={showPassword}
                      >
                        {showPassword ? <EyeOff /> : <Eye />}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="h-11 w-full rounded-full text-[0.95rem]"
                disabled={submitting}
              >
                {submitting ? <Spinner /> : <LogIn />}
                Entrar
              </Button>
            </form>
          </Form>
        )}

        <p className="text-center text-xs text-muted-foreground">
          O acesso é por convite. Se você ainda não tem uma conta, peça ao administrador da sua
          empresa.
        </p>
        {SITE_URL ? (
          <p className="text-center text-xs text-muted-foreground">
            Ao entrar, você concorda com os{' '}
            <a className="underline underline-offset-2" href={`${SITE_URL}/termos`}>
              Termos de Uso
            </a>{' '}
            e com a{' '}
            <a className="underline underline-offset-2" href={`${SITE_URL}/privacidade`}>
              Política de Privacidade
            </a>
            .
          </p>
        ) : null}
      </div>
    </AuthLayout>
  );
}
