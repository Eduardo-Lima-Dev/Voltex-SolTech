import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button } from '@voltex/ui';
import type { AiFactDto, AiMessageDto } from '@voltex/shared';
import { formatDateTime } from '@/lib/format';

interface Props {
  message: AiMessageDto;
  onFollowUp: (question: string) => void;
  onFeedback: (message: AiMessageDto, helpful: boolean, reason?: string) => void;
  disabled?: boolean;
}

/** Nome do campo: o legível vindo do servidor; em conversas antigas (sem rótulo), o caminho do campo. */
const labelOf = (fact: AiFactDto): string => fact.label ?? fact.field;

/** Cartões com os números da resposta: rótulo, valor em destaque e, ao clicar, de onde veio. */
function FactCards({ facts }: { facts: AiFactDto[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // A data da própria consulta não é um resultado: fica só no "Ver os dados".
  const shown = facts.filter((f) => f.field.split('.').pop() !== 'queriedAt').slice(0, 8);
  if (shown.length === 0) return null;
  const open = shown.find((f) => f.id === openId) ?? null;
  return (
    <div className="space-y-2">
      <ul className="grid grid-cols-2 gap-2" aria-label="Números da resposta">
        {shown.map((fact) => (
          <li key={fact.id}>
            <button
              type="button"
              onClick={() => setOpenId(openId === fact.id ? null : fact.id)}
              aria-expanded={openId === fact.id}
              aria-label={`${labelOf(fact)}: ${fact.text}. Ver de onde veio`}
              className="w-full rounded-lg border bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block text-[11px] leading-tight text-muted-foreground">
                {labelOf(fact)}
              </span>
              <span className="block text-base font-semibold tabular-nums">{fact.text}</span>
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <p role="note" className="rounded-md border bg-muted/50 px-3 py-2 text-xs">
          <span className="font-medium">{labelOf(open)}</span>
          <span className="text-muted-foreground">
            {' '}
            · De onde veio: {open.toolLabel} · {formatDateTime(open.queriedAt)}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Uma mensagem da conversa. Os valores citados pelo assistente viram chips que mostram de onde vieram. */
export function MessageView({ message, onFollowUp, onFeedback, disabled }: Props) {
  const [factId, setFactId] = useState<string | null>(null);
  const [showData, setShowData] = useState(false);
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState('');

  if (message.role === 'USER') {
    return (
      <div className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
        {message.text}
      </div>
    );
  }

  const fact = message.facts.find((item) => item.id === factId) ?? null;
  const refusal = message.kind === 'CANNOT_ANSWER' || message.kind === 'NEEDS_CLARIFICATION';

  return (
    <div className="mr-auto w-full max-w-[95%] space-y-2">
      <div
        className={`rounded-lg border px-3 py-2 text-sm leading-relaxed ${
          refusal
            ? 'bg-muted/60'
            : message.kind === 'FALLBACK'
              ? 'border-yellow-500/40 bg-yellow-500/10'
              : 'bg-card'
        }`}
        data-testid="assistant-message"
      >
        {message.parts.map((part, index) =>
          part.type === 'fact' ? (
            <button
              key={index}
              type="button"
              onClick={() => setFactId(factId === part.factId ? null : part.factId)}
              aria-expanded={factId === part.factId}
              aria-label={`${part.text}: ver de onde veio`}
              className="mx-0.5 rounded-md bg-brand-cyan/15 px-1.5 py-0.5 font-medium tabular-nums text-foreground underline decoration-dotted underline-offset-2 hover:bg-brand-cyan/25 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {part.text}
            </button>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </div>

      {fact ? (
        <div role="note" className="rounded-md border bg-muted/50 px-3 py-2 text-xs">
          <p className="font-medium">
            {labelOf(fact)}: {fact.text}
          </p>
          <p className="text-muted-foreground">
            De onde veio: {fact.toolLabel} · {formatDateTime(fact.queriedAt)}
          </p>
        </div>
      ) : null}

      {message.kind === 'FALLBACK' || (message.kind === 'ANSWER' && message.facts.length >= 2) ? (
        <FactCards facts={message.facts} />
      ) : null}

      {message.facts.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowData((value) => !value)}
            aria-expanded={showData}
            className="text-xs font-medium text-brand-cyan-strong hover:underline dark:text-brand-cyan"
          >
            {showData ? 'Ocultar os dados' : 'Ver os dados'}
          </button>
          {showData ? (
            <ul className="mt-1 space-y-1 text-xs">
              {message.facts.map((item) => (
                <li key={item.id} className="rounded border px-2 py-1">
                  <span className="font-medium tabular-nums">{item.text}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {labelOf(item)} · {item.toolLabel} · {formatDateTime(item.queriedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {message.kind === 'FALLBACK' ? <Badge variant="yellow">Só com os dados</Badge> : null}
        <p className="text-[11px] text-muted-foreground">
          Gerado por IA a partir dos dados do sistema. Confira antes de decidir.
        </p>
      </div>

      {message.followUps.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {message.followUps.map((question) => (
            <Button
              key={question}
              size="sm"
              variant="outline"
              className="h-auto whitespace-normal py-1 text-left text-xs"
              disabled={disabled}
              onClick={() => onFollowUp(question)}
            >
              {question}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-1" role="group" aria-label="Avaliar a resposta">
        <Button
          size="icon"
          variant={message.helpful === true ? 'secondary' : 'ghost'}
          className="size-7"
          aria-label="Resposta útil"
          aria-pressed={message.helpful === true}
          onClick={() => {
            setAskReason(false);
            onFeedback(message, true);
          }}
        >
          <ThumbsUp />
        </Button>
        <Button
          size="icon"
          variant={message.helpful === false ? 'secondary' : 'ghost'}
          className="size-7"
          aria-label="Resposta não útil"
          aria-pressed={message.helpful === false}
          onClick={() => setAskReason(true)}
        >
          <ThumbsDown />
        </Button>
      </div>
      {askReason ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onFeedback(message, false, reason.trim() || undefined);
            setAskReason(false);
            setReason('');
          }}
        >
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            placeholder="O que faltou? (opcional)"
            aria-label="Motivo"
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
          />
          <Button size="sm" type="submit">
            Enviar
          </Button>
        </form>
      ) : null}
    </div>
  );
}
