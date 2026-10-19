import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CustomStageDto } from '@voltex/shared';
import { pipelineHandler, sellersHandler } from '@/test/crm-handlers';
import { API, makeBoard, makeOpportunity, stages } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const custom: CustomStageDto = {
  id: 'custom-1',
  name: 'Visita agendada',
  baseStage: 'QUALIFICATION',
  position: 1,
};

const boardWithCustom = (inCustom = false) => {
  const opp = makeOpportunity({
    id: 'opp-1',
    title: 'Casa da Maria',
    stage: 'QUALIFICATION',
    customStageId: inCustom ? custom.id : null,
    customStageName: inCustom ? custom.name : null,
  });
  const board = makeBoard([opp]);
  const at = board.columns.findIndex((c) => c.stage.key === 'QUALIFICATION');
  const base = board.columns[at]!;
  board.columns.splice(
    at,
    1,
    inCustom ? { ...base, total: 0, totalValueCents: 0, items: [] } : base,
    {
      stage: base.stage,
      customStage: custom,
      total: inCustom ? 1 : 0,
      totalValueCents: 0,
      items: inCustom ? [opp] : [],
    },
  );
  return board;
};

beforeEach(() => server.use(sellersHandler()));

describe('CRM · Funil personalizado', () => {
  it('a coluna da empresa aparece depois da etapa e o cartão pode ir para ela', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      pipelineHandler(),
      http.get(`${API}/pipeline/custom-stages`, () => HttpResponse.json([custom])),
      http.get(`${API}/opportunities/board`, () => HttpResponse.json(boardWithCustom())),
      http.post(`${API}/opportunities/opp-1/stage`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity({ customStageId: custom.id }));
      }),
    );
    renderApp('/crm/oportunidades');
    const column = await screen.findByRole('region', { name: 'Etapa Visita agendada' });
    expect(within(column).getByText('Etapa: Qualificação')).toBeInTheDocument();

    const select = await screen.findByLabelText('Mover Casa da Maria para');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toContain('Visita agendada (Qualificação)');
    await userEvent.setup().selectOptions(select, 'custom:custom-1');
    await waitFor(() =>
      expect(body).toEqual({ stage: 'QUALIFICATION', customStageId: 'custom-1' }),
    );
  });

  it('de dentro da coluna da empresa dá para voltar à coluna padrão da mesma etapa', async () => {
    server.use(
      pipelineHandler(),
      http.get(`${API}/pipeline/custom-stages`, () => HttpResponse.json([custom])),
      http.get(`${API}/opportunities/board`, () => HttpResponse.json(boardWithCustom(true))),
    );
    renderApp('/crm/oportunidades');
    const select = await screen.findByLabelText('Mover Casa da Maria para');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options[1]).toBe('Qualificação');
  });

  it('o administrador esconde etapa, renomeia e cria coluna nova', async () => {
    const patches: Record<string, unknown>[] = [];
    let created: Record<string, unknown> | undefined;
    server.use(
      pipelineHandler(),
      http.get(`${API}/pipeline/custom-stages`, () => HttpResponse.json([])),
      http.get(`${API}/opportunities/board`, () => HttpResponse.json(makeBoard())),
      http.patch(`${API}/pipeline/stages/:id`, async ({ request, params }) => {
        patches.push({ id: params.id, ...((await request.json()) as object) });
        return HttpResponse.json(stages()[0]);
      }),
      http.post(`${API}/pipeline/custom-stages`, async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...custom, name: 'Vistoria' }, { status: 201 });
      }),
    );
    renderApp('/crm/oportunidades');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Configurar etapas/ }));
    const dialog = await screen.findByRole('dialog');

    await user.click(
      await within(dialog).findByRole('switch', { name: 'Mostrar Pré-dimensionamento no quadro' }),
    );
    const quoting = within(dialog).getByLabelText('Nome da etapa 8');
    await user.clear(quoting);
    await user.type(quoting, 'Orçamento');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches).toContainEqual({
      id: 'stage-PRE_SIZING',
      name: 'Pré-dimensionamento',
      hidden: true,
    });
    expect(patches).toContainEqual({ id: 'stage-QUOTING', name: 'Orçamento', hidden: false });

    await user.click(await screen.findByRole('button', { name: /Configurar etapas/ }));
    const again = await screen.findByRole('dialog');
    await user.type(within(again).getByLabelText('Nome da nova coluna'), 'Vistoria');
    await user.selectOptions(within(again).getByLabelText('Etapa da nova coluna'), 'QUOTING');
    await user.click(within(again).getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(created).toEqual({ name: 'Vistoria', baseStage: 'QUOTING' }));
  });

  it('o vendedor não vê "Configurar etapas"', async () => {
    server.use(
      pipelineHandler(),
      http.get(`${API}/pipeline/custom-stages`, () => HttpResponse.json([])),
      http.get(`${API}/opportunities/board`, () => HttpResponse.json(makeBoard())),
    );
    const { makeSession } = await import('@/test/fixtures');
    renderApp('/crm/oportunidades', { session: makeSession('SALESPERSON') });
    await screen.findByRole('button', { name: /Nova oportunidade/ });
    expect(screen.queryByRole('button', { name: /Configurar etapas/ })).not.toBeInTheDocument();
  });
});
