import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** Pedido para abrir o painel do assistente, opcionalmente já com uma pergunta (copiloto das fichas). */
export interface AssistantRequest {
  question?: string;
  /** Código do projeto da tela, para a pergunta começar no assunto certo. */
  projectCode?: string;
  /** Nome curto da tela (`financeiro`, `planta`...). */
  screen?: string;
}

interface AssistantContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Pedido pendente: o painel envia a pergunta e o limpa. */
  request: (AssistantRequest & { nonce: number }) | null;
  ask: (request?: AssistantRequest) => void;
  consume: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<AssistantContextValue['request']>(null);

  const value = useMemo<AssistantContextValue>(
    () => ({
      open,
      setOpen,
      request,
      ask: (next) => {
        setRequest(next ? { ...next, nonce: Date.now() } : null);
        setOpen(true);
      },
      consume: () => setRequest(null),
    }),
    [open, request],
  );
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

/** Fora da casca (testes de página isolada) o hook devolve `null`, e os botões do copiloto somem. */
export function useAssistant(): AssistantContextValue | null {
  return useContext(AssistantContext);
}
