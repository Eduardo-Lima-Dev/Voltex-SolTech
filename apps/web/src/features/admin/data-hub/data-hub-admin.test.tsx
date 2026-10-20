import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { DataSourceDto, SourceWatchDto, UpdateProposalDto } from '@voltex/shared';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const now = '2026-10-20T12:00:00.000Z';

const source = (overrides: Partial<DataSourceDto> = {}): DataSourceDto => ({
  key: 'nasa-power',
  label: 'NASA POWER',
  baseUrl: 'https://power.larc.nasa.gov/api',
  license: 'Sem restrições declaradas; citar o projeto.',
  attribution: 'Dados do projeto NASA POWER.',
  licenseStatus: 'PENDING_REVIEW',
  termsCheckedAt: null,
  termsCheckedBy: null,
  enabled: false,
  notes: null,
  lastCollection: null,
  ...overrides,
});

const watch = (overrides: Partial<SourceWatchDto> = {}): SourceWatchDto => ({
  id: 'w-1',
  label: 'Norma da distribuidora',
  url: 'https://exemplo.test/norma',
  kind: 'NORM',
  enabled: true,
  checkedAt: now,
  changedAt: null,
  lastError: null,
  createdAt: now,
  ...overrides,
});

const proposal = (overrides: Partial<UpdateProposalDto> = {}): UpdateProposalDto => ({
  id: 'p-1',
  type: 'WATCH_CHANGE',
  status: 'PENDING',
  title: 'A fonte "Norma da distribuidora" mudou',
  target: { watchId: 'w-1' },
  proposed: { url: 'https://exemplo.test/norma' },
  diff: {
    added: ['Art. 3 Novo'],
    removed: ['Art. 2 Antigo'],
    addedCount: 1,
    removedCount: 1,
    changed: true,
  },
  origin: { source: 'source-watch', url: 'https://exemplo.test/norma', collectedAt: now },
  decidedById: null,
  decidedAt: null,
  decisionReason: null,
  createdAt: now,
  ...overrides,
});

describe('Administração → Fontes de dados', () => {
  const base = (...overrides: Parameters<typeof server.use>) =>
    server.use(
      ...overrides,
      http.get(`${API}/data-hub/sources`, () =>
        HttpResponse.json([
          source(),
          source({
            key: 'aneel-tariffs',
            label: 'ANEEL: tarifas',
            licenseStatus: 'CLEARED',
            enabled: true,
            termsCheckedAt: now,
            termsCheckedBy: 'Equipe',
            lastCollection: { status: 'SUCCEEDED', startedAt: now, finishedAt: now, error: null },
          }),
        ]),
      ),
      http.get(`${API}/data-hub/watches`, () => HttpResponse.json([watch()])),
    );

  it('mostra licença, atribuição e se a fonte está ligada; fonte sem termos conferidos avisa', async () => {
    base();
    renderApp('/admin/fontes');
    const nasa = (await screen.findByText('NASA POWER')).closest('tr') as HTMLElement;
    expect(within(nasa).getByText('Termos não conferidos')).toBeInTheDocument();
    expect(within(nasa).getByText('Desligada')).toBeInTheDocument();
    expect(within(nasa).getByText(/Só usa o que já está guardado/)).toBeInTheDocument();
    const aneel = screen.getByText('ANEEL: tarifas').closest('tr') as HTMLElement;
    expect(within(aneel).getByText('Termos conferidos')).toBeInTheDocument();
    expect(within(aneel).getByText('Ligada')).toBeInTheDocument();
    expect(within(aneel).getByText(/Concluída em/)).toBeInTheDocument();
  });

  it('lista as páginas vigiadas e verifica uma agora', async () => {
    let checked = 0;
    base(
      http.post(`${API}/data-hub/watches/w-1/check`, () => {
        checked += 1;
        return HttpResponse.json({ status: 'UNCHANGED', watch: watch() });
      }),
    );
    renderApp('/admin/fontes');
    const row = (await screen.findByText('Norma da distribuidora')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Norma ou resolução')).toBeInTheDocument();
    await userEvent
      .setup()
      .click(within(row).getByRole('button', { name: /Verificar agora: Norma da distribuidora/ }));
    await waitFor(() => expect(checked).toBe(1));
    expect(await screen.findByText('Sem mudanças desde a última coleta.')).toBeInTheDocument();
  });

  it('cadastra uma fonte, faz a coleta-base e mostra erro de endereço repetido', async () => {
    let created = 0;
    let checks = 0;
    base(
      http.post(`${API}/data-hub/watches`, async () => {
        created += 1;
        return created === 1
          ? HttpResponse.json(
              { statusCode: 409, code: 'ERR', message: 'Duplicada' },
              { status: 409 },
            )
          : HttpResponse.json(watch({ id: 'w-2' }), { status: 201 });
      }),
      http.post(`${API}/data-hub/watches/w-2/check`, () => {
        checks += 1;
        return HttpResponse.json({ status: 'BASELINE', watch: watch({ id: 'w-2' }) });
      }),
    );
    renderApp('/admin/fontes');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Vigiar fonte/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome'), 'Resolução nova');
    await user.type(within(dialog).getByLabelText(/Endereço/), 'https://exemplo.test/res');
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar' }));
    expect(
      await within(dialog).findByText('Este endereço já está sendo vigiado.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(checks).toBe(1);
  });

  it('endereço interno é recusado pelo servidor e aparece no campo', async () => {
    base(
      http.post(`${API}/data-hub/watches`, () =>
        HttpResponse.json(
          { statusCode: 400, code: 'ERR', message: 'Endereço interno não é permitido' },
          { status: 400 },
        ),
      ),
    );
    renderApp('/admin/fontes');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Vigiar fonte/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome'), 'Interna');
    await user.type(within(dialog).getByLabelText(/Endereço/), 'http://localhost/x');
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar' }));
    expect(await within(dialog).findByText('Endereço interno não é permitido')).toBeInTheDocument();
  });

  it('remove com confirmação; quem só lê (engenharia) não vê as ações', async () => {
    let removed = 0;
    base(
      http.delete(`${API}/data-hub/watches/w-1`, () => {
        removed += 1;
        return HttpResponse.json({ id: 'w-1' });
      }),
    );
    renderApp('/admin/fontes');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remover Norma da distribuidora' }));
    await user.click(await screen.findByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(removed).toBe(1));
  });

  it('perfil sem permissão de ler regras não acessa a tela', async () => {
    base();
    renderApp('/admin/fontes', { session: makeSession('SALESPERSON') });
    expect(
      await screen.findByText(/não tem permissão|sem permissão|Acesso negado/i),
    ).toBeInTheDocument();
  });
});

describe('Administração → Atualizações', () => {
  it('mostra o que entrou e o que saiu e decide a proposta', async () => {
    const decided: unknown[] = [];
    server.use(
      http.get(`${API}/data-hub/updates`, () => HttpResponse.json([proposal()])),
      http.post(`${API}/data-hub/updates/p-1/decide`, async ({ request }) => {
        decided.push(await request.json());
        return HttpResponse.json(proposal({ status: 'APPROVED' }));
      }),
    );
    renderApp('/admin/atualizacoes');
    expect(await screen.findByText('A fonte "Norma da distribuidora" mudou')).toBeInTheDocument();
    expect(screen.getByText('Art. 3 Novo')).toBeInTheDocument();
    expect(screen.getByText('Art. 2 Antigo')).toBeInTheDocument();
    expect(screen.getByText(/Origem: source-watch/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Decidir' }));
    const dialog = await screen.findByRole('dialog');
    // Descartar exige o motivo.
    expect(within(dialog).getByRole('button', { name: 'Descartar' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(decided).toEqual([{ decision: 'APPROVE' }]));
  });

  it('descarta com motivo', async () => {
    const decided: unknown[] = [];
    server.use(
      http.get(`${API}/data-hub/updates`, () => HttpResponse.json([proposal()])),
      http.post(`${API}/data-hub/updates/p-1/decide`, async ({ request }) => {
        decided.push(await request.json());
        return HttpResponse.json(proposal({ status: 'DISCARDED' }));
      }),
    );
    renderApp('/admin/atualizacoes');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Decidir' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Aguardando a versão oficial');
    await user.click(within(dialog).getByRole('button', { name: 'Descartar' }));
    await waitFor(() =>
      expect(decided).toEqual([{ decision: 'DISCARD', reason: 'Aguardando a versão oficial' }]),
    );
  });

  it('proposta de tarifa mostra o valor novo e o atual; busca tarifas novas', async () => {
    let scans = 0;
    server.use(
      http.get(`${API}/data-hub/updates`, () =>
        HttpResponse.json([
          proposal({
            id: 'p-2',
            type: 'TARIFF',
            title: 'ENEL CE: tarifa residencial 90,000 ¢/kWh desde 2026-01-01',
            proposed: { energyCentsPerKwh: 90, validFrom: '2026-01-01T00:00:00.000Z' },
            diff: { previousEnergyCentsPerKwh: 80 },
            origin: {
              source: 'aneel-tariffs',
              collectedAt: now,
              license: 'ODbL',
            },
          }),
        ]),
      ),
      http.post(`${API}/data-hub/tariffs/scan`, () => {
        scans += 1;
        return HttpResponse.json({
          proposed: 1,
          alreadyProposed: 0,
          unchanged: 0,
          distributorsChecked: 1,
        });
      }),
    );
    renderApp('/admin/atualizacoes');
    expect(await screen.findByText(/^90 ¢\/kWh/, { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/Hoje: 80 ¢\/kWh/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Buscar tarifas novas/ }));
    await waitFor(() => expect(scans).toBe(1));
    expect(await screen.findByText('1 tarifa(s) nova(s) para revisar.')).toBeInTheDocument();
  });

  it('caixa vazia e filtro por situação', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${API}/data-hub/updates`, ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('status'));
        return HttpResponse.json([]);
      }),
    );
    renderApp('/admin/atualizacoes');
    expect(await screen.findByText('Nenhuma atualização por aqui.')).toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByLabelText('Filtrar por situação'), '');
    await waitFor(() => expect(seen).toContain(null));
    expect(seen[0]).toBe('PENDING');
  });
});
