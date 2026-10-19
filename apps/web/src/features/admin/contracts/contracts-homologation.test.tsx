import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_HOMOLOGATION_RULES,
  CONTRACT_VARIABLES,
  DEFAULT_CONTRACT_TEMPLATE,
} from '@voltex/shared';
import { API, distributor, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const template = (over = {}) => ({
  version: null,
  name: 'Modelo-base (sem revisão jurídica)',
  body: DEFAULT_CONTRACT_TEMPLATE,
  isDefault: true,
  variables: [...CONTRACT_VARIABLES],
  createdAt: null,
  ...over,
});

describe('Administração · Contratos', () => {
  it('avisa que o modelo-base não tem revisão jurídica e lista as variáveis', async () => {
    server.use(http.get(`${API}/contract-template`, () => HttpResponse.json(template())));
    renderApp('/admin/contratos', { session: makeSession('SALES_MANAGER') });
    expect(await screen.findByText(/modelo-base/, { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('{{cliente.nome}}')).toBeInTheDocument();
  });

  it('recusa variável desconhecida antes de enviar e publica o modelo válido', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/contract-template`, () => HttpResponse.json(template())),
      http.put(`${API}/contract-template`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          template({
            version: 1,
            isDefault: false,
            name: 'Meu modelo',
            createdAt: '2026-10-19T12:00:00.000Z',
          }),
        );
      }),
    );
    renderApp('/admin/contratos', { session: makeSession('OWNER') });
    const user = userEvent.setup();
    const area = await screen.findByLabelText('Texto do contrato');
    await user.click(area);
    await user.paste(' {{cliente.nomee}}');
    await user.click(screen.getByRole('button', { name: 'Publicar modelo' }));
    expect(
      await screen.findByText(/Variáveis desconhecidas: \{\{cliente.nomee\}\}/),
    ).toBeInTheDocument();
    expect(body).toBeUndefined();

    await user.clear(area);
    await user.click(area);
    await user.paste(
      'CONTRATO\n\nCliente {{cliente.nome}} compra por {{contrato.valor}} o projeto {{projeto.codigo}}.',
    );
    await user.click(screen.getByRole('button', { name: 'Publicar modelo' }));
    await waitFor(() =>
      expect(body).toMatchObject({ body: expect.stringContaining('{{contrato.valor}}') }),
    );
  });

  it('vendedor não vê a aba de contratos na administração', async () => {
    renderApp('/admin/contratos', { session: makeSession('SALESPERSON') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });
});

describe('Administração · Homologação', () => {
  const rules = () => [
    {
      ...BUILT_IN_HOMOLOGATION_RULES,
      id: null,
      distributorId: null,
      distributorName: null,
      createdAt: null,
    },
    {
      ref: 'distribuidora:d1@2',
      version: 2,
      scope: 'DISTRIBUTOR',
      source: 'Norma da CEEE-D, rev. 2026',
      reviewedBy: 'Rafael Responsável Técnico',
      notes: null,
      items: BUILT_IN_HOMOLOGATION_RULES.items.slice(0, 3),
      deadlines: [],
      id: 'r2',
      distributorId: 'd1',
      distributorName: 'CEEE-D',
      createdAt: '2026-10-19T12:00:00.000Z',
    },
  ];

  it('lista a base e as versões publicadas, com fonte e revisão', async () => {
    server.use(http.get(`${API}/homologation/checklists`, () => HttpResponse.json(rules())));
    renderApp('/admin/homologacao', { session: makeSession('OWNER') });
    expect(await screen.findByText('energif-2023@1')).toBeInTheDocument();
    expect(screen.getByText('Sem revisão')).toBeInTheDocument();
    expect(screen.getByText('Revisada por Rafael Responsável Técnico')).toBeInTheDocument();
    expect(screen.getByText(/Norma da CEEE-D, rev. 2026/)).toBeInTheDocument();
    expect(screen.getByText(/não substitui a exigência/)).toBeInTheDocument();
  });

  it('publica regras: exige a fonte e envia itens e prazos', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/homologation/checklists`, () => HttpResponse.json(rules())),
      http.get(`${API}/distributors`, () =>
        HttpResponse.json([distributor({ id: 'd1', name: 'CEEE-D' })]),
      ),
      http.post(`${API}/homologation/checklists`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(rules()[1], { status: 201 });
      }),
    );
    renderApp('/admin/homologacao', { session: makeSession('OWNER') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Publicar regras/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    expect(await within(dialog).findByText(/Informe a fonte das regras/)).toBeInTheDocument();
    expect(body).toBeUndefined();

    await user.selectOptions(within(dialog).getByLabelText('Vale para'), 'd1');
    await user.type(
      within(dialog).getByLabelText('Fonte das regras'),
      'Norma da CEEE-D, rev. 2026',
    );
    await user.type(within(dialog).getByLabelText('Dias: Parecer de acesso'), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      distributorId: 'd1',
      source: 'Norma da CEEE-D, rev. 2026',
      deadlines: [{ code: 'ACCESS_OPINION', days: 30, source: 'Norma da CEEE-D, rev. 2026' }],
    });
    expect((body!.items as { code: string }[]).map((i) => i.code)).toContain('SINGLE_LINE');
  });

  it('quem só lê regras (engenharia) não vê o botão de publicar', async () => {
    server.use(http.get(`${API}/homologation/checklists`, () => HttpResponse.json(rules())));
    renderApp('/admin/homologacao', { session: makeSession('ENGINEERING') });
    expect(await screen.findByText('energif-2023@1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publicar regras/ })).not.toBeInTheDocument();
  });
});
