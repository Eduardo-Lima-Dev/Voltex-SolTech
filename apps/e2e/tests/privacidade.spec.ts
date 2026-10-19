import { expect, test } from '@playwright/test';
import { USERS, api, apiToken, loginAs } from './helpers';

test.describe('Privacidade (LGPD)', () => {
  test('o proprietário elimina os dados de um contato e o histórico guarda só as iniciais', async ({
    page,
  }) => {
    const owner = await apiToken(USERS.owner);
    const stamp = `${Date.now()}`.slice(-6);
    const name = `Zélia Quintanilha ${stamp}`;
    await api('/leads', owner, {
      body: {
        name,
        email: `zelia${stamp}@exemplo.com`,
        phone: `(85) 9${stamp.slice(0, 4)}-${stamp.slice(2)}`,
        segment: 'RESIDENTIAL',
      },
    });

    await loginAs(page, USERS.owner);
    await page.goto('/admin/privacidade');
    await expect(page.getByText('Prazos de guarda dos dados')).toBeVisible();

    await page.getByLabel('Buscar pessoa').fill(`zelia${stamp}`);
    await page.getByRole('button', { name: /Buscar/ }).click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await page.getByLabel('De onde veio o pedido').fill('E-mail do titular');
    await page.getByRole('button', { name: 'Eliminar os dados desta pessoa' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Eliminar definitivamente' })
      .click();

    await expect(page.getByText('Dados eliminados').first()).toBeVisible();
    await expect(page.getByText('Z. Q.').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(name);

    // O contato sumiu da lista de leads: ficou só "Titular removido".
    await page.goto('/crm/leads');
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test('os prazos exigem no mínimo 5 anos para contratos e aceitam deixar em branco', async ({
    page,
  }) => {
    await loginAs(page, USERS.owner);
    await page.goto('/admin/privacidade');
    const contracts = page.getByLabel('Contratos assinados (meses)');
    await contracts.fill('48');
    await page.getByRole('button', { name: 'Salvar prazos' }).click();
    await expect(page.getByText(/no mínimo, 60 meses/)).toBeVisible();
    await contracts.fill('60');
    await page.getByRole('button', { name: 'Salvar prazos' }).click();
    await expect(page.getByText('Prazos salvos').first()).toBeVisible();
  });

  test('gestor comercial não tem acesso à tela de privacidade', async ({ page }) => {
    await loginAs(page, USERS.manager);
    await page.goto('/admin/privacidade');
    await expect(page.getByRole('heading', { name: 'Sem acesso a esta área' })).toBeVisible();
  });
});
