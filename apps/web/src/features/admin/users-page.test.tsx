import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Role, UserSummary } from '@voltex/shared';
import { API, branch, makeSession, makeUserSummary, team } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const page = (data: UserSummary[], total = data.length, pageNo = 1) =>
  HttpResponse.json({ data, meta: { page: pageNo, pageSize: 10, total } });

const people = {
  owner: makeUserSummary({
    id: 'user-owner',
    name: 'Eduardo Silva',
    email: 'owner@voltex.test',
    role: 'OWNER',
    lastLoginAt: new Date().toISOString(),
  }),
  admin: makeUserSummary({
    id: 'u-admin',
    name: 'Ana Admin',
    email: 'ana@voltex.test',
    role: 'ADMIN',
  }),
  seller: makeUserSummary({
    id: 'u-seller',
    name: 'Victor Vendedor',
    email: 'victor@voltex.test',
    role: 'SALESPERSON',
    isActive: false,
  }),
};

const baseHandlers = () => [
  http.get(`${API}/users`, () => page([people.owner, people.admin, people.seller])),
  http.get(`${API}/invitations`, () => HttpResponse.json([])),
  http.get(`${API}/branches`, () => HttpResponse.json([branch()])),
  http.get(`${API}/teams`, () => HttpResponse.json([team()])),
];

/** Handlers específicos do teste vêm ANTES dos padrões: o MSW usa o primeiro que casa. */
const withBase = (...overrides: Parameters<typeof server.use>) =>
  server.use(...overrides, ...baseHandlers());

describe('UsersPage', () => {
  it('lista os usuários com perfil, situação e último acesso', async () => {
    withBase();
    renderApp('/admin/usuarios');
    expect(await screen.findByText('Ana Admin')).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Victor Vendedor/ });
    expect(within(row).getByText('Vendedor')).toBeInTheDocument();
    expect(within(row).getByText('Inativo')).toBeInTheDocument();
    expect(within(row).getByText('Nunca entrou')).toBeInTheDocument();
    expect(screen.getByText('1–3 de 3')).toBeInTheDocument();
  });

  it('busca com atraso (debounce) e filtra por perfil e situação enviando os parâmetros certos', async () => {
    const queries: URLSearchParams[] = [];
    withBase(
      http.get(`${API}/users`, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return page([people.admin]);
      }),
    );
    renderApp('/admin/usuarios');
    await screen.findByText('Ana Admin');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Buscar usuários'), 'ana');
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('ana'));
    // O debounce evita uma requisição por letra digitada.
    expect(queries.filter((q) => q.get('search')).length).toBe(1);

    await user.selectOptions(screen.getByLabelText('Filtrar por perfil'), 'ADMIN');
    await waitFor(() => expect(queries.at(-1)?.get('role')).toBe('ADMIN'));
    await user.selectOptions(screen.getByLabelText('Filtrar por situação'), 'false');
    await waitFor(() => expect(queries.at(-1)?.get('isActive')).toBe('false'));
    expect(queries.at(-1)?.get('page')).toBe('1');
  });

  it('pagina e volta para a página 1 ao mudar um filtro', async () => {
    const pages: string[] = [];
    withBase(
      http.get(`${API}/users`, ({ request }) => {
        const p = new URL(request.url).searchParams.get('page') ?? '1';
        pages.push(p);
        return page([people.admin], 25, Number(p));
      }),
    );
    renderApp('/admin/usuarios');
    await screen.findByText('1–10 de 25');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Próxima/ }));
    await screen.findByText(/2 \/ 3/);
    expect(pages.at(-1)).toBe('2');
    await user.selectOptions(screen.getByLabelText('Filtrar por situação'), 'true');
    await waitFor(() => expect(pages.at(-1)).toBe('1'));
  });

  it('mostra mensagem quando nenhum usuário bate com os filtros', async () => {
    withBase(http.get(`${API}/users`, () => page([])));
    renderApp('/admin/usuarios');
    expect(
      await screen.findByText('Nenhum usuário encontrado com esses filtros.'),
    ).toBeInTheDocument();
  });

  it('mostra erro de carregamento sem quebrar a tela', async () => {
    withBase(
      http.get(`${API}/users`, () =>
        HttpResponse.json({ statusCode: 400, code: 'BAD_REQUEST', message: 'x' }, { status: 400 }),
      ),
    );
    renderApp('/admin/usuarios');
    expect(await screen.findByText('Não foi possível carregar os usuários.')).toBeInTheDocument();
  });

  it('proprietário edita outros usuários; não há ações na própria linha', async () => {
    withBase();
    renderApp('/admin/usuarios');
    await screen.findByText('Ana Admin');
    expect(screen.getByRole('button', { name: 'Editar Ana Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar Eduardo Silva' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir Eduardo Silva' })).not.toBeInTheDocument();
    expect(screen.getByText('(você)')).toBeInTheDocument();
  });

  it('ADMIN não gerencia o OWNER (sem botões na linha dele), mas gerencia os demais', async () => {
    withBase();
    renderApp('/admin/usuarios', { session: makeSession('ADMIN', { id: 'u-admin' }) });
    await screen.findByText('Victor Vendedor');
    expect(screen.queryByRole('button', { name: 'Editar Eduardo Silva' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar Victor Vendedor' })).toBeInTheDocument();
  });

  it('gestor comercial só consulta: sem convidar, sem editar, sem convites', async () => {
    withBase();
    renderApp('/admin/usuarios', { session: makeSession('SALES_MANAGER') });
    await screen.findByText('Ana Admin');
    expect(screen.queryByRole('button', { name: 'Convidar usuário' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Convites')).not.toBeInTheDocument();
  });

  it('edita enviando só os campos alterados e confirma com aviso', async () => {
    let body: unknown;
    withBase(
      http.patch(`${API}/users/u-admin`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...people.admin, name: 'Ana Renomeada' });
      }),
    );
    renderApp('/admin/usuarios');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Editar Ana Admin' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Nome'));
    await user.type(within(dialog).getByLabelText('Nome'), 'Ana Renomeada');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Usuário atualizado')).toBeInTheDocument();
    expect(body).toEqual({ name: 'Ana Renomeada' });
  });

  it('desativar usuário pelo interruptor envia isActive:false', async () => {
    let body: unknown;
    withBase(
      http.patch(`${API}/users/u-admin`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...people.admin, isActive: false });
      }),
    );
    renderApp('/admin/usuarios');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Editar Ana Admin' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('switch', { name: 'Usuário ativo' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Usuário atualizado');
    expect(body).toEqual({ isActive: false });
  });

  it('validação do nome na edição e erro da API aparecem sem fechar o diálogo', async () => {
    withBase(
      http.patch(`${API}/users/u-admin`, () =>
        HttpResponse.json(
          { statusCode: 403, code: 'FORBIDDEN', message: 'Você não pode conceder este perfil' },
          { status: 403 },
        ),
      ),
    );
    renderApp('/admin/usuarios');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Editar Ana Admin' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Nome'));
    await user.type(within(dialog).getByLabelText('Nome'), 'A');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await within(dialog).findByText(/mínimo de 2 caracteres/)).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('Nome'));
    await user.type(within(dialog).getByLabelText('Nome'), 'Ana Nova');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Você não pode conceder este perfil')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('exclui com confirmação (e não exclui se cancelar)', async () => {
    let deleted = 0;
    withBase(
      http.delete(`${API}/users/u-seller`, () => {
        deleted++;
        return HttpResponse.json({ id: 'u-seller' });
      }),
    );
    renderApp('/admin/usuarios');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Excluir Victor Vendedor' }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(deleted).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Excluir Victor Vendedor' }));
    const alert = await screen.findByRole('alertdialog');
    expect(alert).toHaveTextContent('perderá o acesso imediatamente');
    await user.click(within(alert).getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText('Usuário excluído')).toBeInTheDocument();
    expect(deleted).toBe(1);
  });

  describe('convites', () => {
    it('ADMIN só pode convidar para perfis abaixo de proprietário', async () => {
      withBase();
      renderApp('/admin/usuarios', { session: makeSession('ADMIN', { id: 'u-admin' }) });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Convidar usuário' }));
      const dialog = await screen.findByRole('dialog');
      const options = within(within(dialog).getByLabelText('Perfil'))
        .getAllByRole('option')
        .map((o) => o.textContent);
      expect(options).not.toContain('Proprietário');
      expect(options).toContain('Vendedor');
    });

    it('envia o convite e, fora de produção, mostra o link para copiar', async () => {
      let body: Record<string, unknown> = {};
      withBase(
        http.post(`${API}/invitations`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            {
              id: 'i-1',
              email: 'nova@pessoa.test',
              role: 'ENGINEERING',
              expiresAt: '2026-10-25T00:00:00Z',
              createdAt: '2026-10-18T00:00:00Z',
              emailSent: true,
              devAcceptUrl: 'http://localhost:5173/accept-invitation?token=abc123',
            },
            { status: 201 },
          );
        }),
      );
      renderApp('/admin/usuarios');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Convidar usuário' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('E-mail'), 'Nova@Pessoa.test');
      await user.selectOptions(within(dialog).getByLabelText('Perfil'), 'ENGINEERING');
      await user.click(within(dialog).getByRole('button', { name: 'Enviar convite' }));

      expect(await screen.findByLabelText('Link do convite')).toHaveValue(
        'http://localhost:5173/accept-invitation?token=abc123',
      );
      expect(body).toMatchObject({ email: 'nova@pessoa.test', role: 'ENGINEERING' });
      expect(screen.getByText('Convite enviado para nova@pessoa.test')).toBeInTheDocument();
    });

    it('e-mail já cadastrado (409) vira erro no campo', async () => {
      withBase(
        http.post(`${API}/invitations`, () =>
          HttpResponse.json(
            { statusCode: 409, code: 'CONFLICT', message: 'Já existe um usuário com este e-mail' },
            { status: 409 },
          ),
        ),
      );
      renderApp('/admin/usuarios');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Convidar usuário' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('E-mail'), 'ana@voltex.test');
      await user.click(within(dialog).getByRole('button', { name: 'Enviar convite' }));
      expect(
        await within(dialog).findByText('Já existe um usuário com este e-mail.'),
      ).toBeInTheDocument();
    });

    it('valida o e-mail antes de enviar', async () => {
      withBase();
      renderApp('/admin/usuarios');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Convidar usuário' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('E-mail'), 'sem-arroba');
      await user.click(within(dialog).getByRole('button', { name: 'Enviar convite' }));
      expect(await within(dialog).findByText(/e-mail inválido/i)).toBeInTheDocument();
    });

    it('lista convites com situação e permite revogar só os pendentes', async () => {
      let revoked = '';
      withBase(
        http.get(`${API}/invitations`, () =>
          HttpResponse.json([
            {
              id: 'i-1',
              email: 'pendente@x.test',
              role: 'SDR' as Role,
              expiresAt: '2026-12-01T00:00:00Z',
              acceptedAt: null,
              revokedAt: null,
              createdAt: '2026-10-01T00:00:00Z',
              status: 'PENDING',
            },
            {
              id: 'i-2',
              email: 'aceito@x.test',
              role: 'SDR' as Role,
              expiresAt: '2026-12-01T00:00:00Z',
              acceptedAt: '2026-10-02T00:00:00Z',
              revokedAt: null,
              createdAt: '2026-10-01T00:00:00Z',
              status: 'ACCEPTED',
            },
          ]),
        ),
        http.delete(`${API}/invitations/i-1`, () => {
          revoked = 'i-1';
          return HttpResponse.json({ id: 'i-1' });
        }),
      );
      renderApp('/admin/usuarios');
      const user = userEvent.setup();
      expect(await screen.findByText('pendente@x.test')).toBeInTheDocument();
      expect(screen.getByText('Pendente')).toBeInTheDocument();
      expect(screen.getByText('Aceito')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Revogar convite de aceito@x.test' }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Revogar convite de pendente@x.test' }));
      await user.click(
        await within(await screen.findByRole('alertdialog')).findByRole('button', {
          name: 'Revogar',
        }),
      );
      expect(await screen.findByText('Convite revogado')).toBeInTheDocument();
      expect(revoked).toBe('i-1');
    });
  });
});
