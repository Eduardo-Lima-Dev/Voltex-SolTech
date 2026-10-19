import { expect, test } from '@playwright/test';
import { USERS, api, apiToken, loginAs } from './helpers';

test.describe('CRM · do lead à oportunidade', () => {
  test('cadastra um lead, converte em conta e oportunidade e move no funil', async ({ page }) => {
    const stamp = `${Date.now()}`.slice(-6);
    const name = `Lead e2e ${stamp}`;
    await loginAs(page, USERS.manager);

    await page.goto('/crm/leads');
    await page.getByRole('button', { name: /Novo lead/ }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Nome', { exact: true }).fill(name);
    await form.getByLabel('Telefone').fill(`(85) 9${stamp.slice(0, 4)}-${stamp.slice(2)}`);
    await form.getByLabel('Segmento').selectOption('RESIDENTIAL');
    await form.getByRole('button', { name: 'Cadastrar lead' }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    // O mesmo telefone de novo é recusado como duplicado.
    await page.getByRole('button', { name: /Novo lead/ }).click();
    const dup = page.getByRole('dialog');
    await dup.getByLabel('Nome', { exact: true }).fill(`${name} repetido`);
    await dup.getByLabel('Telefone').fill(`(85) 9${stamp.slice(0, 4)}-${stamp.slice(2)}`);
    await dup.getByRole('button', { name: 'Cadastrar lead' }).click();
    await expect(page.getByText(/Já existe um lead/).first()).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: `Converter ${name}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Converter' }).click();
    await expect(
      page.getByRole('heading', { name: new RegExp(`Sistema solar — ${name}`) }),
    ).toBeVisible();
    await expect(page.getByText(/VLX-/).first()).toBeVisible();

    // Mover para a próxima etapa pela oportunidade.
    await page.getByLabel('Mudar de etapa').selectOption({ label: 'Primeiro contato' });
    await expect(page.getByText('Primeiro contato').first()).toBeVisible();

    // Aparece no funil (Kanban).
    await page.goto('/crm/oportunidades');
    await expect(page.getByText(`Sistema solar — ${name}`).first()).toBeVisible();
    await expect(page.getByText(/^\d+ oportunidades?/).first()).toBeVisible();
  });

  test('o seletor de etapa só oferece o que a máquina de estados permite', async ({ page }) => {
    const owner = await apiToken(USERS.owner);
    const acc = await api('/accounts', owner, { body: { name: `Conta etapas ${Date.now()}` } });
    const opp = await api('/opportunities', owner, { body: { accountId: acc.id } });
    await loginAs(page, USERS.manager);
    await page.goto(`/crm/oportunidades/${opp.id}`);
    const select = page.getByLabel('Mudar de etapa');
    await expect(select).toBeVisible();
    const options = await select.locator('option').allTextContents();
    expect(options).toContain('Primeiro contato');
    expect(options).not.toContain('Contrato');
    expect(options).not.toContain('Ganho');
  });

  test('o administrador cria uma coluna própria e esconde uma etapa no funil da empresa', async ({
    page,
  }) => {
    await loginAs(page, USERS.admin);
    await page.goto('/crm/oportunidades');
    await page.getByRole('button', { name: /Configurar etapas/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome da nova coluna').fill('Visita agendada');
    await dialog.getByLabel('Etapa da nova coluna').selectOption({ label: 'Qualificação' });
    await dialog.getByRole('button', { name: 'Adicionar' }).click();
    await expect(dialog.getByLabel('Nome da coluna Visita agendada')).toBeVisible();

    await dialog.getByRole('switch', { name: 'Mostrar Pré-dimensionamento no quadro' }).click();
    await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('region', { name: 'Etapa Visita agendada' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Etapa Pré-dimensionamento' })).toHaveCount(0);
    // A personalização fica guardada na empresa: continua depois de recarregar.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Etapa Visita agendada' })).toBeVisible();
  });
});
