import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CreateRuleSetInput, RuleSetDto } from '@voltex/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Spinner,
  toast,
} from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { queryKeys } from '../query-keys';

/** Ativar rascunho: quem revisou e, nas regras do Engine, o registro no conselho (CREA/CFT/CAU). */
export function ActivateRuleDialog({ rule }: { rule: RuleSetDto }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reviewedBy, setReviewedBy] = useState('');
  const [registration, setRegistration] = useState('');
  const isEngine = rule.key.startsWith('engine.');
  const activate = useMutation({
    mutationFn: () =>
      endpoints.rules.activate(rule.id, {
        reviewedBy: reviewedBy.trim(),
        reviewedByRegistration: registration.trim() || undefined,
      }),
    onSuccess: async () => {
      toast.success(`Regra ${rule.key} v${rule.version} ativada.`);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.rules });
      await queryClient.invalidateQueries({ queryKey: queryKeys.effectiveRules });
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível ativar a regra.')),
  });
  const valid = reviewedBy.trim().length >= 3 && (!isEngine || registration.trim().length >= 3);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Ativar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Ativar {rule.key} v{rule.version}
          </DialogTitle>
          <DialogDescription>
            Quem ativa confere cada valor na norma ou no ato oficial citado nas fontes. Depois de
            ativada a regra não muda mais; a versão anterior é aposentada. Cada engenheiro ainda
            confirma as regras ao assinar o próprio projeto.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1">
            <Label htmlFor="rule-reviewer">Quem revisou (nome)</Label>
            <Input
              id="rule-reviewer"
              value={reviewedBy}
              onChange={(e) => setReviewedBy(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="rule-registration">
              Registro no conselho (CREA/CFT/CAU){isEngine ? '' : ' (opcional)'}
            </Label>
            <Input
              id="rule-registration"
              placeholder="CREA-SP 123456"
              value={registration}
              onChange={(e) => setRegistration(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button disabled={!valid || activate.isPending} onClick={() => activate.mutate()}>
            {activate.isPending ? <Spinner /> : null} Ativar regra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Lê o JSON de uma proposta (`docs/governanca/regras/*.json`: campo `rule`) ou o corpo direto de `POST /rules`.
 * Devolve sempre um corpo de criação; a regra entra como rascunho e nunca é ativada aqui.
 */
export function parseRuleProposal(text: string): CreateRuleSetInput {
  const parsed = JSON.parse(text) as { rule?: CreateRuleSetInput } & Partial<CreateRuleSetInput>;
  const body = parsed.rule ?? parsed;
  if (!body.key || !body.definition || !Array.isArray(body.sources))
    throw new Error('O JSON precisa ter key, definition e sources.');
  return body as CreateRuleSetInput;
}

export function ImportRuleDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const create = useMutation({
    mutationFn: () => endpoints.rules.create(parseRuleProposal(text)),
    onSuccess: async (rule) => {
      toast.success(`Rascunho ${rule.key} v${rule.version} criado. Confira e ative.`);
      setOpen(false);
      setText('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.rules });
    },
    onError: (e) =>
      setError(
        e instanceof SyntaxError
          ? 'JSON inválido.'
          : errorMessage(e, 'Não foi possível criar o rascunho.'),
      ),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setError(undefined);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Importar proposta (JSON)</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar proposta de regra</DialogTitle>
          <DialogDescription>
            Cole o JSON de uma proposta (pasta docs/governanca/regras). Ele entra como rascunho com
            as fontes; os valores só valem depois que o engenheiro conferir e ativar.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1">
          <Label htmlFor="rule-json">JSON da proposta</Label>
          <textarea
            id="rule-json"
            className="min-h-64 w-full rounded-md border bg-background p-2 font-mono text-xs"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(undefined);
            }}
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button disabled={!text.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner /> : null} Criar rascunho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
