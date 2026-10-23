import { test, expect } from '@playwright/test';

/**
 * Jornada ponta a ponta da Fase 11:
 * Projeto aprovado → Material → Campo → Comissionamento → Planta → Monitoramento
 */

test.describe('Jornada de Execução e Lifecycle (11A–11E)', () => {
  // Pré-condição: login como integrador
  let page: any;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');
    // Login
    await page.fill('input[type="email"]', 'admin@teste.test');
    await page.fill('input[type="password"]', 'SenhaForte1');
    await page.click('button:has-text("Entrar")');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('projeto aprovado passa por instalação, comissionamento, ativação', async () => {
    // 1. Acessa ficha do projeto aprovado
    await page.goto('/crm/projects');
    await page.click('text=Projeto Solar 10kWp');
    await expect(page).toHaveTitle(/Projeto/);

    // 2. Verifica status APPROVED
    const projectStatus = await page.locator('[data-testid="project-status"]').innerText();
    expect(projectStatus).toContain('APPROVED');

    // 3. Transiciona para MATERIAL_READY
    await page.click('button:has-text("Marcar material pronto")');
    await expect(page.locator('text=Material recebido')).toBeVisible();

    // 4. Agenda ordem de serviço (campo)
    await page.click('text=Agendar instalação');
    await page.fill('input[name="scheduledDate"]', '2026-11-01');
    await page.click('button:has-text("Confirmar agendamento")');
    await expect(page.locator('text=Agendado')).toBeVisible();

    // 5. Acessa app de campo (offline)
    await page.goto('/campo');
    await page.context().setOffline(true);
    await expect(page.locator('text=Minhas ordens')).toBeVisible();

    // 6. Preenche ordem de serviço
    await page.click('text=Ordem #001');
    await page.fill('input[name="measurement.voltage"]', '380');
    await page.click('button:has-text("Salvar medição")');

    // 7. Sincroniza (volta online)
    await page.context().setOffline(false);
    await page.click('button:has-text("Sincronizar")');
    await expect(page.locator('text=Sincronizado')).toBeVisible();

    // 8. Comissionamento
    await page.goto('/operacao/comissionamento');
    await page.click('text=Projeto Solar 10kWp');
    await page.fill('input[name="test.continuity"]', '0.5');
    await page.click('button:has-text("Enviar para aprovação")');

    // 9. Aprovação por técnico
    await page.context().addCookies([
      {
        name: 'auth_token',
        value: 'token-tecnico-lead',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/operacao/comissionamento');
    await page.click('text=Projeto Solar 10kWp');
    await page.click('button:has-text("Aprovar")');
    await expect(page.locator('text=Aprovado')).toBeVisible();

    // 10. Planta criada automaticamente
    await page.goto('/operacao/plantas');
    const plantCount = await page.locator('[data-testid="plant-list"] > div').count();
    expect(plantCount).toBeGreaterThan(0);
  });

  test('cliente acessa portal com link mágico', async () => {
    // 1. Portal sem autenticação
    await page.goto('/portal/entrar');
    expect(page).toHaveTitle(/Portal/);

    // 2. Solicita link
    await page.fill('input[name="email"]', 'cliente@teste.test');
    await page.click('button:has-text("Receber link")');
    await expect(page.locator('text=Link enviado')).toBeVisible();

    // 3. Simula click no link wa.me/email (token UUID em URL)
    const mockToken = 'mock-magic-token-uuid';
    await page.goto(`/portal/acesso/${mockToken}`);

    // 4. Dashboard carrega (com cookie de sessão)
    await expect(page.locator('text=Seu Portal')).toBeVisible();
    await expect(page.locator('[data-testid="project-list"]')).toBeVisible();
  });

  test('monitoramento com CSV e desempenho real × esperado', async () => {
    // 1. Acessa planta
    await page.goto('/operacao/plantas');
    await page.click('text=Planta 10kWp');

    // 2. Monitora via CSV (nenhuma integração linkada)
    await page.click('text=Importar dados');
    await page.setInputFiles('input[type="file"]', 'e2e/fixtures/monitoring.csv');
    await page.click('button:has-text("Importar")');
    await expect(page.locator('text=Dados importados')).toBeVisible();

    // 3. Gráfico real × esperado
    const chartVisible = await page.locator('[data-testid="performance-chart"]').isVisible();
    expect(chartVisible).toBe(true);

    // 4. Comparação mensal
    const performanceText = await page.locator('[data-testid="performance-index"]').innerText();
    expect(performanceText).toMatch(/\d+%/);
  });

  test.afterEach(async () => {
    await page.close();
  });
});
