import { zodResolver } from '@hookform/resolvers/zod';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { acceptInvitationSchema } from '@voltex/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Spinner,
} from '@voltex/ui';
import { FullScreenSpinner } from '@/app/guards';
import { fieldErrors, isApiError } from '@/lib/api/errors';
import { AuthLayout } from './auth-layout';
import { useAuth } from './auth-provider';

const formSchema = acceptInvitationSchema
  .omit({ token: true })
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'As senhas não coincidem',
  });

type FormValues = z.infer<typeof formSchema>;

export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { status, acceptInvitation } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', password: '', confirmPassword: '' },
  });

  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'authenticated') return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async ({ name, password }) => {
    setFormError(null);
    try {
      await acceptInvitation({ token, name, password });
      navigate('/', { replace: true });
    } catch (error) {
      if (isApiError(error) && error.status === 422) {
        for (const [path, message] of Object.entries(fieldErrors(error))) {
          if (path === 'name' || path === 'password') form.setError(path, { message });
        }
        return;
      }
      if (isApiError(error) && error.status === 400)
        setFormError(
          'Este convite é inválido, expirou ou já foi usado. Peça um novo convite ao administrador.',
        );
      else if (isApiError(error) && error.status === 409)
        setFormError('Já existe uma conta com o e-mail deste convite. Tente entrar.');
      else setFormError('Não foi possível criar sua conta. Tente novamente.');
    }
  });

  if (!token) {
    return (
      <AuthLayout>
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Convite inválido</h1>
          <Alert variant="destructive">
            <AlertDescription>
              O link do convite está incompleto. Abra o link exatamente como veio no e-mail ou peça
              um novo convite.
            </AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">Ir para o login</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Crie sua conta</h1>
          <p className="text-sm text-muted-foreground">
            Você foi convidado para a Voltex SolTech. Informe seu nome e escolha uma senha.
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
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome completo</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" autoFocus {...field} />
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
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>Mínimo de 8 caracteres, com letras e números.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirmar senha</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Spinner /> : <UserPlus />}
              Criar conta e entrar
            </Button>
          </form>
        </Form>
      </div>
    </AuthLayout>
  );
}
