import { expect, test } from '@playwright/test';
import {
  USERS,
  acceptProposal,
  api,
  apiToken,
  ensureMarginPolicy,
  fixture,
  loginAs,
  prepareOpportunity,
  sendProposal,
} from './helpers';

test.describe('Da triagem à proposta', () => {
  test('triagem verde → cotação com margem → proposta → cliente aceita pelo link público', async ({
    page,
    browser,
  }) => {
    const token = await apiToken(USERS.owner);
    await ensureMarginPolicy(token);
    const opp = await prepareOpportunity(token, 'Cliente Proposta');
    await loginAs(page, USERS.owner);

    // Triagem
    await page.goto(`/crm/oportunidades/${opp.id}`);
    await page.getByRole('tab', { name: 'Triagem' }).click();
    await page.getByRole('button', { name: 'Avaliar triagem' }).click();
    await expect(page.getByText('Triagem verde')).toBeVisible();

    // Cotação: com a triagem verde a etapa muda; preço baixo fica abaixo do mínimo.
    await page.getByLabel('Mudar de etapa').selectOption({ label: 'Cotação' });
    await page.getByRole('tab', { name: 'Cotação' }).click();
    await page.getByRole('button', { name: /Nova cotação/ }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Descrição do item 1').fill('Módulo 550 Wp');
    await dialog.getByLabel('Quantidade do item 1').fill('8');
    await dialog.getByLabel('Custo unitário do item 1 (R$)').fill('600,00');
    await dialog.getByLabel('Descrição do item 2').fill('Inversor 5 kW');
    await dialog.getByLabel('Custo unitário do item 2 (R$)').fill('2.500,00');
    await dialog.getByLabel('Instalação (R$)').fill('2.000,00');
    await dialog.getByLabel('Comissão (%)').fill('5');
    await dialog.getByLabel('Impostos (%)').fill('6');
    await dialog.getByLabel('Preço de venda (R$)').fill('9.000,00');
    // A prévia usa o mesmo motor do servidor: custos 7.300 + comissão e impostos sobre 9.000 → margem negativa.
    await expect(dialog.getByRole('region', { name: 'Prévia da margem' })).toContainText(
      'Margem de contribuição',
    );
    await dialog.getByRole('button', { name: 'Salvar cotação' }).click();
    await expect(page.getByText('Abaixo do mínimo')).toBeVisible();

    // Corrige o preço: dentro da política.
    // O "Editar" do cabeçalho é da oportunidade: o da cotação fica no cartão dela.
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Abaixo do mínimo' })
      .getByRole('button', { name: /Editar/ })
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Preço de venda (R$)').fill('19.800,00');
    await dialog.getByRole('button', { name: 'Salvar cotação' }).click();
    await expect(page.getByText('Dentro da política')).toBeVisible();

    // Proposta
    await page.getByRole('tab', { name: 'Proposta' }).click();
    await page.getByRole('button', { name: /Gerar proposta/ }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: /v1/ }).check();
    await dialog.getByLabel('Condições de pagamento (opcional)').fill('30% de entrada + 6x');
    await dialog.getByRole('button', { name: 'Gerar proposta' }).click();
    await expect(page.getByText('Proposta v1')).toBeVisible();
    await page.getByRole('button', { name: /^Enviar$/ }).click();
    const link = await page.getByLabel('Link público da proposta').inputValue();
    expect(link).toMatch(/\/p\/[\w-]{40,}$/);
    await page.keyboard.press('Escape');

    // O cliente abre sem login: vê o valor, nada de custo/margem, e aceita.
    const client = await browser.newContext({ baseURL: page.url().split('/crm')[0] });
    const clientPage = await client.newPage();
    await clientPage.goto(new URL(link).pathname);
    await expect(clientPage.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(clientPage.getByText('R$ 19.800,00').first()).toBeVisible();
    await expect(clientPage.locator('body')).not.toContainText(/margem|comiss/i);
    await clientPage.getByRole('button', { name: 'Aceitar proposta' }).click();
    await expect(clientPage.getByText('É necessário confirmar o aceite')).toBeVisible();
    await clientPage.getByLabel('Nome completo').fill('Maria da Silva');
    await clientPage.getByRole('checkbox').check();
    await clientPage.getByRole('button', { name: 'Aceitar proposta' }).click();
    await expect(clientPage.getByText(/Proposta aceita por/)).toBeVisible();
    await client.close();

    // De volta ao CRM: a oportunidade foi para Contrato e a linha do tempo registra o aceite.
    await page.reload();
    await page.getByRole('tab', { name: 'Linha do tempo' }).click();
    await expect(page.getByText(/aceita por Maria da Silva/).first()).toBeVisible();
  });

  test('margem abaixo do mínimo: o vendedor pede aprovação e o gestor aprova', async ({
    page,
    browser,
  }) => {
    const owner = await apiToken(USERS.owner);
    await ensureMarginPolicy(owner);
    const opp = await prepareOpportunity(owner, 'Cliente Aprovação');
    await api(`/opportunities/${opp.id}/guard/evaluate`, owner, { method: 'POST' });
    await api(`/opportunities/${opp.id}/stage`, owner, { body: { stage: 'QUOTING' } });
    const seller = await apiToken(USERS.seller);
    const quote = await api(`/opportunities/${opp.id}/quotes`, seller, {
      body: {
        items: [{ category: 'MODULE', description: 'Kit', quantity: 1, unitCostCents: 1000000 }],
        costs: { commissionRate: 0.05, taxRate: 0.06 },
        priceCents: 1200000,
      },
    });
    expect(quote.marginStatus).toBe('BELOW_POLICY');

    await loginAs(page, USERS.seller);
    await page.goto(`/crm/oportunidades/${opp.id}`);
    await page.getByRole('tab', { name: 'Cotação' }).click();
    await page.getByRole('button', { name: 'Pedir aprovação' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Justificativa')
      .fill('Cliente estratégico da região, fecha esta semana.');
    await page.getByRole('dialog').getByRole('button', { name: 'Enviar pedido' }).click();
    await expect(page.getByText('Aguardando aprovação').first()).toBeVisible();

    const ctx = await browser.newContext({ baseURL: page.url().split('/crm')[0] });
    const mgr = await ctx.newPage();
    await loginAs(mgr, USERS.manager);
    await mgr.goto('/crm/aprovacoes');
    await expect(mgr.getByText(opp.accountName).first()).toBeVisible();
    await mgr.getByRole('button', { name: 'Aprovar' }).first().click();
    await mgr
      .getByRole('dialog')
      .getByLabel('Motivo da decisão')
      .fill('Aprovado: volume compensa.');
    await mgr.getByRole('dialog').getByRole('button', { name: 'Aprovar' }).click();
    await expect(mgr.getByText('Nenhum pedido nesta situação.')).toBeVisible();
    await ctx.close();

    await page.reload();
    await page.getByRole('tab', { name: 'Cotação' }).click();
    await expect(page.getByText('Aprovada', { exact: true }).first()).toBeVisible();
  });
});

test.describe('Do contrato à homologação', () => {
  test('contrato → assinatura → ganho e projeto → checklist → protocolo', async ({ page }) => {
    const token = await apiToken(USERS.owner);
    await ensureMarginPolicy(token);
    const opp = await prepareOpportunity(token, 'Cliente Contrato');
    const { publicToken } = await sendProposal(token, opp.id);
    await acceptProposal(publicToken);

    await loginAs(page, USERS.owner);
    await page.goto(`/crm/oportunidades/${opp.id}`);
    await page.getByRole('tab', { name: 'Contrato' }).click();
    await page.getByRole('button', { name: /Gerar contrato/ }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('CPF/CNPJ do cliente').fill('123.456.789-09');
    await dialog
      .getByLabel('CNPJ da empresa (se não estiver em Empresa)')
      .fill('12.345.678/0001-90');
    await dialog.getByRole('button', { name: 'Gerar contrato' }).click();
    await expect(page.getByText('Contrato v1')).toBeVisible();
    await expect(page.getByText(/modelo-base/).first()).toBeVisible();

    await page.getByRole('button', { name: /Registrar assinatura/ }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Confirmar assinatura' }).click();
    await expect(dialog.getByText(/Anexe o contrato assinado/)).toBeVisible();
    await dialog.getByLabel('Contrato assinado').setInputFiles(fixture('contrato-assinado.pdf'));
    await dialog.getByLabel('Quem assinou pelo cliente (opcional)').fill('Maria da Silva');
    await dialog.getByRole('button', { name: 'Confirmar assinatura' }).click();
    await page.getByRole('link', { name: 'Abrir o projeto' }).click();

    // Projeto com o mesmo código do projeto e o checklist da base (com a fonte de cada item).
    await expect(page.getByRole('heading', { name: 'Checklist de documentos' })).toBeVisible();
    await expect(page.getByText(opp.projectCode).first()).toBeVisible();
    await expect(page.getByText(/EnergIF 2023, EF-R04/).first()).toBeVisible();
    await expect(page.getByText(/não foi revisada/)).toBeVisible();

    // Sem os documentos, o protocolo é recusado com a lista do que falta.
    await page.getByRole('button', { name: 'Protocolar na distribuidora' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Número do protocolo').fill('PROTO-E2E-1');
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await expect(dialog.getByText(/Faltam 6 documento/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Voltar' }).click();

    for (const title of [
      'Formulário de solicitação de acesso',
      'ART ou TRT do projeto de execução',
      'Diagrama unifilar',
      'Certificado do inversor',
      'Procuração',
      'Memorial descritivo',
    ]) {
      const select = page.getByLabel(`Situação de ${title}`);
      await select.selectOption('DONE');
      await expect(select).toHaveValue('DONE');
    }
    await expect(page.getByText(/Todos os documentos obrigatórios estão resolvidos/)).toBeVisible();

    await page.getByRole('button', { name: 'Protocolar na distribuidora' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Número do protocolo').fill('PROTO-E2E-1');
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByText('Solicitação protocolada').first()).toBeVisible();
    await expect(page.getByText('PROTO-E2E-1')).toBeVisible();
    await expect(page.getByText(/Sugerido: .*EF-R06/)).toBeVisible();

    // A oportunidade ficou Ganha.
    await page.goto(`/crm/oportunidades/${opp.id}`);
    await expect(page.getByText('Ganha').first()).toBeVisible();
  });

  test('o painel comercial reflete o negócio ganho', async ({ page }) => {
    await loginAs(page, USERS.manager);
    await page.goto('/crm/painel');
    await expect(page.getByText('Leads no período')).toBeVisible();
    await expect(page.getByText('Negócios ganhos')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Funil por etapa' })).toBeVisible();
  });
});
