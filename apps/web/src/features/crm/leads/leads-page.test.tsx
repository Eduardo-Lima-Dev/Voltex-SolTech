import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { LeadDto } from '@voltex/shared';
import { opportunityPageHandlers } from '@/test/crm-handlers';
import { API, makeLead, makeOpportunity, makeSession, page } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const leadsHandler = (leads: LeadDto[], onRequest?: (params: URLSearchParams) => void) =>
  http.get(`${API}/leads`, ({ request }) => {
    onRequest?.(new URL(request.url).searchParams);
    return HttpResponse.json(page(leads, leads.length));
  });
const captureHandler = () =>
  http.get(`${API}/lead-capture`, () => HttpResponse.json({ key: 'lk_chave_de_teste' }));
const fileOf = (content: string) => new File([content], 'leads.csv', { type: 'text/csv' });
const error = (status: number, code: string, message: string, data?: Record<string, unknown>) =>
  HttpResponse.json({ statusCode: status, code, message, ...(data ? { data } : {}) }, { status });

const people = [
  makeLead(),
  makeLead({
    id: 'lead-2',
    name: 'Pedro Atrasado',
    status: 'NEW',
    slaBreached: true,
    phone: null,
    email: 'pedro@x.com',
    source: 'LANDING_PAGE',
    segment: 'COMMERCIAL',
    ownerName: null,
  }),
  makeLead({
    id: 'lead-3',
    name: 'Ana Desqualificada',
    status: 'DISQUALIFIED',
    disqualifiedReason: 'Fora da área de atendimento',
  }),
  makeLead({
    id: 'lead-4',
    name: 'Carlos Convertido',
    status: 'CONVERTED',
    convertedOpportunityId: 'opp-9',
  }),
];

describe('CRM · Leads', () => {
  it('lista com origem, situação, responsável e o primeiro contato (SLA)', async () => {
    server.use(leadsHandler(people), captureHandler());
    renderApp('/crm/leads');
    const row = await screen.findByRole('row', { name: /Maria Silva/ });
    expect(within(row).getByText('Novo')).toBeInTheDocument();
    expect(within(row).getByText('Cadastro manual')).toBeInTheDocument();
    expect(within(row).getByText(/Residencial/)).toBeInTheDocument();
    expect(within(row).getByText('Eduardo Silva')).toBeInTheDocument();
    expect(within(row).getByText(/Contato/)).toBeInTheDocument();

    const late = screen.getByRole('row', { name: /Pedro Atrasado/ });
    expect(within(late).getByText('SLA estourado')).toBeInTheDocument();
    expect(within(late).getByText('Landing page')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Ana Desqualificada/ })).getByText(
        'Fora da área de atendimento',
      ),
    ).toBeInTheDocument();
  });

  it('busca com atraso e filtros viram parâmetros; volta para a página 1', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      leadsHandler(people, (p) => queries.push(p)),
      captureHandler(),
    );
    renderApp('/crm/leads');
    await screen.findByText('Maria Silva');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Buscar leads'), 'maria');
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('maria'));
    expect(queries.filter((q) => q.get('search')).length).toBe(1);
    await user.selectOptions(screen.getByLabelText('Filtrar por situação'), 'QUALIFIED');
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('QUALIFIED'));
    await user.selectOptions(screen.getByLabelText('Filtrar por origem'), 'REFERRAL');
    await waitFor(() => expect(queries.at(-1)?.get('source')).toBe('REFERRAL'));
    await user.selectOptions(screen.getByLabelText('Filtrar por segmento'), 'RURAL');
    await waitFor(() => expect(queries.at(-1)?.get('segment')).toBe('RURAL'));
    await user.selectOptions(screen.getByLabelText('Filtrar por prazo de contato'), 'breached');
    await waitFor(() => expect(queries.at(-1)?.get('slaBreached')).toBe('true'));
    expect(queries.at(-1)?.get('page')).toBe('1');
  });

  it('estados vazio e erro', async () => {
    server.use(leadsHandler([]), captureHandler());
    const { unmount } = renderApp('/crm/leads');
    expect(await screen.findByText(/Nenhum lead ainda/)).toBeInTheDocument();
    unmount();
    server.use(
      http.get(`${API}/leads`, () => error(500, 'INTERNAL', 'x')),
      captureHandler(),
    );
    renderApp('/crm/leads');
    expect(await screen.findByText('Não foi possível carregar os leads.')).toBeInTheDocument();
  });

  describe('cadastro', () => {
    it('cria um lead enviando só o que foi preenchido', async () => {
      let body: Record<string, unknown> | undefined;
      server.use(
        leadsHandler([]),
        captureHandler(),
        http.post(`${API}/leads`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeLead(), { status: 201 });
        }),
      );
      renderApp('/crm/leads');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Novo lead/ }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Nome'), 'Maria Silva');
      await user.type(within(dialog).getByLabelText('Telefone'), '(85) 98888-7777');
      await user.selectOptions(within(dialog).getByLabelText('Segmento'), 'RESIDENTIAL');
      await user.selectOptions(within(dialog).getByLabelText('Origem'), 'REFERRAL');
      await user.click(within(dialog).getByRole('button', { name: 'Cadastrar lead' }));
      await waitFor(() => expect(body).toBeDefined());
      expect(body).toEqual({
        name: 'Maria Silva',
        phone: '(85) 98888-7777',
        segment: 'RESIDENTIAL',
        source: 'REFERRAL',
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('valida no navegador com as mesmas mensagens da API e não envia', async () => {
      let calls = 0;
      server.use(
        leadsHandler([]),
        captureHandler(),
        http.post(
          `${API}/leads`,
          () => ((calls += 1), HttpResponse.json(makeLead(), { status: 201 })),
        ),
      );
      renderApp('/crm/leads');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Novo lead/ }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Nome'), 'A');
      await user.type(within(dialog).getByLabelText('E-mail'), 'x');
      await user.click(within(dialog).getByRole('button', { name: 'Cadastrar lead' }));
      expect(await within(dialog).findAllByRole('alert')).not.toHaveLength(0);
      expect(within(dialog).getByLabelText('Nome')).toBeInvalid();
      expect(calls).toBe(0);
    });

    it('lead duplicado mostra o aviso e abre o lead existente para edição', async () => {
      server.use(
        leadsHandler([]),
        captureHandler(),
        http.post(`${API}/leads`, () =>
          error(409, 'DUPLICATE_LEAD', 'Já existe um lead com o mesmo telefone (Pedro Atrasado)', {
            matchedLeadId: 'lead-2',
            matchedBy: ['telefone'],
          }),
        ),
        http.get(`${API}/leads/lead-2`, () => HttpResponse.json(people[1])),
      );
      renderApp('/crm/leads');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Novo lead/ }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Nome'), 'Outro Nome');
      await user.type(within(dialog).getByLabelText('Telefone'), '85988887777');
      await user.click(within(dialog).getByRole('button', { name: 'Cadastrar lead' }));
      expect(
        await within(dialog).findByText(/Já existe um lead com o mesmo telefone/),
      ).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Abrir o lead existente' }));
      expect(await screen.findByRole('heading', { name: 'Editar lead' })).toBeInTheDocument();
      expect(screen.getByLabelText('Nome')).toHaveValue('Pedro Atrasado');
    });

    it('edita um lead existente (sem o campo de origem)', async () => {
      let body: Record<string, unknown> | undefined;
      server.use(
        leadsHandler([people[0]!]),
        captureHandler(),
        http.patch(`${API}/leads/lead-1`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeLead());
        }),
      );
      renderApp('/crm/leads');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Ações de Maria Silva' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Editar' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByLabelText('Origem')).not.toBeInTheDocument();
      await user.clear(within(dialog).getByLabelText('Nome'));
      await user.type(within(dialog).getByLabelText('Nome'), 'Maria S. Silva');
      await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(body).toBeDefined());
      expect(body).toMatchObject({ name: 'Maria S. Silva', phone: '(85) 98888-7777' });
      expect(body).not.toHaveProperty('source');
    });
  });

  describe('ações de status', () => {
    it('marca como contatado e qualifica pelo menu', async () => {
      const statuses: unknown[] = [];
      server.use(
        leadsHandler([people[0]!]),
        captureHandler(),
        http.patch(`${API}/leads/lead-1`, async ({ request }) => {
          statuses.push(((await request.json()) as { status: string }).status);
          return HttpResponse.json(makeLead());
        }),
      );
      renderApp('/crm/leads');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Ações de Maria Silva' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Marcar como contatado' }));
      await waitFor(() => expect(statuses).toEqual(['CONTACTED']));
      await user.click(screen.getByRole('button', { name: 'Ações de Maria Silva' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Qualificar' }));
      await waitFor(() => expect(statuses).toEqual(['CONTACTED', 'QUALIFIED']));
    });

    it('desqualificar exige o motivo (mínimo de 3 caracteres)', async () => {
      let body: Record<string, unknown> | undefined;
      server.use(
        leadsHandler([people[0]!]),
        captureHandler(),
        http.patch(`${API}/leads/lead-1`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeLead({ status: 'DISQUALIFIED' }));
        }),
      );
      renderApp('/crm/leads');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Ações de Maria Silva' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Desqualificar' }));
      const dialog = await screen.findByRole('dialog');
      const confirm = within(dialog).getByRole('button', { name: 'Desqualificar' });
      expect(confirm).toBeDisabled();
      await user.type(within(dialog).getByLabelText('Motivo'), 'ab');
      expect(confirm).toBeDisabled();
      await user.type(within(dialog).getByLabelText('Motivo'), 'c');
      await user.click(confirm);
      await waitFor(() =>
        expect(body).toEqual({ status: 'DISQUALIFIED', disqualifiedReason: 'abc' }),
      );
    });

    it('reabre um lead desqualificado e exclui depois de confirmar; convertido não oferece edição nem conversão', async () => {
      const calls: string[] = [];
      server.use(
        leadsHandler([people[2]!, people[3]!]),
        captureHandler(),
        http.patch(`${API}/leads/lead-3`, async ({ request }) => {
          calls.push(`patch:${((await request.json()) as { status: string }).status}`);
          return HttpResponse.json(makeLead());
        }),
        http.delete(
          `${API}/leads/lead-3`,
          () => (calls.push('delete'), HttpResponse.json({ id: 'lead-3' })),
        ),
      );
      renderApp('/crm/leads');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Ações de Ana Desqualificada' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Reabrir' }));
      await waitFor(() => expect(calls).toEqual(['patch:NEW']));
      await user.click(screen.getByRole('button', { name: 'Ações de Ana Desqualificada' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Excluir' }),
      );
      await waitFor(() => expect(calls).toEqual(['patch:NEW', 'delete']));

      expect(
        screen.queryByRole('button', { name: 'Converter Carlos Convertido' }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Ações de Carlos Convertido' }));
      expect(screen.queryByRole('menuitem', { name: 'Editar' })).not.toBeInTheDocument();
    });
  });

  describe('conversão', () => {
    it('cria conta e oportunidade e abre a oportunidade', async () => {
      let body: Record<string, unknown> | undefined;
      const opportunity = makeOpportunity({ id: 'opp-9', title: 'Sistema solar — Maria Silva' });
      server.use(
        leadsHandler([people[0]!]),
        captureHandler(),
        http.post(`${API}/leads/lead-1/convert`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            { lead: makeLead({ status: 'CONVERTED' }), accountId: 'acc-1', opportunityId: 'opp-9' },
            { status: 201 },
          );
        }),
        ...opportunityPageHandlers(opportunity),
        http.get(`${API}/tasks`, () => HttpResponse.json(page([]))),
      );
      const { router } = renderApp('/crm/leads');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Converter Maria Silva' }));
      const dialog = await screen.findByRole('dialog');
      await user.selectOptions(within(dialog).getByLabelText('Tipo de sistema'), 'HYBRID');
      await user.selectOptions(within(dialog).getByLabelText('Tipo de cliente'), 'COMPANY');
      await user.click(within(dialog).getByRole('button', { name: 'Converter' }));
      await waitFor(() => expect(body).toBeDefined());
      expect(body).toMatchObject({
        accountType: 'COMPANY',
        createOpportunity: true,
        projectType: 'HYBRID',
      });
      await waitFor(() => expect(router.state.location.pathname).toBe('/crm/oportunidades/opp-9'));
      expect(
        await screen.findByRole('heading', { name: 'Sistema solar — Maria Silva' }),
      ).toBeInTheDocument();
    });

    it('sem permissão para oportunidades (SDR), converte só em conta', async () => {
      let body: Record<string, unknown> | undefined;
      server.use(
        leadsHandler([people[0]!]),
        http.post(`${API}/leads/lead-1/convert`, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            { lead: makeLead({ status: 'CONVERTED' }), accountId: 'acc-1', opportunityId: null },
            { status: 201 },
          );
        }),
        http.get(`${API}/accounts/acc-1`, () =>
          HttpResponse.json({
            id: 'acc-1',
            tenantId: 't',
            type: 'PERSON',
            name: 'Maria Silva',
            document: null,
            segment: null,
            email: null,
            phone: null,
            notes: null,
            createdAt: '',
            updatedAt: '',
            contacts: [],
            sites: [],
            consumerUnits: [],
          }),
        ),
        http.get(`${API}/opportunities`, () => HttpResponse.json(page([]))),
      );
      const { router } = renderApp('/crm/leads', { session: makeSession('SDR') });
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Converter Maria Silva' }));
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).queryByLabelText('Abrir uma oportunidade agora'),
      ).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Converter' }));
      await waitFor(() => expect(body).toBeDefined());
      expect(body).toMatchObject({ createOpportunity: false });
      await waitFor(() => expect(router.state.location.pathname).toBe('/crm/contas/acc-1'));
    });
  });

  describe('importação de CSV', () => {
    it('lê o arquivo, mostra o que vai importar e depois o resultado com os duplicados', async () => {
      let body: { rows: unknown[] } | undefined;
      server.use(
        leadsHandler([]),
        captureHandler(),
        http.post(`${API}/leads/import`, async ({ request }) => {
          body = (await request.json()) as { rows: unknown[] };
          return HttpResponse.json({
            created: 1,
            duplicates: 1,
            duplicateRows: [
              { row: 2, name: 'Repetido', matchedLeadId: 'lead-1', matchedBy: ['telefone'] },
            ],
          });
        }),
      );
      renderApp('/crm/leads');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Importar CSV/ }));
      const dialog = await screen.findByRole('dialog');
      await user.upload(
        within(dialog).getByLabelText('Arquivo CSV'),
        fileOf('nome;telefone\nNovo Lead;(85) 98888-1111\nRepetido;(85) 98888-7777'),
      );
      expect(await within(dialog).findByText(/2 lead\(s\) válido\(s\)/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Importar 2' }));
      await waitFor(() => expect(body?.rows).toHaveLength(2));
      expect(await within(dialog).findByText('Importação concluída')).toBeInTheDocument();
      expect(
        within(dialog).getByText(/Linha 2 \(Repetido\): já existe com o mesmo telefone/),
      ).toBeInTheDocument();
      expect(within(dialog).getAllByRole('button', { name: 'Fechar' }).length).toBeGreaterThan(0);
    });

    it('arquivo com problemas lista as linhas e bloqueia o envio', async () => {
      server.use(leadsHandler([]), captureHandler());
      renderApp('/crm/leads');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Importar CSV/ }));
      const dialog = await screen.findByRole('dialog');
      await user.upload(
        within(dialog).getByLabelText('Arquivo CSV'),
        fileOf('nome;email\nOk Um;ok@ok.com\nX;\nOk Dois;ruim'),
      );
      expect(
        await within(dialog).findByText('Corrija o arquivo e envie de novo'),
      ).toBeInTheDocument();
      expect(within(dialog).getByText(/Linha 3 \(X\): nome/)).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: /^Importar/ })).toBeDisabled();
    });
  });

  describe('captação pública', () => {
    it('quem gerencia a empresa vê o endereço, copia e troca a chave com confirmação', async () => {
      let rotated = false;
      server.use(
        leadsHandler([]),
        captureHandler(),
        http.post(
          `${API}/lead-capture/rotate`,
          () => ((rotated = true), HttpResponse.json({ key: 'lk_nova' })),
        ),
      );
      renderApp('/crm/leads');
      const address = await screen.findByLabelText('Endereço de captação');
      expect((address as HTMLInputElement).value).toMatch(
        /\/api\/v1\/public\/leads\/lk_chave_de_teste$/,
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Trocar chave/ }));
      const confirm = await screen.findByRole('alertdialog');
      expect(within(confirm).getByText(/deixa de funcionar imediatamente/)).toBeInTheDocument();
      await user.click(within(confirm).getByRole('button', { name: 'Trocar chave' }));
      await waitFor(() => expect(rotated).toBe(true));
    });

    it('SDR não vê a captação; perfil só de leitura não vê os botões de escrita', async () => {
      server.use(leadsHandler(people));
      renderApp('/crm/leads', { session: makeSession('SDR') });
      await screen.findByText('Maria Silva');
      expect(screen.queryByText('Formulário de captação')).not.toBeInTheDocument();
    });

    it('com só a permissão de leitura não há ações de escrita', async () => {
      server.use(leadsHandler(people));
      renderApp('/crm/leads', { session: makeSession('SDR', { permissions: ['crm.lead.read'] }) });
      await screen.findByText('Maria Silva');
      expect(screen.queryByRole('button', { name: /Novo lead/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Importar CSV/ })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Ações de Maria Silva' }),
      ).not.toBeInTheDocument();
    });
  });
});
