import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { loginSchema, type LoginInput } from '@voltex/shared';
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
import { isApiError } from '@/lib/api/errors';
import { AuthLayout } from './auth-layout';
import { useAuth } from './auth-provider';

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

const SITE_URL = (import.meta.env.VITE_SITE_URL?.trim() || null)?.replace(/\/+$/, '') ?? null;

export function LoginPage() {
  const { login } = useAuth();
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
      await login(values);
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
