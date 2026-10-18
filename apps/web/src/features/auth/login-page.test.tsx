import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const fillAndSubmit = async (email: string, password: string) => {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText('E-mail'), email);
  if (password) await user.type(screen.getByLabelText('Senha', { exact: true }), password);
  await user.click(screen.getByRole('button', { name: /Entrar/ }));
  return user;
};

describe('LoginPage', () => {
  it('valida os campos em português antes de chamar a API', async () => {
    renderApp('/login', { session: null });
    await screen.findByRole('heading', { name: 'Entrar na sua conta' });
    await fillAndSubmit('', '');
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThanOrEqual(2);
    await fillAndSubmit('nao-e-email', '123');
    expect(await screen.findByText(/e-mail inválido/i)).toBeInTheDocument();
    expect(await screen.findByText('A senha deve ter no mínimo 8 caracteres')).toBeInTheDocument();
  });

  it('credenciais erradas (401) mostram mensagem clara e mantêm o formulário', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json(
          { statusCode: 401, code: 'UNAUTHORIZED', message: 'Credenciais inválidas' },
          { status: 401 },
        ),
      ),
    );
    renderApp('/login', { session: null });
    await screen.findByRole('heading', { name: 'Entrar na sua conta' });
    await fillAndSubmit('owner@voltex.test', 'senhaerrada1');
    expect(await screen.findByText('E-mail ou senha incorretos.')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveValue('owner@voltex.test');
  });

  it.each([
    [429, 'Muitas tentativas de login. Aguarde um minuto e tente de novo.'],
    [500, 'O servidor encontrou um problema. Tente novamente em instantes.'],
  ])('status %s mostra a mensagem apropriada', async (status, message) => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({ statusCode: status, code: 'X', message: 'x' }, { status }),
      ),
    );
    renderApp('/login', { session: null });
    await screen.findByRole('heading', { name: 'Entrar na sua conta' });
    await fillAndSubmit('owner@voltex.test', 'Voltex@2026');
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('falha de rede mostra aviso de conexão', async () => {
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.error()));
    renderApp('/login', { session: null });
    await screen.findByRole('heading', { name: 'Entrar na sua conta' });
    await fillAndSubmit('owner@voltex.test', 'Voltex@2026');
    expect(await screen.findByText(/Não foi possível conectar ao servidor/)).toBeInTheDocument();
  });

  it('envia o e-mail normalizado e entra', async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/auth/login`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeSession('SALESPERSON'));
      }),
    );
    renderApp('/login', { session: null });
    await screen.findByRole('heading', { name: 'Entrar na sua conta' });
    await fillAndSubmit('  Vendedor@Voltex.Test ', 'Voltex@2026');
    expect(await screen.findByRole('heading', { name: /Olá, Eduardo/ })).toBeInTheDocument();
    expect(body).toEqual({ email: 'vendedor@voltex.test', password: 'Voltex@2026' });
  });

  it('o botão de olho alterna a visibilidade da senha', async () => {
    renderApp('/login', { session: null });
    await screen.findByRole('heading', { name: 'Entrar na sua conta' });
    const input = screen.getByLabelText('Senha', { exact: true });
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('desabilita o botão enquanto envia (evita duplo clique)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.post(`${API}/auth/login`, async () => {
        await gate;
        return HttpResponse.json(makeSession('OWNER'));
      }),
      http.get(`${API}/health`, () =>
        HttpResponse.json({ status: 'ok', uptimeSeconds: 1, checks: {} }),
      ),
    );
    renderApp('/login', { session: null });
    await screen.findByRole('heading', { name: 'Entrar na sua conta' });
    await fillAndSubmit('owner@voltex.test', 'Voltex@2026');
    expect(await screen.findByRole('button', { name: /Entrar/ })).toBeDisabled();
    release();
    // Espera o login terminar: uma sessão aberta depois do teste vazaria para o seguinte.
    expect(await screen.findByRole('heading', { name: /Olá, Eduardo/ })).toBeInTheDocument();
  });
});

describe('AcceptInvitationPage', () => {
  it('sem token no link mostra convite inválido', async () => {
    renderApp('/accept-invitation', { session: null });
    expect(await screen.findByRole('heading', { name: 'Convite inválido' })).toBeInTheDocument();
  });

  it('exige senhas iguais e senha forte, depois cria a conta e entra', async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/invitations/accept`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeSession('ENGINEERING'));
      }),
    );
    renderApp('/accept-invitation?token=abcdefghijklmnopqrstuvwxyz0123456789', { session: null });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Crie sua conta' });

    await user.type(screen.getByLabelText('Nome completo'), 'Nova Pessoa');
    await user.type(screen.getByLabelText('Senha', { exact: true }), 'Senha@12345');
    await user.type(screen.getByLabelText('Confirmar senha'), 'Diferente@123');
    await user.click(screen.getByRole('button', { name: /Criar conta/ }));
    expect(await screen.findByText('As senhas não coincidem')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Confirmar senha'));
    await user.type(screen.getByLabelText('Confirmar senha'), 'Senha@12345');
    await user.click(screen.getByRole('button', { name: /Criar conta/ }));
    expect(await screen.findByRole('heading', { name: /Olá, Eduardo/ })).toBeInTheDocument();
    expect(body).toEqual({
      token: 'abcdefghijklmnopqrstuvwxyz0123456789',
      name: 'Nova Pessoa',
      password: 'Senha@12345',
    });
  });

  it('senha fraca é recusada no cliente (sem chamar a API)', async () => {
    renderApp('/accept-invitation?token=abcdefghijklmnopqrstuvwxyz0123456789', { session: null });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Crie sua conta' });
    await user.type(screen.getByLabelText('Nome completo'), 'Nova Pessoa');
    await user.type(screen.getByLabelText('Senha', { exact: true }), 'curta1');
    await user.type(screen.getByLabelText('Confirmar senha'), 'curta1');
    await user.click(screen.getByRole('button', { name: /Criar conta/ }));
    expect(await screen.findByText('A senha deve ter no mínimo 8 caracteres')).toBeInTheDocument();
  });

  it.each([
    [400, /inválido, expirou ou já foi usado/],
    [409, /Já existe uma conta com o e-mail deste convite/],
  ])('erro %s da API mostra explicação', async (status, message) => {
    server.use(
      http.post(`${API}/invitations/accept`, () =>
        HttpResponse.json({ statusCode: status, code: 'X', message: 'x' }, { status }),
      ),
    );
    renderApp('/accept-invitation?token=abcdefghijklmnopqrstuvwxyz0123456789', { session: null });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Crie sua conta' });
    await user.type(screen.getByLabelText('Nome completo'), 'Nova Pessoa');
    await user.type(screen.getByLabelText('Senha', { exact: true }), 'Senha@12345');
    await user.type(screen.getByLabelText('Confirmar senha'), 'Senha@12345');
    await user.click(screen.getByRole('button', { name: /Criar conta/ }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
