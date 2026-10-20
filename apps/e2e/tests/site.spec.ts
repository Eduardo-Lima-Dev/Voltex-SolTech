import { expect, test } from '@playwright/test';
import { SITE_PORT } from '../env';

const SITE = `http://localhost:${SITE_PORT}`;

test.describe('Site de apresentação', () => {
  test('mostra a proposta, leva a pessoa à aplicação e responde às interações', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(SITE);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Venda mais projetos solares',
    );
    // "Entrar" aponta para a tela de login da aplicação (outro endereço).
    await expect(page.getByRole('link', { name: 'Entrar', exact: true })).toHaveAttribute(
      'href',
      /\/login$/,
    );

    // Dúvidas frequentes abrem e fecham.
    await page.locator('#duvidas').scrollIntoViewIfNeeded();
    const first = page.locator('.acc details').first();
    await first.locator('summary').click();
    await expect(first).toHaveAttribute('open', '');

    // A simulação de margem trava abaixo do mínimo.
    await page.locator('#margem').scrollIntoViewIfNeeded();
    const range = page.locator('[data-range]');
    await range.fill('32000');
    await expect(page.locator('[data-status]')).toContainText('Abaixo da margem mínima');
    await range.fill('42000');
    await expect(page.locator('[data-status]')).toContainText('Dentro da política');
    expect(errors).toEqual([]);
  });

  test('o formulário cobra os dados antes de enviar', async ({ page }) => {
    await page.goto(`${SITE}/#contato`);
    const form = page.locator('[data-form]');
    await form.getByRole('button', { name: 'Pedir demonstração' }).click();
    await expect(form.locator('[data-msg]')).toContainText('Informe seu nome');
    await form.getByLabel('Seu nome').fill('Maria Souza');
    await form.getByRole('button', { name: 'Pedir demonstração' }).click();
    await expect(form.locator('[data-msg]')).toContainText('telefone ou um e-mail');
  });

  test('com o servidor lento, avisa que está acordando em vez de parecer travado', async ({
    page,
  }) => {
    await page.route('**/api/v1/public/leads/**', async (route) => {
      await new Promise((r) => setTimeout(r, 7_000));
      await route.fulfill({ status: 202, json: { ok: true } });
    });
    await page.goto(`${SITE}/#contato`);
    const form = page.locator('[data-form]');
    await form.getByLabel('Seu nome').fill('Maria Souza');
    await form.getByLabel('Telefone (com DDD)').fill('(85) 98888-7777');
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Pedir demonstração' }).click();
    await expect(form.locator('[data-msg]')).toContainText('Ainda enviando');
    await expect(form.locator('[data-msg]')).toContainText('Recebemos seu contato', {
      timeout: 15_000,
    });
  });
});
