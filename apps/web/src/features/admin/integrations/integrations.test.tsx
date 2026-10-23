import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type {
  IntegrationConnectionDto,
  IntegrationDeadLetterDto,
  IntegrationProviderDto,
} from '@voltex/shared';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const now = '2026-10-22T12:00:00.000Z';

const provider = (overrides: Partial<IntegrationProviderDto> = {}): IntegrationProviderDto => ({
  key: 'fake',
  kind: 'MONITORING',
  label: 'Monitor oficial',
  official: true,
  docsUrl: 'https://docs.exemplo.test',
  licenseStatus: 'CLEARED',
  notes: null,
  credentialFields: [
    { name: 'apiKey', label: 'Chave da API', secret: true, required: true, hint: null },
    { name: 'siteId', label: 'ID da usina', secret: false, required: true, hint: null },
  ],
  enabled: true,
  rateBudget: null,
  minIntervalMinutes: 60,
  ...overrides,
});

const connection = (
  overrides: Partial<IntegrationConnectionDto> = {},
): IntegrationConnectionDto => ({
  id: 'c-1',
  provider: 'fake',
  providerLabel: 'Monitor oficial',
  kind: 'MONITORING',
  label: 'Conta da empresa',
  status: 'DISABLED',
  official: true,
  health: 'UNKNOWN',
  consecutiveFailures: 0,
  lastSyncAt: null,
  lastError: null,
  termsAcceptedAt: null,
  termsAcceptedById: null,
  config: {},
  credentials: [],
  createdAt: now,
  ...overrides,
});

const letter = (overrides: Partial<IntegrationDeadLetterDto> = {}): IntegrationDeadLetterDto => ({
  id: 'l-1',
  connectionId: 'c-1',
  error: 'provedor fora do ar',
  attempts: 3,
  createdAt: now,
  resolvedAt: null,
  ...overrides,
});

const base = (
  connections: IntegrationConnectionDto[],
  providers: IntegrationProviderDto[] = [provider()],
  letters: IntegrationDeadLetterDto[] = [],
  ...extra: Parameters<typeof server.use>
) =>
  server.use(
    ...extra,
    http.get(`${API}/integrations/providers`, () => HttpResponse.json(providers)),
    http.get(`${API}/integrations/connections`, () => HttpResponse.json(connections)),
    http.get(`${API}/integrations/dead-letters`, () => HttpResponse.json(letters)),
    http.get(`${API}/integrations/runs`, () => HttpResponse.json([])),
  );

describe('Administração → Integrações', () => {
  it('lista provedores com a origem (oficial ou não) e se estão ligados no servidor', async () => {
    base(
      [],
      [
        provider(),
        provider({ key: 'nao', label: 'Monitor do app', official: false, enabled: false }),
      ],
    );
    renderApp('/admin/integracoes');
    const oficial = (await screen.findAllByText('Monitor oficial'))[0]!.closest(
      'tr',
    ) as HTMLElement;
    expect(within(oficial).getByText('Oficial')).toBeInTheDocument();
    expect(within(oficial).getByText('Ligado')).toBeInTheDocument();
    const naoOficial = screen.getByText('Monitor do app').closest('tr') as HTMLElement;
    expect(within(naoOficial).getByText('Não oficial')).toBeInTheDocument();
    expect(within(naoOficial).getByText('Desligado')).toBeInTheDocument();
    expect(await screen.findByText('Nenhuma conexão cadastrada ainda.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma falha pendente.')).toBeInTheDocument();
  });

  it('quem não tem permissão não vê a área', async () => {
    base([]);
    renderApp('/admin/integracoes', { session: makeSession('SALESPERSON') });
    expect(screen.queryByText('Provedores')).not.toBeInTheDocument();
  });

  it('cadastra uma conexão com os campos do provedor e mascara o segredo', async () => {
    let sent: unknown;
    base(
      [],
      [provider()],
      [],
      http.post(`${API}/integrations/connections`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(connection(), { status: 201 });
      }),
    );
    renderApp('/admin/integracoes');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Nova conexão/ }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Provedor'), 'fake');
    await user.type(within(dialog).getByLabelText('Nome da conexão'), 'Conta da empresa');
    const secret = within(dialog).getByLabelText('Chave da API');
    expect(secret).toHaveAttribute('type', 'password');
    expect(within(dialog).getByLabelText('ID da usina')).toHaveAttribute('type', 'text');
    const save = within(dialog).getByRole('button', { name: 'Salvar' });
    expect(save).toBeDisabled();
    await user.type(secret, 'chave-123');
    await user.type(within(dialog).getByLabelText('ID da usina'), 'S-1');
    await user.click(save);
    await waitFor(() =>
      expect(sent).toMatchObject({
        provider: 'fake',
        label: 'Conta da empresa',
        credentials: { apiKey: 'chave-123', siteId: 'S-1' },
      }),
    );
  });

  it('endpoint não oficial só liga depois do aceite dos termos', async () => {
    let body: unknown;
    base(
      [connection({ official: false, providerLabel: 'Monitor do app' })],
      [provider({ official: false })],
      [],
      http.post(`${API}/integrations/connections/c-1/activate`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(connection({ official: false, status: 'ACTIVE' }));
      }),
    );
    renderApp('/admin/integracoes');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ligar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/violar os termos de uso/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Aceitar e ligar' });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(confirm);
    await waitFor(() => expect(body).toEqual({ acceptTerms: true }));
  });

  it('conexão oficial liga direto, sem pedir aceite', async () => {
    let body: unknown;
    base(
      [connection()],
      [provider()],
      [],
      http.post(`${API}/integrations/connections/c-1/activate`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(connection({ status: 'ACTIVE' }));
      }),
    );
    renderApp('/admin/integracoes');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ligar' }));
    await waitFor(() => expect(body).toEqual({ acceptTerms: false }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('mostra a saúde, o erro e permite reprocessar uma falha pendente', async () => {
    let retried = 0;
    base(
      [connection({ status: 'PAUSED', health: 'RED', lastError: 'provedor fora do ar' })],
      [provider()],
      [letter()],
      http.post(`${API}/integrations/dead-letters/l-1/retry`, () => {
        retried += 1;
        return HttpResponse.json({ resolved: true });
      }),
    );
    renderApp('/admin/integracoes');
    // O nome aparece na conexão e na falha pendente: a linha da tabela é a primeira ocorrência.
    const row = (await screen.findAllByText('Conta da empresa'))[0]!.closest('tr') as HTMLElement;
    expect(within(row).getByText('Pausada')).toBeInTheDocument();
    expect(within(row).getByText('Com falha')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Falhas pendentes' });
    expect(within(list).getByText('3 tentativa(s)', { exact: false })).toBeInTheDocument();
    await userEvent.setup().click(within(list).getByRole('button', { name: 'Reprocessar' }));
    await waitFor(() => expect(retried).toBe(1));
  });
});
