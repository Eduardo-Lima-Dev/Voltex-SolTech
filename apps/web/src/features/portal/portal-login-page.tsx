import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Input } from '@voltex/ui';
import { Field } from '@/components/field';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api';

import '@/components/brand-motion.css';

/** O cliente pede o link pelo e-mail. A resposta é a mesma exista ou não o acesso. */
export function PortalLoginPage() {
  const [email, setEmail] = useState('');
  const request = useMutation({ mutationFn: () => endpoints.portal.requestLink(email.trim()) });
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Portal do cliente</h1>
        <p className="text-sm text-muted-foreground">
          Informe o e-mail cadastrado e enviaremos um link de acesso. Não é preciso senha.
        </p>
      </header>
      {request.isSuccess ? (
        <Alert role="status">
          Se este e-mail tiver acesso ao portal, enviamos um link para ele. O link vale por 30
          minutos e só pode ser aberto uma vez.
        </Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            request.mutate();
          }}
        >
          <Field id="portal-email" label="E-mail">
            <Input
              id="portal-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          {request.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(request.error, 'Não foi possível enviar agora. Tente novamente.')}
            </p>
          ) : null}
          <Button type="submit" disabled={request.isPending || !email.trim()}>
            Receber link de acesso
          </Button>
        </form>
      )}
    </main>
  );
}
