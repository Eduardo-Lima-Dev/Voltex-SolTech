import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, branch, makeSession, team } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const tenant = {
  id: 't',
  name: 'Voltex Demo',
  slug: 'voltex-demo',
  document: '12.345.678/0001-90',
  status: 'ACTIVE',
  settings: {},
  createdAt: '2026-01-01T00:00:00Z',
};
const handlers = () => [
  http.get(`${API}/tenant`, () => HttpResponse.json(tenant)),
  http.get(`${API}/branches`, () => HttpResponse.json([branch()])),
  http.get(`${API}/teams`, () => HttpResponse.json([team()])),
  http.get(`${API}/branding`, () => HttpResponse.json({})),
];

const withBase = (...overrides: Parameters<typeof server.use>) =>
  server.use(...overrides, ...handlers());

describe('CompanyPage', () => {
  it('mostra dados da empresa, filiais e times', async () => {
    withBase();
    renderApp('/admin/empresa');
    expect(await screen.findByDisplayValue('Voltex Demo')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12.345.678/0001-90')).toBeInTheDocument();
    expect(await screen.findByText('Fortaleza / CE')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Comercial' })).toBeInTheDocument();
  });

  it('só salva quando há alteração e envia documento vazio como null', async () => {
    let body: unknown;
    withBase(
      http.patch(`${API}/tenant`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(tenant);
      }),
    );
    renderApp('/admin/empresa');
    const save = await screen.findByRole('button', { name: 'Salvar alterações' });
    expect(save).toBeDisabled();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('CNPJ'));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText('Dados da empresa atualizados')).toBeInTheDocument();
    expect(body).toEqual({ name: 'Voltex Demo', document: null });
  });

  it('valida o nome da empresa', async () => {
    withBase();
    renderApp('/admin/empresa');
    const user = userEvent.setup();
    const name = await screen.findByLabelText('Nome da empresa');
    await user.clear(name);
    await user.type(name, 'A');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('Informe o nome da empresa')).toBeInTheDocument();
  });

  it('cria uma filial (UF em maiúsculas pelo seletor)', async () => {
    let body: unknown;
    withBase(
      http.post(`${API}/branches`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(branch({ id: 'b-2', name: 'Filial Sul' }), { status: 201 });
      }),
    );
    renderApp('/admin/empresa');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nova filial' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome'), 'Filial Sul');
    await user.type(within(dialog).getByLabelText('Cidade'), 'Porto Alegre');
    await user.selectOptions(within(dialog).getByLabelText('UF'), 'RS');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Filial criada')).toBeInTheDocument();
    expect(body).toEqual({ name: 'Filial Sul', city: 'Porto Alegre', state: 'RS' });
  });

  it('excluir filial com usuários vinculados mostra o motivo devolvido pela API', async () => {
    withBase(
      http.delete(`${API}/branches/b-1`, () =>
        HttpResponse.json(
          { statusCode: 409, code: 'CONFLICT', message: 'A filial possui usuários vinculados' },
          { status: 409 },
        ),
      ),
    );
    renderApp('/admin/empresa');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Excluir Matriz' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }),
    );
    expect(await screen.findByText('A filial possui usuários vinculados')).toBeInTheDocument();
  });

  it('cria um time vinculado a uma filial', async () => {
    let body: unknown;
    withBase(
      http.post(`${API}/teams`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(team({ id: 't-2', name: 'Pós-venda' }), { status: 201 });
      }),
    );
    renderApp('/admin/empresa');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Novo time' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome'), 'Pós-venda');
    await user.selectOptions(within(dialog).getByLabelText('Filial'), 'b-1');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Time criado')).toBeInTheDocument();
    expect(body).toEqual({ name: 'Pós-venda', branchId: 'b-1' });
  });

  it('quem não gerencia a empresa vê as páginas sem acesso (Empresa exige platform.tenant.manage)', async () => {
    renderApp('/admin/empresa', { session: makeSession('SALES_MANAGER') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });
});
