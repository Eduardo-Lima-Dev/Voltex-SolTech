import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  acceptProposal,
  api,
  apiToken,
  ensureMarginPolicy,
  fixture,
  loginAs,
  prepareOpportunity,
  sendProposal,
  USERS,
} from './helpers';

async function snap(page: Page, info: TestInfo, nome: string, espera = 400) {
  await page.waitForTimeout(espera);
  await info.attach(nome, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}

/**
 * Jornada da execução pela tela: a venda é preparada pela API (contrato assinado → projeto); o que a Fase 11 entrega
 * aparece nos passos: liberar o portal e gerar o link na ficha do cliente, abrir o portal como cliente e lançar e
 * baixar uma parcela no financeiro do projeto.
 */
test.describe.serial('Jornada de execução', () => {
  let projectId = '';
  let accountId = '';
  let linkPath = '';

  test.beforeAll(async () => {
    const owner = await apiToken(USERS.owner);
    await ensureMarginPolicy(owner);
    const opp = await prepareOpportunity(owner, 'Execução');
    const { publicToken } = await sendProposal(owner, opp.id);
    await acceptProposal(publicToken);
    const contract = await api(`/opportunities/${opp.id}/contracts`, owner, { body: {} });
    const form = new FormData();
    form.append(
      'file',
      new Blob([readFileSync(fixture('fatura.pdf'))], { type: 'application/pdf' }),
      'assinado.pdf',
    );
    const signed = await api(`/contracts/${contract.id}/sign`, owner, { form });
    projectId = signed.projectId;
    const full = await api(`/opportunities/${opp.id}`, owner);
    accountId = full.accountId;
    await api(`/accounts/${accountId}/contacts`, owner, {
      body: { name: 'Maria da Silva', email: 'maria.execucao@example.com', isPrimary: true },
    });
  });

  test('libera o portal e gera o link na ficha do cliente', async ({ page }, info) => {
    await loginAs(page, USERS.owner);
    await page.goto(`/crm/contas/${accountId}`);
    await expect(page.getByText('Portal do cliente')).toBeVisible();
    await page.getByLabel('Liberar acesso para o e-mail').fill('maria.execucao@example.com');
    await page.getByRole('button', { name: 'Liberar', exact: true }).click();
    await expect(page.getByLabel('Acessos ao portal')).toContainText('maria.execucao@example.com');
    await page.getByRole('button', { name: 'Gerar link' }).click();
    const url = page.locator('p.font-mono', { hasText: '/portal/acesso/' });
    await expect(url).toBeVisible();
    linkPath = new URL((await url.innerText()).trim()).pathname;
    await snap(page, info, 'Link do portal gerado');
  });

  test('o cliente abre o link, vê o projeto e o link não vale uma segunda vez', async ({
    page,
    browser,
  }, info) => {
    await page.goto(linkPath);
    await expect(page.getByRole('heading', { name: 'Meus projetos' })).toBeVisible();
    await snap(page, info, 'Portal do cliente');
    const other = await browser.newContext();
    const second = await other.newPage();
    await second.goto(linkPath);
    await expect(second.getByRole('alert')).toContainText(/expirou|já foi usado|não é válido/);
    await other.close();
  });

  test('lança uma parcela no financeiro do projeto', async ({ page }, info) => {
    await loginAs(page, USERS.owner);
    await page.goto(`/crm/projetos/${projectId}`);
    await expect(page.getByText('Financeiro').first()).toBeVisible();
    await page.getByRole('button', { name: 'Nova parcela' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Referência (nota, pedido ou contrato)').fill('CT-0001');
    await dialog.getByLabel('Parcela nº').fill('1');
    await dialog.getByLabel('Vencimento').fill('2030-01-15');
    await dialog.getByLabel('Valor (R$)').fill('5000');
    await dialog.getByRole('button', { name: 'Lançar parcela' }).click();
    await expect(page.getByText('Parcela lançada.')).toBeVisible();
    await snap(page, info, 'Parcela lançada');
  });
});
