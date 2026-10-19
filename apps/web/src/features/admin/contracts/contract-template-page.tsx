import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  Spinner,
  Textarea,
  toast,
} from '@voltex/ui';
import { unknownTemplateVariables } from '@voltex/shared';
import { Can } from '@/app/guards';
import { Field } from '@/components/field';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../query-keys';

export function ContractTemplatePage() {
  const queryClient = useQueryClient();
  const template = useQuery({
    queryKey: queryKeys.contractTemplate,
    queryFn: endpoints.contracts.template,
  });
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (template.data) {
      setName(template.data.isDefault ? 'Contrato padrão' : template.data.name);
      setBody(template.data.body);
    }
  }, [template.data]);

  const save = useMutation({
    mutationFn: () => endpoints.contracts.saveTemplate({ name: name.trim(), body }),
    onSuccess: async () => {
      toast.success('Modelo publicado');
      await queryClient.invalidateQueries({ queryKey: queryKeys.contractTemplate });
    },
    onError: (e) => setError(errorMessage(e, 'Não foi possível publicar o modelo.')),
  });

  const submit = () => {
    const unknown = unknownTemplateVariables(body);
    if (unknown.length)
      return setError(`Variáveis desconhecidas: ${unknown.map((u) => `{{${u}}}`).join(', ')}`);
    if (body.trim().length < 50) return setError('O modelo está curto demais');
    setError(undefined);
    save.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Modelo de contrato</CardTitle>
        <CardDescription>
          Use as variáveis entre chaves duplas. Cada publicação cria uma versão nova; os contratos
          já gerados não mudam.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {template.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : template.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar o modelo.</p>
        ) : (
          <>
            {template.data.isDefault ? (
              <Alert variant="warning">
                <p>
                  Sua empresa ainda usa o <strong>modelo-base</strong>, sem revisão jurídica. Edite
                  o texto, revise com o seu jurídico e publique.
                </p>
              </Alert>
            ) : (
              <p className="text-sm text-muted-foreground">
                Versão {template.data.version} publicada em{' '}
                {template.data.createdAt ? formatDateTime(template.data.createdAt) : '—'}.
              </p>
            )}
            <div>
              <p className="mb-1 text-sm font-medium">Variáveis disponíveis</p>
              <ul className="flex flex-wrap gap-2">
                {template.data.variables.map((v) => (
                  <li key={v.key} className="rounded-md border px-2 py-1 text-xs" title={v.label}>
                    <code>{`{{${v.key}}}`}</code>
                  </li>
                ))}
              </ul>
            </div>
            <Can
              permission="crm.contract.write"
              fallback={
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {template.data.body}
                </pre>
              }
            >
              <form
                noValidate
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <Field id="template-name" label="Nome">
                  <Input
                    id="template-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field id="template-body" label="Texto do contrato" error={error}>
                  <Textarea
                    id="template-body"
                    rows={20}
                    className="font-mono text-xs"
                    aria-invalid={error ? true : undefined}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? <Spinner /> : null}
                  Publicar modelo
                </Button>
              </form>
            </Can>
          </>
        )}
      </CardContent>
    </Card>
  );
}
