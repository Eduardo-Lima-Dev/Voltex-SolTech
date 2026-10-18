import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '@voltex/shared';
import { API, makeUserSummary } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

describe('RolesPage', () => {
  it('mostra as permissões do perfil escolhido, agrupadas por produto', async () => {
    server.use(
      http.get(`${API}/users`, () =>
        HttpResponse.json({ data: [], meta: { page: 1, pageSize: 10, total: 0 } }),
      ),
    );
    renderApp('/admin/perfis');
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Vendedor' })).toBeInTheDocument();
    expect(
      screen.getByText(`${ROLE_PERMISSIONS.SALESPERSON.length} permissões`),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Proprietário/ }));
    expect(await screen.findByRole('heading', { name: 'Proprietário' })).toBeInTheDocument();
    expect(screen.getByText(`${ROLE_PERMISSIONS.OWNER.length} permissões`)).toBeInTheDocument();

    for (const group of [
      'Plataforma',
      'CRM Solar',
      'Solar Calculator',
      'Solar Engine Studio',
      'Off-Grid Designer',
    ]) {
      expect(screen.getByRole('heading', { name: new RegExp(group) })).toBeInTheDocument();
    }
  });

  it('Cliente final não tem nenhuma permissão', async () => {
    renderApp('/admin/perfis');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Cliente final/ }));
    expect(await screen.findByText('0 permissões')).toBeInTheDocument();
  });
});

describe('AuditPage', () => {
  const entry = {
    id: 'a-1',
    tenantId: 't',
    actorId: 'u-1',
    action: 'invitation.created',
    entity: 'Invitation',
    entityId: 'i-9',
    before: null,
    after: { email: 'x@y.test', role: 'SDR', token: '[REDACTED]' },
    ip: '203.0.113.9',
    userAgent: 'x',
    requestId: 'req-123',
    createdAt: '2026-10-18T15:30:00.000Z',
  };

  it('lista ações com rótulo em português, nome do autor e detalhes antes/depois', async () => {
    server.use(
      http.get(`${API}/users`, () =>
        HttpResponse.json({
          data: [makeUserSummary({ id: 'u-1', name: 'Ana Admin' })],
          meta: { page: 1, pageSize: 100, total: 1 },
        }),
      ),
      http.get(`${API}/audit-logs`, () =>
        HttpResponse.json({
          data: [
            entry,
            { ...entry, id: 'a-2', actorId: null, action: 'auth.login_failed', entity: 'User' },
          ],
          meta: { page: 1, pageSize: 15, total: 2 },
        }),
      ),
    );
    renderApp('/admin/auditoria');
    const row = await screen.findByRole('row', { name: /Convite enviado/ });
    expect(await within(row).findByText('Ana Admin')).toBeInTheDocument();
    expect(within(row).getByText('Convite')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Tentativa de login recusada/ })).toBeInTheDocument();
    expect(screen.getByText('Sistema')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: /Ver detalhes/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('req-123')).toBeInTheDocument();
    expect(within(dialog).getByText('203.0.113.9')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Depois' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: 'Antes' })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('[REDACTED]');
  });

  it('filtros enviam tipo, ação e período (datas em início/fim do dia)', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/users`, () =>
        HttpResponse.json({ data: [], meta: { page: 1, pageSize: 100, total: 0 } }),
      ),
      http.get(`${API}/audit-logs`, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({ data: [], meta: { page: 1, pageSize: 15, total: 0 } });
      }),
    );
    renderApp('/admin/auditoria');
    const user = userEvent.setup();
    await screen.findByText('Nenhum registro encontrado com esses filtros.');
    await user.selectOptions(screen.getByLabelText('Tipo'), 'Branch');
    await user.selectOptions(screen.getByLabelText('Ação'), 'branch.created');
    await user.type(screen.getByLabelText('De'), '2026-10-01');
    await user.type(screen.getByLabelText('Até'), '2026-10-18');
    await screen.findByText('Nenhum registro encontrado com esses filtros.');
    const last = queries.at(-1)!;
    expect(last.get('entity')).toBe('Branch');
    expect(last.get('action')).toBe('branch.created');
    expect(new Date(last.get('from')!).getTime()).toBe(new Date('2026-10-01T00:00:00').getTime());
    expect(new Date(last.get('to')!).getTime()).toBe(new Date('2026-10-18T23:59:59.999').getTime());
  });
});
