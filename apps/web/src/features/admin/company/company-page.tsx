import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from '@voltex/ui';
import { z } from 'zod';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Skeleton,
  Spinner,
} from '@voltex/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { queryKeys } from '../query-keys';
import { BranchesCard } from './branches-card';
import { BrandingCard } from './branding-card';
import { TeamsCard } from './teams-card';

const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da empresa').max(120, 'No máximo 120 caracteres'),
  document: z.string().trim().max(32, 'No máximo 32 caracteres'),
});
type FormValues = z.infer<typeof schema>;

function CompanyDataCard() {
  const { can } = useAuth();
  const canEdit = can('platform.tenant.manage');
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.tenant,
    queryFn: endpoints.tenant.get,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', document: '' },
  });
  useEffect(() => {
    if (data) form.reset({ name: data.name, document: data.document ?? '' });
  }, [data, form]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      endpoints.tenant.update({ name: values.name, document: values.document || null }),
    onSuccess: async () => {
      toast.success('Dados da empresa atualizados');
      await queryClient.invalidateQueries({ queryKey: queryKeys.tenant });
    },
    onError: (error) =>
      toast.error(errorMessage(error, 'Não foi possível salvar os dados da empresa.')),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados da empresa</CardTitle>
        <CardDescription>Como sua empresa aparece nas propostas e documentos.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os dados da empresa.</p>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
              className="grid max-w-xl gap-4"
              noValidate
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome da empresa</FormLabel>
                    <FormControl>
                      <Input readOnly={!canEdit} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="document"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CNPJ</FormLabel>
                    <FormControl>
                      <Input
                        readOnly={!canEdit}
                        inputMode="numeric"
                        placeholder="00.000.000/0000-00"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {canEdit ? (
                <div>
                  <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
                    {mutation.isPending ? <Spinner /> : null}
                    Salvar alterações
                  </Button>
                </div>
              ) : null}
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}

export function CompanyPage() {
  return (
    <div className="space-y-6">
      <CompanyDataCard />
      <BrandingCard />
      <BranchesCard />
      <TeamsCard />
    </div>
  );
}
