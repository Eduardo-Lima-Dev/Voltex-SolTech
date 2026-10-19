import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  Spinner,
  toast,
} from '@voltex/ui';
import { Field } from '@/components/field';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { queryKeys } from '../query-keys';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Identidade visual usada nas propostas (PDF e página do cliente). */
export function BrandingCard() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState('#0a7d3b');
  const [error, setError] = useState<string>();
  const branding = useQuery({ queryKey: queryKeys.branding, queryFn: endpoints.branding.get });

  useEffect(() => {
    if (branding.data?.primaryColor) setColor(branding.data.primaryColor);
  }, [branding.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.branding });
  const saveColor = useMutation({
    mutationFn: () => endpoints.branding.update({ primaryColor: color }),
    onSuccess: async () => {
      toast.success('Cor atualizada');
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível salvar a cor.')),
  });
  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const document = await endpoints.documents.upload(file, { entityType: 'Branding' });
      return endpoints.branding.update({ logoDocumentId: document.id });
    },
    onSuccess: async () => {
      toast.success('Logo atualizada');
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível enviar a logo.')),
  });
  const removeLogo = useMutation({
    mutationFn: () => endpoints.branding.update({ logoDocumentId: null }),
    onSuccess: async () => {
      toast.success('Logo removida');
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível remover a logo.')),
  });

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Use uma imagem PNG ou JPEG');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('A logo deve ter no máximo 2 MB');
      return;
    }
    setError(undefined);
    uploadLogo.mutate(file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identidade visual das propostas</CardTitle>
        <CardDescription>
          Logo e cor que o cliente vê no PDF e na página da proposta.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {branding.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : branding.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar a identidade visual.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field
                id="branding-color"
                label="Cor principal"
                error={COLOR.test(color) ? undefined : 'Use o formato #RRGGBB'}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Escolher cor"
                    className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
                    value={COLOR.test(color) ? color : '#000000'}
                    onChange={(e) => setColor(e.target.value)}
                  />
                  <Input
                    id="branding-color"
                    className="w-32 font-mono"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                </div>
              </Field>
              <Button
                type="button"
                disabled={!COLOR.test(color) || saveColor.isPending}
                onClick={() => saveColor.mutate()}
              >
                {saveColor.isPending ? <Spinner /> : null}
                Salvar cor
              </Button>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Logo</p>
              <p className="text-sm text-muted-foreground">
                {branding.data.logoDocumentId
                  ? 'Há uma logo cadastrada. Envie outra para trocar.'
                  : 'Nenhuma logo cadastrada: as propostas saem só com o nome da empresa.'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  aria-label="Enviar logo"
                  className="hidden"
                  onChange={(e) => {
                    pick(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploadLogo.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploadLogo.isPending ? <Spinner /> : null}
                  Enviar logo
                </Button>
                {branding.data.logoDocumentId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={removeLogo.isPending}
                    onClick={() => removeLogo.mutate()}
                  >
                    Remover logo
                  </Button>
                ) : null}
              </div>
              {error ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
