import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Loader, CheckCircle } from 'lucide-react';

export function PortalAccess() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const exchangeToken = async () => {
      if (!token) {
        setStatus('error');
        setMessage('Token não fornecido');
        return;
      }

      try {
        const res = await fetch('/api/v1/public/portal/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          credentials: 'include',
        });

        if (res.status === 410) {
          setStatus('error');
          setMessage('Link expirado, inválido ou já utilizado');
          return;
        }

        if (!res.ok) {
          setStatus('error');
          setMessage('Erro ao validar link');
          return;
        }

        setStatus('success');
        setMessage('Acesso concedido!');

        setTimeout(() => navigate('/portal/dashboard'), 2000);
      } catch (err) {
        setStatus('error');
        setMessage('Erro de conexão');
      }
    };

    exchangeToken();
  }, [token, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {status === 'loading' && <Loader className="w-8 h-8 animate-spin mx-auto mb-2" />}
          {status === 'success' && <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />}
          {status === 'error' && <AlertCircle className="w-8 h-8 text-red-600 mx-auto mb-2" />}

          <CardTitle>
            {status === 'loading' && 'Carregando...'}
            {status === 'success' && 'Bem-vindo!'}
            {status === 'error' && 'Erro'}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'loading' && (
            <p className="text-center text-sm text-gray-600">
              Validando seu link. Aguarde um momento...
            </p>
          )}
          {status === 'success' && (
            <p className="text-center text-sm text-gray-600">Você será redirecionado em breve.</p>
          )}
          {status === 'error' && (
            <div className="space-y-2">
              <p className="text-center text-sm text-gray-600">
                Não foi possível processar seu acesso.
              </p>
              <a
                href="/portal/entrar"
                className="block text-center text-blue-600 hover:underline text-sm"
              >
                Solicitar novo link
              </a>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
