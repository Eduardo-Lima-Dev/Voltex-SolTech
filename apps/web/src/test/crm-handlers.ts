import { http, HttpResponse } from 'msw';
import type { OpportunityDto } from '@voltex/shared';
import { API, makeAccount, makeBill, makeBoard, makeOpportunity, page, stages } from './fixtures';

/** Respostas básicas das telas do CRM, para testes que só passam por elas (ex.: navegação depois de uma ação). */
export const pipelineHandler = () => http.get(`${API}/pipeline`, () => HttpResponse.json(stages()));

export const boardHandler = (items: OpportunityDto[] = []) =>
  http.get(`${API}/opportunities/board`, () => HttpResponse.json(makeBoard(items)));

/** Tudo o que a página da oportunidade (aba Resumo) consulta ao abrir. */
export const opportunityPageHandlers = (opportunity: OpportunityDto = makeOpportunity()) => [
  http.get(`${API}/opportunities/${opportunity.id}`, () => HttpResponse.json(opportunity)),
  pipelineHandler(),
  http.get(`${API}/accounts/${opportunity.accountId}`, () =>
    HttpResponse.json(makeAccount({ id: opportunity.accountId })),
  ),
  http.get(`${API}/energy-bills`, () => HttpResponse.json([])),
  http.get(`${API}/opportunities/${opportunity.id}/calculations`, () => HttpResponse.json([])),
];

export const emptyPage = () => HttpResponse.json(page([]));
export { makeBill };
