import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, MessageSquarePlus, Send, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import {
  Alert,
  AlertDescription,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Spinner,
  toast,
} from '@voltex/ui';
import type { AiMessageDto } from '@voltex/shared';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { useAssistant, type AssistantRequest } from './assistant-context';
import { MessageView } from './message-view';
import { suggestionsFor } from './suggestions';

const statusKey = ['ai', 'status'] as const;
const historyKey = ['ai', 'conversations'] as const;

interface Turn {
  message: AiMessageDto;
  notice?: string | null;
}

/** Painel lateral "Pergunte ao Voltex": conversa, histórico e estados (indisponível, cota, recusa). */
export function AssistantPanel() {
  const assistant = useAssistant();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const context = useRef<Pick<AssistantRequest, 'projectCode' | 'screen'>>({});

  const open = assistant?.open ?? false;
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => endpoints.ai.status(),
    enabled: open,
    staleTime: 0,
  });
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () => endpoints.ai.conversations(),
    enabled: open && view === 'history',
  });
  const available = status.data?.available ?? false;
  const suggestions = suggestionsFor(pathname);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns, progress]);

  useEffect(() => {
    if (!open) abort.current?.abort();
  }, [open]);

  const send = useCallback(
    async (question: string, ctx: Pick<AssistantRequest, 'projectCode' | 'screen'> = {}) => {
      const clean = question.trim();
      if (clean.length < 2 || busy) return;
      setView('chat');
      setFailure(null);
      setBusy(true);
      setProgress('Pensando…');
      setText('');
      const merged = { ...context.current, ...ctx };
      context.current = merged;
      const asked: AiMessageDto = {
        id: `local-${Date.now()}`,
        role: 'USER',
        text: clean,
        parts: [],
        kind: null,
        cannotAnswerReason: null,
        facts: [],
        followUps: [],
        removed: {},
        helpful: null,
        createdAt: new Date().toISOString(),
      };
      setTurns((current) => [...current, { message: asked }]);
      abort.current = new AbortController();
      try {
        await endpoints.ai.chat(
          {
            question: clean,
            conversationId,
            context:
              merged.projectCode || merged.screen
                ? { projectCode: merged.projectCode, screen: merged.screen ?? suggestions.screen }
                : undefined,
          },
          (event) => {
            if (event.type === 'progress') setProgress(event.label);
            else if (event.type === 'answer') {
              setConversationId(event.data.conversationId);
              setTurns((current) => [
                ...current,
                { message: event.data.message, notice: event.data.notice },
              ]);
              void queryClient.invalidateQueries({ queryKey: historyKey });
              void queryClient.invalidateQueries({ queryKey: statusKey });
            } else {
              setFailure(event.message);
              void queryClient.invalidateQueries({ queryKey: statusKey });
            }
          },
          abort.current.signal,
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setFailure(errorMessage(error, 'Não foi possível responder agora. Tente de novo.'));
        }
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [busy, conversationId, queryClient, suggestions.screen],
  );

  // Pergunta pronta vinda de uma ficha (copiloto): começa uma conversa nova no assunto da tela.
  const pending = assistant?.request ?? null;
  useEffect(() => {
    if (!pending || !open) return;
    const { question, projectCode, screen } = pending;
    assistant?.consume();
    setConversationId(undefined);
    setTurns([]);
    context.current = { projectCode, screen };
    if (question) void send(question, { projectCode, screen });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.nonce, open]);

  if (!assistant) return null;

  const newConversation = () => {
    abort.current?.abort();
    setConversationId(undefined);
    setTurns([]);
    setFailure(null);
    setView('chat');
    context.current = {};
  };

  const openConversation = async (id: string) => {
    try {
      const detail = await endpoints.ai.conversation(id);
      setConversationId(id);
      setTurns(detail.messages.map((message) => ({ message })));
      setFailure(null);
      setView('chat');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const removeConversation = async (id: string) => {
    try {
      await endpoints.ai.removeConversation(id);
      if (id === conversationId) newConversation();
      await queryClient.invalidateQueries({ queryKey: historyKey });
      toast.success('Conversa apagada');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const sendFeedback = async (message: AiMessageDto, helpful: boolean, reason?: string) => {
    try {
      await endpoints.ai.feedback(message.id, { helpful, reason });
      setTurns((current) =>
        current.map((turn) =>
          turn.message.id === message.id
            ? { ...turn, message: { ...turn.message, helpful } }
            : turn,
        ),
      );
      toast.success('Obrigado pela avaliação');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(text);
  };

  return (
    <Sheet open={assistant.open} onOpenChange={assistant.setOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="space-y-1 border-b p-4 pr-12">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-brand-cyan" aria-hidden />
            Pergunte ao Voltex
          </SheetTitle>
          <SheetDescription className="text-xs">
            Responde só com os dados do sistema que o seu perfil pode ver.
          </SheetDescription>
          <div className="flex gap-1 pt-1">
            <Button size="sm" variant="outline" onClick={newConversation}>
              <MessageSquarePlus /> Nova conversa
            </Button>
            <Button
              size="sm"
              variant={view === 'history' ? 'secondary' : 'outline'}
              onClick={() => setView(view === 'history' ? 'chat' : 'history')}
              aria-pressed={view === 'history'}
            >
              <History /> Histórico
            </Button>
          </div>
        </SheetHeader>

        {view === 'history' ? (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4" aria-label="Histórico">
            {history.isPending ? <Skeleton className="h-16 w-full" /> : null}
            {history.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma conversa ainda.</p>
            ) : null}
            {history.data?.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-md border p-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => void openConversation(item.id)}
                >
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.messagesCount} mensagens · {formatDateTime(item.updatedAt)}
                  </p>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Apagar a conversa ${item.title}`}
                  onClick={() => void removeConversation(item.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div
              className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
              role="log"
              aria-live="polite"
              aria-label="Conversa"
            >
              {status.data && !status.data.available ? (
                <Alert>
                  <AlertDescription>{status.data.message}</AlertDescription>
                </Alert>
              ) : null}
              {status.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{errorMessage(status.error)}</AlertDescription>
                </Alert>
              ) : null}

              {turns.length === 0 && !busy ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Pergunte sobre vendas, projetos, instalações ou financeiro. Por exemplo:
                  </p>
                  {suggestions.questions.map((question) => (
                    <Button
                      key={question}
                      variant="outline"
                      size="sm"
                      className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                      disabled={!available}
                      onClick={() => void send(question, { screen: suggestions.screen })}
                    >
                      {question}
                    </Button>
                  ))}
                </div>
              ) : null}

              {turns.map((turn) => (
                <div key={turn.message.id} className="space-y-2">
                  {turn.notice ? (
                    <Alert>
                      <AlertDescription>{turn.notice}</AlertDescription>
                    </Alert>
                  ) : null}
                  <MessageView
                    message={turn.message}
                    onFollowUp={(question) => void send(question)}
                    onFeedback={(message, helpful, reason) =>
                      void sendFeedback(message, helpful, reason)
                    }
                    disabled={busy || !available}
                  />
                </div>
              ))}

              {busy ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <Spinner /> {progress ?? 'Pensando…'}
                </p>
              ) : null}
              {failure ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{failure}</AlertDescription>
                </Alert>
              ) : null}
              <div ref={endRef} />
            </div>

            <form onSubmit={submit} className="space-y-1 border-t p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send(text);
                    }
                  }}
                  rows={2}
                  maxLength={1000}
                  disabled={!available || busy}
                  aria-label="Sua pergunta"
                  placeholder={available ? 'Escreva sua pergunta…' : 'Assistente indisponível'}
                  className="min-h-10 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60"
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Enviar pergunta"
                  disabled={!available || busy || text.trim().length < 2}
                >
                  <Send />
                </Button>
              </div>
              {status.data?.quota ? (
                <p className="text-[11px] text-muted-foreground">
                  Uso de hoje: restam {status.data.quota.user.remaining} de{' '}
                  {status.data.quota.user.limit} pontos para você.
                </p>
              ) : null}
            </form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
