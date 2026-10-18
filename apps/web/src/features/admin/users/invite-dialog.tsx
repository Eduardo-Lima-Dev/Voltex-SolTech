import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from '@voltex/ui';
import { z } from 'zod';
import { assignableRoles, createInvitationSchema, type CreatedInvitationDto } from '@voltex/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  NativeSelect,
  Spinner,
} from '@voltex/ui';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { ROLE_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { queryKeys } from '../query-keys';

const schema = z.object({
  email: createInvitationSchema.shape.email,
  role: createInvitationSchema.shape.role,
  branchId: z.string(),
  teamId: z.string(),
});
type FormValues = z.infer<typeof schema>;

export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useCurrentUser();
  const roles = assignableRoles(me.role);
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<CreatedInvitationDto | null>(null);

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

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '',
      role: roles.includes('SALESPERSON') ? 'SALESPERSON' : (roles[0] ?? 'SDR'),
      branchId: '',
      teamId: '',
    },
  });

  useEffect(() => {
    if (open) setCreated(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      endpoints.invitations.create({
        email: values.email,
        role: values.role,
        branchId: values.branchId || undefined,
        teamId: values.teamId || undefined,
      }),
    onSuccess: async (invitation) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations });
      form.reset({ ...form.getValues(), email: '' });
      if (invitation.emailSent) toast.success(`Convite enviado para ${invitation.email}`);
      else
        toast.warning(
          `Convite criado, mas o e-mail para ${invitation.email} não pôde ser enviado.`,
        );
      // Fora de produção a API devolve o link: útil para testar sem servidor de e-mail.
      if (invitation.devAcceptUrl) setCreated(invitation);
      else onOpenChange(false);
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409)
        form.setError('email', { message: 'Já existe um usuário com este e-mail.' });
      else toast.error(errorMessage(error, 'Não foi possível enviar o convite.'));
    },
  });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar. Selecione e copie o link manualmente.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar usuário</DialogTitle>
          <DialogDescription>
            A pessoa recebe um e-mail com um link para criar a própria senha.
          </DialogDescription>
        </DialogHeader>

        {created?.devAcceptUrl ? (
          <div className="space-y-3">
            <Alert variant="info">
              <div className="space-y-2">
                <AlertTitle>Ambiente de desenvolvimento</AlertTitle>
                <AlertDescription>Link do convite (não é exibido em produção):</AlertDescription>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={created.devAcceptUrl}
                    aria-label="Link do convite"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Copiar link"
                    onClick={() => void copy(created.devAcceptUrl as string)}
                  >
                    <Copy />
                  </Button>
                </div>
              </div>
            </Alert>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Concluir
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
              className="grid gap-4"
              noValidate
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        inputMode="email"
                        autoFocus
                        placeholder="pessoa@empresa.com.br"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Perfil</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        {roles.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="branchId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Filial</FormLabel>
                      <FormControl>
                        <NativeSelect {...field}>
                          <option value="">Sem filial</option>
                          {branches.data?.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="teamId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Time</FormLabel>
                      <FormControl>
                        <NativeSelect {...field}>
                          <option value="">Sem time</option>
                          {teams.data?.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? <Spinner /> : null}
                  Enviar convite
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
