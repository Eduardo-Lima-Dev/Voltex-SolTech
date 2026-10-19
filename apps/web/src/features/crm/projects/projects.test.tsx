import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, makeChecklistItem, makeProject, makeSession, page } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const summary = (p = makeProject()) => ({
  id: p.id,
  opportunityId: p.opportunityId,
  projectCode: p.projectCode,
  title: p.title,
  accountName: p.accountName,
  distributorName: p.distributorName,
  status: p.status,
  responsibleName: p.responsibleName,
  valueCents: p.valueCents,
  pendingRequired: p.pendingRequired,
  overdue: p.overdue,
  createdAt: p.createdAt,
});
const detail = (p = makeProject()) =>
  http.get(`${API}/projects/${p.id}`, () => HttpResponse.json(p));

describe('CRM · Projetos', () => {
  it('lista com situação, pendências e prazo vencido; filtra por situação', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${API}/projects`, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(
          page([
            summary(makeProject({ overdue: true, status: 'SUBMITTED', distributorName: 'CEEE-D' })),
          ]),
        );
      }),
    );
    renderApp('/crm/projetos', { session: makeSession('OPERATIONS') });
    expect(await screen.findByRole('link', { name: 'Casa da Maria' })).toHaveAttribute(
      'href',
      '/crm/projetos/proj-1',
    );
    expect(screen.getByText('Prazo vencido')).toBeInTheDocument();
    expect(screen.getByText('CEEE-D')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Vistoria' }));
    await waitFor(() => expect(urls.some((u) => u.includes('status=INSPECTION'))).toBe(true));
  });

  it('detalhe: mostra regra com fonte, aviso de não revisada, pendências e prazo sugerido com fonte', async () => {
    server.use(detail());
    renderApp('/crm/projetos/proj-1', { session: makeSession('OPERATIONS') });
    expect(await screen.findByRole('heading', { name: 'Casa da Maria' })).toBeInTheDocument();
    expect(screen.getByText('energif-2023@1')).toBeInTheDocument();
    expect(screen.getByText(/não foi revisada/)).toBeInTheDocument();
    expect(screen.getByText(/2 documento\(s\) obrigatório\(s\) pendente\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/EnergIF 2023, EF-R04 \(p. 121 e 123\), a/)).toBeInTheDocument();
    expect(screen.getByText(/sugestão de 60 dias/)).toHaveTextContent('EF-R06');
    expect(screen.getByText(/Confirme na regulação vigente/)).toBeInTheDocument();
  });

  it('conclui um item do checklist; dispensar pede observação', async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      detail(),
      http.patch(`${API}/projects/proj-1/checklist/item-1`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeProject());
      }),
    );
    renderApp('/crm/projetos/proj-1', { session: makeSession('OPERATIONS') });
    const user = userEvent.setup();
    const select = await screen.findByLabelText('Situação de Formulário de solicitação de acesso');
    await user.selectOptions(select, 'DONE');
    await waitFor(() => expect(bodies[0]).toEqual({ status: 'DONE' }));
    await user.selectOptions(select, 'WAIVED');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Observação'), 'Dispensado por e-mail');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(bodies[1]).toEqual({ status: 'WAIVED', note: 'Dispensado por e-mail' }),
    );
  });

  it('protocolar exige o número; mostra o erro do servidor quando faltam documentos', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      detail(),
      http.post(`${API}/projects/proj-1/status`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            statusCode: 422,
            code: 'CHECKLIST_INCOMPLETE',
            message: 'Faltam 2 documento(s) obrigatório(s) do checklist: Formulário; Memorial.',
          },
          { status: 422 },
        );
      }),
    );
    renderApp('/crm/projetos/proj-1', { session: makeSession('OPERATIONS') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Protocolar na distribuidora' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    expect(await within(dialog).findByText('Informe o número do protocolo')).toBeInTheDocument();
    expect(body).toBeUndefined();
    await user.type(within(dialog).getByLabelText('Número do protocolo'), 'PROTO-1');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    expect(await within(dialog).findByText(/Faltam 2 documento/)).toBeInTheDocument();
    expect(body).toEqual({ status: 'SUBMITTED', protocolNumber: 'PROTO-1' });
  });

  it('cancelar pede o motivo; homologado e cancelado não têm próximos passos', async () => {
    server.use(
      detail(
        makeProject({
          id: 'proj-2',
          status: 'APPROVED',
          checklist: [makeChecklistItem({ status: 'DONE' })],
          pendingRequired: 0,
        }),
      ),
    );
    renderApp('/crm/projetos/proj-2', { session: makeSession('OPERATIONS') });
    expect(await screen.findByText('Homologado', { selector: 'span' })).toBeInTheDocument();
    expect(
      screen.getByText(/Todos os documentos obrigatórios estão resolvidos/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Protocolar|Cancelar projeto|Marcar como homologado/ }),
    ).not.toBeInTheDocument();
  });

  it('quem só lê (instalador) vê o checklist sem controles de edição', async () => {
    server.use(detail());
    renderApp('/crm/projetos/proj-1', { session: makeSession('INSTALLER') });
    expect(await screen.findByText('Formulário de solicitação de acesso')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Situação de Formulário de solicitação de acesso'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Protocolar na distribuidora' }),
    ).not.toBeInTheDocument();
  });

  it('projeto inexistente mostra mensagem clara', async () => {
    server.use(
      http.get(`${API}/projects/nope`, () =>
        HttpResponse.json(
          { statusCode: 404, code: 'NOT_FOUND', message: 'Projeto não encontrado' },
          { status: 404 },
        ),
      ),
    );
    renderApp('/crm/projetos/nope', { session: makeSession('OPERATIONS') });
    expect(await screen.findByText('Projeto não encontrado.')).toBeInTheDocument();
  });
});
