import { Copy } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription, Button, Input, Spinner, toast } from '@voltex/ui';
import type { MfaSetupDto } from '@voltex/shared';
import { QrCode } from '@/components/qr-code';

/** Cadastro do aplicativo: QR code, chave para digitar à mão e campo do primeiro código. */
export function MfaSetupForm({
  setup,
  onConfirm,
  busy,
  error,
}: {
  setup: MfaSetupDto;
  onConfirm: (code: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [code, setCode] = useState('');
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm(code.trim());
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Abra o aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…).
        </li>
        <li>Leia o QR code ou digite a chave abaixo.</li>
        <li>Informe aqui o código de 6 dígitos que o aplicativo mostrar.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        <QrCode value={setup.otpauthUri} label="QR code para o aplicativo autenticador" />
        <div className="space-y-1 text-sm">
          <p className="text-xs text-muted-foreground">Chave para digitar</p>
          <p
            className="break-all font-mono text-base tracking-wider"
            aria-label="Chave do aplicativo"
          >
            {setup.secret.match(/.{1,4}/g)?.join(' ')}
          </p>
        </div>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="mfa-setup-code" className="text-sm font-medium">
          Código do aplicativo
        </label>
        <Input
          id="mfa-setup-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          autoFocus
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
        {busy ? <Spinner /> : null}
        Confirmar e ativar
      </Button>
    </form>
  );
}

/** Códigos de recuperação: mostrados uma única vez; a pessoa precisa confirmar que os guardou. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Códigos copiados.');
    } catch {
      toast.error('Não foi possível copiar: anote os códigos à mão.');
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Guarde estes códigos em local seguro. Cada um vale uma vez e entra no lugar do aplicativo se
        você perder o aparelho. Eles <strong>não serão mostrados de novo</strong>.
      </p>
      <ul
        aria-label="Códigos de recuperação"
        className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          <Copy /> Copiar
        </Button>
        <Button type="button" onClick={onDone}>
          Já guardei os códigos
        </Button>
      </div>
    </div>
  );
}
