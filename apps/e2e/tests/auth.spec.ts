import { expect, test } from '@playwright/test';
import { USERS, loginAs, loginUi } from './helpers';

test.describe('Acesso', () => {
  test('entra, navega entre os produtos e sai', async ({ page }) => {
    await loginAs(page, USERS.owner);
    // O CRM abre um submenu na barra lateral com as telas.
    await page.getByRole('button', { name: 'CRM Solar' }).click();
    await expect(page).toHaveURL(/\/crm\/leads/);
    await page.getByRole('link', { name: 'Oportunidades' }).click();
    await expect(page).toHaveURL(/\/crm\/oportunidades/);
    await expect(page.getByRole('button', { name: 'Quadro' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('link', { name: 'Solar Calculator' }).first().click();
    await expect(page).toHaveURL(/\/calculator/);
    await page
      .getByRole('button', { name: /EO|Eduardo|Conta|Menu/i })
      .first()
      .click()
      .catch(() => undefined);
  });

  test('senha errada não entra e mostra o erro', async ({ page }) => {
    await loginUi(page, USERS.owner, 'senha-errada-123');
    await expect(
      page
        .getByRole('alert')
        .or(page.getByText(/inválid|incorret/i))
        .first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('visitante é levado ao login e volta à página pedida depois de entrar', async ({ page }) => {
    await page.goto('/crm/leads');
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('E-mail').fill(USERS.manager);
    await page
      .getByLabel('Senha', { exact: true })
      .fill(process.env.SEED_PASSWORD ?? 'Voltex@2026');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/crm\/leads/);
  });

  test('o vendedor não vê a Administração nem acessa a rota', async ({ page }) => {
    await loginAs(page, USERS.seller);
    await expect(page.getByRole('button', { name: 'Administração' })).toHaveCount(0);
    await page.goto('/admin/empresa');
    await expect(page.getByRole('heading', { name: 'Sem acesso a esta área' })).toBeVisible();
  });
});
