import { useMutation } from '@tanstack/react-query';
import { Copy, Mail, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { Button, Input, toast } from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api';

export interface SendMessageProps {
  /** Modelo de mensagem (ver `GET /communications/templates`). */
  template: string;
  /** Valores do modelo, inclusive o link quando houver. */
  variables: Record<string, string>;
  email?: string | null;
  phone?: string | null;
  entityType?: string;
  entityId?: string;
  accountId?: string;
  /** Texto a copiar quando o canal é "copiar" (padrão: o valor de `variables.link`). */
  copyText?: string;
  size?: 'sm' | 'default';
}

/**
 * Envio manual de uma mensagem: e-mail pelo servidor, link do WhatsApp (abre a conversa no aparelho do usuário, que
 * revisa e envia; nada é enviado por API) ou cópia do texto. Todo envio fica no histórico de comunicações.
 */
export function SendMessage(initial: SendMessageProps) {
  // Sem destinatário conhecido, a pessoa informa na hora (o cadastro do cliente nem sempre tem os dois).
  const [typedEmail, setTypedEmail] = useState('');
  const [typedPhone, setTypedPhone] = useState('');
  const props = {
    ...initial,
    email: initial.email || typedEmail.trim() || null,
    phone: initial.phone || typedPhone.trim() || null,
  };
  const base = {
    template: props.template,
    ...(props.entityType ? { entityType: props.entityType } : {}),
    ...(props.entityId ? { entityId: props.entityId } : {}),
    ...(props.accountId ? { accountId: props.accountId } : {}),
  };
  const email = useMutation({
    mutationFn: () =>
      endpoints.communications.email({ ...base, to: props.email!, variables: props.variables }),
    onSuccess: () => toast.success(`E-mail enviado para ${props.email}.`),
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível enviar o e-mail.')),
  });
  const whatsapp = useMutation({
    mutationFn: () =>
      endpoints.communications.whatsAppLink({
        ...base,
        phone: props.phone!,
        variables: props.variables,
      }),
    onSuccess: (result) => {
      window.open(result.url, '_blank', 'noopener');
      toast.success('Conversa aberta no WhatsApp. Revise e envie por lá.');
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível abrir o WhatsApp.')),
  });
  const copy = useMutation({
    mutationFn: async () => {
      await navigator.clipboard.writeText(props.copyText ?? props.variables.link ?? '');
      return endpoints.communications.copiedLink(base);
    },
    onSuccess: () => toast.success('Copiado.'),
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível copiar.')),
  });
  const size = props.size ?? 'sm';
  return (
    <div className="space-y-2">
      {!initial.email || !initial.phone ? (
        <div className="flex flex-wrap gap-2">
          {!initial.email ? (
            <Input
              aria-label="E-mail do destinatário"
              placeholder="E-mail do destinatário"
              type="email"
              className="max-w-60"
              value={typedEmail}
              onChange={(e) => setTypedEmail(e.target.value)}
            />
          ) : null}
          {!initial.phone ? (
            <Input
              aria-label="Telefone com DDD"
              placeholder="Telefone com DDD"
              inputMode="tel"
              className="max-w-48"
              value={typedPhone}
              onChange={(e) => setTypedPhone(e.target.value)}
            />
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size={size}
          variant="outline"
          disabled={!props.email || email.isPending}
          onClick={() => email.mutate()}
        >
          <Mail /> Enviar por e-mail
        </Button>
        <Button
          size={size}
          variant="outline"
          disabled={!props.phone || whatsapp.isPending}
          onClick={() => whatsapp.mutate()}
        >
          <MessageCircle /> Abrir no WhatsApp
        </Button>
        <Button
          size={size}
          variant="outline"
          disabled={copy.isPending}
          onClick={() => copy.mutate()}
        >
          <Copy /> Copiar
        </Button>
      </div>
    </div>
  );
}
