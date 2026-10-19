import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { AccountDetailDto, AccountDto } from '@voltex/shared';
import { API, distributor, makeAccount, makeOpportunity, makeSession, page } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const toList = (a: AccountDetailDto): AccountDto => {
  const { contacts: _c, sites: _s, consumerUnits: _u, ...rest } = a;
  return rest;
};
const error = (status: number, code: string, message: string) =>
  HttpResponse.json({ statusCode: status, code, message }, { status });

const detailHandlers = (
  account = makeAccount(),
  opportunities = [makeOpportunity({ stage: 'QUOTING' })],
) => [
  http.get(`${API}/accounts/${account.id}`, () => HttpResponse.json(account)),
  http.get(`${API}/opportunities`, () => HttpResponse.json(page(opportunities))),
  http.get(`${API}/distributors`, () => HttpResponse.json([distributor()])),
];

describe('CRM · Contas', () => {
  describe('lista', () => {
    it('mostra tipo, segmento e contato; busca com atraso envia o parâmetro', async () => {
      const queries: URLSearchParams[] = [];
      server.use(
        http.get(`${API}/accounts`, ({ request }) => {
          queries.push(new URL(request.url).searchParams);
          return HttpResponse.json(
            page([
              toList(makeAccount()),
              toList(
                makeAccount({
                  id: 'acc-2',
                  name: 'Indústria Alfa',
                  type: 'COMPANY',
                  segment: 'INDUSTRIAL',
                  email: null,
                  phone: null,
                }),
              ),
            ]),
          );
        }),
      );
      renderApp('/crm/contas');
      const row = await screen.findByRole('row', { name: /Maria Silva/ });
      expect(within(row).getByText('Pessoa física')).toBeInTheDocument();
      expect(within(row).getByText('Residencial')).toBeInTheDocument();
      expect(within(row).getByRole('link', { name: 'Maria Silva' })).toHaveAttribute(
        'href',
        '/crm/contas/acc-1',
      );
      expect(
        within(screen.getByRole('row', { name: /Indústria Alfa/ })).getByText('Empresa'),
      ).toBeInTheDocument();
      await userEvent.setup().type(screen.getByLabelText('Buscar contas'), 'alfa');
      await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('alfa'));
    });

    it('estado vazio e erro', async () => {
      server.use(http.get(`${API}/accounts`, () => HttpResponse.json(page([]))));
      const { unmount } = renderApp('/crm/contas');
      expect(await screen.findByText(/Nenhuma conta ainda/)).toBeInTheDocument();
      unmount();
      server.use(http.get(`${API}/accounts`, () => error(500, 'INTERNAL', 'x')));
      renderApp('/crm/contas');
      expect(await screen.findByText('Não foi possível carregar as contas.')).toBeInTheDocument();
    });

    it('cria conta; documento repetido mostra o aviso e valida nome/e-mail antes de enviar', async () => {
      let body: Record<string, unknown> | undefined;
      let attempt = 0;
      server.use(
        http.get(`${API}/accounts`, () => HttpResponse.json(page([]))),
        http.post(`${API}/accounts`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          attempt += 1;
          return attempt === 1
            ? error(409, 'DUPLICATE_ACCOUNT', 'Já existe uma conta com este documento (Titular)')
            : HttpResponse.json(toList(makeAccount()), { status: 201 });
        }),
      );
      renderApp('/crm/contas');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Nova conta/ }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      expect(await within(dialog).findAllByRole('alert')).not.toHaveLength(0);
      expect(body).toBeUndefined();

      await user.type(within(dialog).getByLabelText('Nome'), 'Conta Nova');
      await user.selectOptions(within(dialog).getByLabelText('Tipo'), 'COMPANY');
      await user.type(within(dialog).getByLabelText('CPF/CNPJ'), '111.444.777-35');
      await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      expect(
        await within(dialog).findByText(/Já existe uma conta com este documento/),
      ).toBeInTheDocument();
      expect(body).toMatchObject({
        name: 'Conta Nova',
        type: 'COMPANY',
        document: '111.444.777-35',
      });
      await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
  });

  describe('detalhe', () => {
    it('mostra contatos, imóveis com o levantamento técnico, UCs e oportunidades da conta', async () => {
      server.use(...detailHandlers());
      renderApp('/crm/contas/acc-1');
      expect(
        await screen.findByRole('heading', { name: 'Maria Silva', level: 2 }),
      ).toBeInTheDocument();
      expect(screen.getByText('Principal')).toBeInTheDocument();
      expect(screen.getByText('UC 12345678')).toBeInTheDocument();
      expect(
        screen.getByText(/Enel Ceará · Grupo B \(baixa tensão\) · Bifásico · Residencial/),
      ).toBeInTheDocument();
      expect(screen.getByText('Residência')).toBeInTheDocument();
      expect(screen.getByText(/Rua das Flores, 100 · Centro · Fortaleza\/CE/)).toBeInTheDocument();
      expect(
        screen.getByText(/Telha cerâmica · azimute 0° · inclinação 15° · Sombreamento leve/),
      ).toBeInTheDocument();
      const link = await screen.findByRole('link', { name: 'Casa da Maria' });
      expect(link).toHaveAttribute('href', '/crm/oportunidades/opp-1');
      expect(screen.getByText('Cotação')).toBeInTheDocument();
    });

    it('imóvel sem levantamento avisa que falta preencher', async () => {
      const account = makeAccount({ sites: [{ ...makeAccount().sites[0]!, intake: {} }] });
      server.use(...detailHandlers(account));
      renderApp('/crm/contas/acc-1');
      expect(await screen.findByText('Levantamento técnico não preenchido')).toBeInTheDocument();
    });

    it('conta inexistente mostra mensagem e caminho de volta', async () => {
      server.use(http.get(`${API}/accounts/nada`, () => error(404, 'NOT_FOUND', 'x')));
      renderApp('/crm/contas/nada');
      expect(await screen.findByText('Conta não encontrada.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Voltar às contas' })).toBeInTheDocument();
    });

    it('adiciona um imóvel com o levantamento técnico (números em formato da API)', async () => {
      let body: Record<string, unknown> | undefined;
      server.use(
        ...detailHandlers(),
        http.post(`${API}/accounts/acc-1/sites`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ ...makeAccount().sites[0]!, id: 'site-2' }, { status: 201 });
        }),
      );
      renderApp('/crm/contas/acc-1');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Imóvel/ }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Nome do imóvel'), 'Sítio');
      await user.type(within(dialog).getByLabelText('Cidade'), 'Maracanaú');
      await user.selectOptions(within(dialog).getByLabelText('UF'), 'CE');
      await user.type(within(dialog).getByLabelText('Latitude (°)'), '-3,87');
      await user.selectOptions(within(dialog).getByLabelText('Tipo de telhado'), 'METAL');
      await user.type(within(dialog).getByLabelText('Azimute (°)'), '15,5');
      await user.type(within(dialog).getByLabelText('Inclinação (°)'), '10');
      await user.selectOptions(within(dialog).getByLabelText('Sombreamento'), 'RELEVANT');
      await user.type(within(dialog).getByLabelText('Área disponível (m²)'), '60');
      await user.selectOptions(within(dialog).getByLabelText('Aterramento adequado?'), 'no');
      await user.click(within(dialog).getByRole('switch', { name: 'Visita técnica necessária' }));
      await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(body).toBeDefined());
      expect(body).toMatchObject({
        name: 'Sítio',
        city: 'Maracanaú',
        state: 'CE',
        latitude: -3.87,
        intake: {
          roofType: 'METAL',
          roofAzimuthDegrees: 15.5,
          tiltDegrees: 10,
          shading: 'RELEVANT',
          availableAreaM2: 60,
          groundingAdequate: false,
          technicalVisitRequired: true,
        },
      });
    });

    it('azimute e inclinação fora da faixa mostram a mensagem no campo e não enviam', async () => {
      let calls = 0;
      server.use(
        ...detailHandlers(),
        http.post(
          `${API}/accounts/acc-1/sites`,
          () => ((calls += 1), HttpResponse.json({}, { status: 201 })),
        ),
      );
      renderApp('/crm/contas/acc-1');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Imóvel/ }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Nome do imóvel'), 'Sítio');
      await user.type(within(dialog).getByLabelText('Cidade'), 'Maracanaú');
      await user.selectOptions(within(dialog).getByLabelText('UF'), 'CE');
      await user.type(within(dialog).getByLabelText('Azimute (°)'), '400');
      await user.type(within(dialog).getByLabelText('Inclinação (°)'), '120');
      await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      expect(within(dialog).getByLabelText('Azimute (°)')).toBeInvalid();
      expect(within(dialog).getByLabelText('Inclinação (°)')).toBeInvalid();
      expect(calls).toBe(0);
    });

    it('edita o imóvel já com o levantamento preenchido', async () => {
      let body: { intake?: Record<string, unknown> } | undefined;
      server.use(
        ...detailHandlers(),
        http.patch(`${API}/sites/site-1`, async ({ request }) => {
          body = (await request.json()) as typeof body;
          return HttpResponse.json(makeAccount().sites[0]!);
        }),
      );
      renderApp('/crm/contas/acc-1');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Editar imóvel Residência' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByLabelText('Azimute (°)')).toHaveValue('0');
      expect(within(dialog).getByLabelText('Inclinação (°)')).toHaveValue('15');
      await user.selectOptions(within(dialog).getByLabelText('Sombreamento'), 'RELEVANT');
      await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(body).toBeDefined());
      expect(body?.intake).toMatchObject({
        roofType: 'CERAMIC',
        roofAzimuthDegrees: 0,
        tiltDegrees: 15,
        shading: 'RELEVANT',
      });
    });

    it('adiciona unidade consumidora e contato principal', async () => {
      const calls: { url: string; body: Record<string, unknown> }[] = [];
      server.use(
        ...detailHandlers(),
        http.post(`${API}/accounts/acc-1/consumer-units`, async ({ request }) => {
          calls.push({ url: 'uc', body: (await request.json()) as Record<string, unknown> });
          return HttpResponse.json({}, { status: 201 });
        }),
        http.post(`${API}/accounts/acc-1/contacts`, async ({ request }) => {
          calls.push({ url: 'contact', body: (await request.json()) as Record<string, unknown> });
          return HttpResponse.json({}, { status: 201 });
        }),
      );
      renderApp('/crm/contas/acc-1');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /^UC$/ }));
      let dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Número da UC'), '55667788');
      await user.selectOptions(within(dialog).getByLabelText('Concessionária'), 'd-1');
      await user.selectOptions(within(dialog).getByLabelText('Grupo tarifário'), 'A');
      await user.selectOptions(within(dialog).getByLabelText('Tipo de ligação'), 'THREE_PHASE');
      await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.body).toMatchObject({
        number: '55667788',
        distributorId: 'd-1',
        customerGroup: 'A',
        phaseSystem: 'THREE_PHASE',
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: /^Contato$/ }));
      dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Nome'), 'João Financeiro');
      await user.click(within(dialog).getByRole('switch', { name: 'Contato principal' }));
      await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]!.body).toMatchObject({ name: 'João Financeiro', isPrimary: true });
    });

    it('exclui contato depois de confirmar; conta com oportunidade aberta explica o motivo', async () => {
      let deletedContact = false;
      server.use(
        ...detailHandlers(),
        http.delete(
          `${API}/contacts/ct-1`,
          () => ((deletedContact = true), HttpResponse.json({ id: 'ct-1' })),
        ),
        http.delete(`${API}/accounts/acc-1`, () =>
          error(409, 'CONFLICT', 'A conta tem oportunidades abertas: encerre-as antes de excluir'),
        ),
      );
      renderApp('/crm/contas/acc-1');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Excluir contato Maria Silva' }));
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }),
      );
      await waitFor(() => expect(deletedContact).toBe(true));

      await user.click(screen.getByRole('button', { name: 'Excluir conta' }));
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }),
      );
      expect(await screen.findByText(/encerre-as antes de excluir/)).toBeInTheDocument();
    });

    it('nova oportunidade a partir da conta', async () => {
      let body: Record<string, unknown> | undefined;
      const created = makeOpportunity({ id: 'opp-5', title: 'Nova' });
      server.use(
        ...detailHandlers(),
        http.post(`${API}/opportunities`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(created, { status: 201 });
        }),
        http.get(`${API}/opportunities/opp-5`, () => HttpResponse.json(created)),
        http.get(`${API}/pipeline`, () => HttpResponse.json([])),
        http.get(`${API}/energy-bills`, () => HttpResponse.json([])),
        http.get(`${API}/opportunities/opp-5/calculations`, () => HttpResponse.json([])),
      );
      const { router } = renderApp('/crm/contas/acc-1');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Nova oportunidade/ }));
      const dialog = await screen.findByRole('dialog');
      await user.selectOptions(await within(dialog).findByLabelText('Imóvel'), 'site-1');
      await user.selectOptions(within(dialog).getByLabelText('Unidade consumidora'), 'uc-1');
      await user.click(within(dialog).getByRole('button', { name: 'Criar oportunidade' }));
      await waitFor(() => expect(body).toBeDefined());
      expect(body).toMatchObject({
        accountId: 'acc-1',
        siteId: 'site-1',
        consumerUnitId: 'uc-1',
        projectType: 'ON_GRID',
      });
      await waitFor(() => expect(router.state.location.pathname).toBe('/crm/oportunidades/opp-5'));
      // Espera a página nova terminar de carregar: requisições soltas contaminariam o teste seguinte.
      await screen.findByRole('heading', { name: 'Nova', level: 2 });
    });
  });

  it('perfil sem escrita em contas não vê botões de criar, editar ou excluir', async () => {
    server.use(...detailHandlers());
    renderApp('/crm/contas/acc-1', {
      session: makeSession('SDR', { permissions: ['crm.account.read', 'crm.opportunity.read'] }),
    });
    await screen.findByRole('heading', { name: 'Maria Silva', level: 2 });
    // Espera a página terminar de carregar antes de afirmar o que NÃO aparece.
    await screen.findByRole('link', { name: 'Casa da Maria' });
    expect(screen.queryByRole('button', { name: /Imóvel/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir conta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nova oportunidade/ })).not.toBeInTheDocument();
  });
});
