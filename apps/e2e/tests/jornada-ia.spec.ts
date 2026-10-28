import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { loginAs, USERS } from './helpers';

async function snap(page: Page, info: TestInfo, nome: string, espera = 400) {
  await page.waitForTimeout(espera);
  await info.attach(nome, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}

/**
 * Jornada do assistente de IA pela tela, com o provedor de demonstração (sem rede e sem custo): a administração liga a
 * IA com o aceite dos termos, testa o modelo; depois o painel "Pergunte ao Voltex" responde com valores que mostram de
 * onde vieram, e o copiloto do financeiro abre o painel com a pergunta pronta.
 */
test.describe.serial('Jornada do assistente de IA', () => {
  test('a administração liga a IA com o aceite dos termos e testa', async ({ page }, info) => {
    await loginAs(page, USERS.owner);
    await page.goto('/admin/inteligencia');
    await expect(page.getByRole('heading', { name: 'Inteligência' })).toBeVisible();
    await expect(page.getByText('Empresa de demonstração')).toBeVisible();
    await snap(page, info, '1-ia-desligada');

    const ligar = page.getByRole('button', { name: 'Ligar a IA' });
    await expect(ligar).toBeDisabled();
    await page.getByRole('checkbox').check();
    await ligar.click();
    await expect(page.getByText('Ligado', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Testar a IA' }).click();
    await expect(page.getByText(/Funcionou em/)).toBeVisible();
    await snap(page, info, '2-ia-ligada-e-testada');
  });

  test('o painel responde com valores que mostram a origem e guarda o histórico', async ({
    page,
  }, info) => {
    await loginAs(page, USERS.owner);
    await page.getByRole('button', { name: 'Pergunte ao Voltex' }).click();
    const caixa = page.getByLabel('Sua pergunta');
    await expect(caixa).toBeEnabled();
    await snap(page, info, '3-painel-aberto');

    await caixa.fill('Quanto está vencido nas parcelas?');
    await page.getByRole('button', { name: 'Enviar pergunta' }).click();
    const resposta = page.getByTestId('assistant-message').last();
    await expect(resposta).toContainText('Consultei o sistema');
    await expect(page.getByText(/Gerado por IA a partir dos dados do sistema/)).toBeVisible();

    await resposta
      .getByRole('button', { name: /ver de onde veio/ })
      .first()
      .click();
    await expect(page.getByRole('note')).toContainText('Consulta:');
    await snap(page, info, '4-resposta-com-origem');

    await page.getByRole('button', { name: 'Resposta útil' }).click();
    await expect(page.getByText('Obrigado pela avaliação').first()).toBeVisible();

    await page.getByRole('button', { name: /Histórico/ }).click();
    await expect(page.getByText('Quanto está vencido nas parcelas?').first()).toBeVisible();
    await snap(page, info, '5-historico');
  });

  test('uma pergunta fora do assunto recebe a recusa padrão do sistema', async ({ page }) => {
    await loginAs(page, USERS.owner);
    await page.getByRole('button', { name: 'Pergunte ao Voltex' }).click();
    await page.getByLabel('Sua pergunta').fill('Escreva um poema sobre o sol');
    await page.getByRole('button', { name: 'Enviar pergunta' }).click();
    await expect(page.getByTestId('assistant-message').last()).toContainText(
      /não posso|posso responder/i,
    );
  });

  test('o copiloto do financeiro abre o painel com a pergunta pronta', async ({ page }, info) => {
    await loginAs(page, USERS.owner);
    await page.goto('/operations/financeiro');
    await page.getByRole('button', { name: 'Resumir com IA' }).click();
    await expect(page.getByRole('log', { name: 'Conversa' })).toContainText('Resuma o financeiro');
    await expect(page.getByTestId('assistant-message').last()).toBeVisible();
    await snap(page, info, '6-copiloto-financeiro');
  });

  test('insights, previsões e prazo das conversas aparecem nas telas', async ({ page }, info) => {
    await loginAs(page, USERS.owner);
    await page.goto('/admin/inteligencia');
    await page.getByRole('button', { name: 'Rodar a rotina agora' }).click();
    await expect(page.getByText(/Rotina concluída/).first()).toBeVisible();

    // Sem histórico suficiente, a previsão diz "dados insuficientes" em vez de inventar número.
    await page.goto('/operations/financeiro');
    await expect(page.getByText('Quanto deve entrar nos próximos 90 dias')).toBeVisible();
    await expect(page.getByText(/Dados insuficientes: há \d+ no histórico/)).toBeVisible();
    await snap(page, info, '7-previsao-dados-insuficientes');

    await page.goto('/admin/privacidade');
    await expect(page.getByLabel('Conversas com o assistente de IA (meses)')).toBeVisible();
  });
});
