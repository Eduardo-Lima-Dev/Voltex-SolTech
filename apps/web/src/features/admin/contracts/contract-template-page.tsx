import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
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

function WordUploadCard() {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const template = useQuery({
    queryKey: queryKeys.contractTemplate,
    queryFn: endpoints.contracts.template,
  });
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();

  const upload = useMutation({
    mutationFn: (file: File) => endpoints.contracts.uploadTemplate(file, name.trim() || undefined),
    onSuccess: async () => {
      toast.success('Modelo em Word publicado');
      setName('');
      setError(undefined);
      await queryClient.invalidateQueries({ queryKey: queryKeys.contractTemplate });
    },
    onError: (e) => setError(errorMessage(e, 'Não foi possível enviar o modelo.')),
  });
  const download = useMutation({
    mutationFn: async () => {
      const { url } = await endpoints.contracts.templateFileUrl();
      window.open(url, '_blank', 'noopener');
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível baixar o modelo.')),
  });

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) return setError('Envie um arquivo do Word (.docx).');
    setError(undefined);
    upload.mutate(file);
  };
  const current = template.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usar o contrato da sua empresa (Word)</CardTitle>
        <CardDescription>
          Já tem o seu contrato em Word? Escreva as variáveis entre chaves duplas onde os dados do
          cliente devem entrar (por exemplo, <code>{'{{cliente.nome}}'}</code> e{' '}
          <code>{'{{contrato.valor}}'}</code>; a lista completa está logo abaixo) e envie o arquivo.
          O sistema preenche cada contrato e entrega o Word pronto, com a sua formatação. Cada envio
          vira uma nova versão do modelo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {current?.kind === 'DOCX' ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            Modelo atual: arquivo Word <strong>{current.fileName}</strong> (versão {current.version}
            ).
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={download.isPending}
              onClick={() => download.mutate()}
            >
              <Download /> Baixar o modelo
            </Button>
          </p>
        ) : null}
        <Can
          permission="crm.contract.write"
          fallback={
            <p className="text-sm text-muted-foreground">
              Só quem gerencia contratos pode enviar o modelo.
            </p>
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field id="word-name" label="Nome do modelo (opcional)">
              <Input
                id="word-name"
                className="w-64"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <input
              ref={input}
              type="file"
              aria-label="Enviar modelo em Word"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              disabled={upload.isPending}
              onClick={() => input.current?.click()}
            >
              {upload.isPending ? <Spinner /> : <Upload />}
              Escolher o arquivo do Word
            </Button>
          </div>
        </Can>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

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
    <div className="space-y-6">
      <WordUploadCard />
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
                    Sua empresa ainda usa o <strong>modelo-base</strong>, sem revisão jurídica.
                    Edite o texto, revise com o seu jurídico e publique.
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
    </div>
  );
}
