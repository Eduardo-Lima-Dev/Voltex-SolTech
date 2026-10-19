import { expect, test } from '@playwright/test';
import { USERS, loginAs } from './helpers';

test.describe('Solar Calculator', () => {
  test('calcula, mostra o resultado e guarda o snapshot', async ({ page }) => {
    await loginAs(page, USERS.seller);
    await page.goto('/calculator/new');

    await page.getByLabel('Título (opcional)').fill('Residência do teste e2e');
    await page.getByLabel('HSP médio (kWh/m²·dia)').fill('5');
    await page.getByRole('button', { name: /Próximo/ }).click();

    await page.getByLabel('Jan', { exact: true }).fill('500');
    await page.getByRole('button', { name: 'Repetir janeiro nos demais meses' }).click();
    await page.getByLabel('Custo de disponibilidade (kWh/mês)').fill('30');
    await page.getByRole('button', { name: /Próximo/ }).click();

    await page.getByLabel('Tarifa de energia (R$/kWh)').fill('0,95');
    await page.getByRole('button', { name: /Próximo/ }).click();

    await page.getByLabel('Potência do módulo (Wp)').fill('550');
    await page.getByLabel('Área do módulo (m²)').fill('2,58');
    await page.getByLabel('Custo do sistema (R$/Wp)').fill('4,50');
    await page.getByLabel('Performance Ratio (PR)').fill('0,80');

    // Prévia no próprio formulário, com o mesmo motor do servidor.
    await expect(
      page.getByRole('complementary', { name: 'Resultado parcial' }).getByText('4,4 kWp'),
    ).toBeVisible();

    await page.getByRole('button', { name: /Calcular e salvar/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Residência do teste e2e', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('4,4 kWp').first()).toBeVisible();

    await page.getByRole('button', { name: /Salvar snapshot/ }).click();
    await expect(page.getByText(/Snapshot/i).first()).toBeVisible();

    // Aparece na lista.
    await page.goto('/calculator');
    await expect(page.getByRole('row', { name: /Residência do teste e2e/ })).toBeVisible();
  });

  test('campos obrigatórios são cobrados antes de avançar', async ({ page }) => {
    await loginAs(page, USERS.seller);
    await page.goto('/calculator/new');
    await page.getByRole('button', { name: /Próximo/ }).click();
    await expect(page.getByText('Campo obrigatório').first()).toBeVisible();
  });
});
