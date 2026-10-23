import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const sessionBody = () => {
  const s = makeSession('OWNER');
  return { accessToken: 'token-de-acesso', expiresIn: 900, user: s.user };
};

const fillLogin = async () => {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('E-mail'), 'owner@voltex.test');
  await user.type(screen.getByLabelText('Senha', { exact: true }), 'Voltex@2026');
  await user.click(screen.getByRole('button', { name: /Entrar/ }));
  return user;
};

describe('Segundo fator no login', () => {
  it('pede o código depois da senha e abre a sessão com ele', async () => {
    let sent: unknown;
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({ status: 'MFA_REQUIRED', mfaToken: 'x'.repeat(40), expiresIn: 300 }),
      ),
      http.post(`${API}/auth/mfa/verify`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(sessionBody());
      }),
    );
    renderApp('/login', { session: null });
    const user = await fillLogin();
    await user.type(await screen.findByLabelText('Código'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));
    await waitFor(() => expect(sent).toEqual({ mfaToken: 'x'.repeat(40), code: '123456' }));
  });

  it('código incorreto mostra o aviso e mantém a etapa', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({ status: 'MFA_REQUIRED', mfaToken: 'x'.repeat(40), expiresIn: 300 }),
      ),
      http.post(`${API}/auth/mfa/verify`, () =>
        HttpResponse.json(
          { statusCode: 401, code: 'UNAUTHORIZED', message: 'Código inválido' },
          { status: 401 },
        ),
      ),
    );
    renderApp('/login', { session: null });
    const user = await fillLogin();
    await user.type(await screen.findByLabelText('Código'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByText(/Código incorreto ou já usado/)).toBeInTheDocument();
    expect(screen.getByLabelText('Código')).toBeInTheDocument();
  });

  it('"Voltar" retorna ao formulário de senha', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({ status: 'MFA_REQUIRED', mfaToken: 'x'.repeat(40), expiresIn: 300 }),
      ),
    );
    renderApp('/login', { session: null });
    const user = await fillLogin();
    await user.click(await screen.findByRole('button', { name: 'Voltar' }));
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
  });

  it('empresa que exige: cadastra o aplicativo no login e só entra depois de guardar os códigos', async () => {
    let confirmed: unknown;
    server.use(
      http.post(`${API}/auth/login`, () =>
        HttpResponse.json({
          status: 'MFA_SETUP_REQUIRED',
          mfaToken: 'y'.repeat(40),
          expiresIn: 300,
        }),
      ),
      http.post(`${API}/auth/mfa/login/setup`, () =>
        HttpResponse.json({
          secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/Voltex:owner@voltex.test?secret=JBSWY3DPEHPK3PXP',
        }),
      ),
      http.post(`${API}/auth/mfa/login/confirm`, async ({ request }) => {
        confirmed = await request.json();
        return HttpResponse.json({
          ...sessionBody(),
          recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'],
        });
      }),
    );
    renderApp('/login', { session: null });
    const user = await fillLogin();
    expect(await screen.findByLabelText('Chave do aplicativo')).toHaveTextContent('JBSW Y3DP EHPK');
    await user.type(screen.getByLabelText('Código do aplicativo'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirmar e ativar' }));
    await waitFor(() => expect(confirmed).toEqual({ mfaToken: 'y'.repeat(40), code: '654321' }));
    expect(await screen.findByText('AAAAA-BBBBB')).toBeInTheDocument();
    // Ainda não entrou: a sessão só abre depois de a pessoa confirmar que guardou os códigos.
    expect(screen.queryByRole('heading', { name: 'Início' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Já guardei os códigos' }));
    await waitFor(() => expect(screen.queryByText('AAAAA-BBBBB')).not.toBeInTheDocument());
  });
});

describe('Segurança da conta', () => {
  it('ativa o aplicativo, mostra os códigos de recuperação e atualiza o estado', async () => {
    let status = { enabled: false, required: false, recoveryCodesLeft: 0 };
    server.use(
      http.get(`${API}/auth/mfa/status`, () => HttpResponse.json(status)),
      http.post(`${API}/auth/mfa/setup`, () =>
        HttpResponse.json({
          secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/Voltex:u?secret=JBSWY3DPEHPK3PXP',
        }),
      ),
      http.post(`${API}/auth/mfa/confirm`, () => {
        status = { enabled: true, required: false, recoveryCodesLeft: 10 };
        return HttpResponse.json({ recoveryCodes: ['AAAAA-BBBBB'] });
      }),
      http.get(`${API}/auth/mfa/policy`, () => HttpResponse.json({ required: false, roles: [] })),
    );
    renderApp('/conta/seguranca', { session: makeSession('SALESPERSON') });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Ativar verificação em duas etapas' }),
    );
    await user.type(await screen.findByLabelText('Código do aplicativo'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirmar e ativar' }));
    expect(await screen.findByText('AAAAA-BBBBB')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Já guardei os códigos' }));
    expect(await screen.findByText('Ativa')).toBeInTheDocument();
    expect(screen.queryByText('Política da empresa')).not.toBeInTheDocument();
  });

  it('administrador define a política da empresa por perfil', async () => {
    let saved: unknown;
    server.use(
      http.get(`${API}/auth/mfa/status`, () =>
        HttpResponse.json({ enabled: false, required: false, recoveryCodesLeft: 0 }),
      ),
      http.get(`${API}/auth/mfa/policy`, () => HttpResponse.json({ required: false, roles: [] })),
      http.put(`${API}/auth/mfa/policy`, async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json(saved);
      }),
    );
    renderApp('/conta/seguranca', { session: makeSession('ADMIN') });
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Exigir a verificação em duas etapas'));
    await user.click(await screen.findByLabelText('Vendedor'));
    await user.click(screen.getByRole('button', { name: 'Salvar política' }));
    await waitFor(() => expect(saved).toEqual({ required: true, roles: ['SALESPERSON'] }));
  });

  it('com política exigindo, não oferece desativar', async () => {
    server.use(
      http.get(`${API}/auth/mfa/status`, () =>
        HttpResponse.json({ enabled: true, required: true, recoveryCodesLeft: 7 }),
      ),
    );
    renderApp('/conta/seguranca', { session: makeSession('SALESPERSON') });
    expect(await screen.findByText(/enquanto a política da empresa exigir/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument();
  });
});
