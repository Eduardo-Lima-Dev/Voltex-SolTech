import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { SITE_PORT, WEB_PORT } from '../env';
import { USERS, api, apiToken, ensureMarginPolicy, fixture, loginUi } from './helpers';

/**
 * JORNADA DO INTEGRADOR, de ponta a ponta e só pela tela (a API só prepara o que o gestor da empresa já teria feito
 * antes: política de margem e concessionária). O vídeo e uma captura por passo ficam no relatório (`pnpm jornada`).
 *
 * Quem faz o quê: o visitante (site e proposta), o vendedor (do lead até a proposta enviada) e a administradora da
 * empresa (contrato e projeto: o vendedor não escreve contrato).
 */
const SITE = `http://localhost:${SITE_PORT}`;
const APP = `http://localhost:${WEB_PORT}`;

async function snap(page: Page, info: TestInfo, nome: string, espera = 500) {
  await page.waitForTimeout(espera); // deixa a animação da tela terminar para a captura
  await info.attach(nome, { body: await page.screenshot(), contentType: 'image/png' });
}

async function sairEEntrarComo(page: Page, email: string) {
  await page.getByRole('button', { name: /Menu do usuário/ }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login/);
  await loginUi(page, email);
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
}

test('do formulário do site ao projeto protocolado', async ({ page }, info) => {
  const stamp = `${Date.now()}`.slice(-6);
  const cliente = `Marcos Andrade ${stamp}`;
  const telefone = `(85) 9${stamp.slice(0, 4)}-${stamp.slice(2)}`;

  await test.step('Preparação da empresa (API): política de margem e concessionária', async () => {
    const owner = await apiToken(USERS.owner);
    await ensureMarginPolicy(owner);
    await api('/distributors', owner, { body: { name: `Enel Ceará ${stamp}`, state: 'CE' } });
  });

  await test.step('1. O visitante conhece o site e pede uma demonstração', async () => {
    await page.goto(SITE);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Venda mais projetos solares',
    );
    await snap(page, info, 'Abertura do site', 3200);
    await page.locator('#contato').scrollIntoViewIfNeeded();
    const form = page.locator('[data-form]');
    await form.getByLabel('Seu nome').fill(cliente);
    await form.getByLabel('Telefone (com DDD)').fill(telefone);
    await form.getByLabel('Sua empresa').fill('Padaria Estrela');
    await form.getByRole('checkbox').check();
    await snap(page, info, 'Formulário preenchido');
    await form.getByRole('button', { name: 'Pedir demonstração' }).click();
    await expect(form.locator('[data-msg]')).toContainText('Recebemos seu contato');
    await snap(page, info, 'Contato enviado');
  });

  await test.step('2. Ele clica em Entrar e chega na aplicação', async () => {
    await page.locator('header').getByRole('link', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(`${APP}/login`);
    await snap(page, info, 'Tela de entrada da aplicação', 2600);
  });

  await test.step('3. O vendedor entra e encontra o contato como lead no CRM', async () => {
    await page.getByLabel('E-mail').fill(USERS.seller);
    await page
      .getByLabel('Senha', { exact: true })
      .fill(process.env.SEED_PASSWORD ?? 'Voltex@2026');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
    await page.getByRole('button', { name: 'CRM Solar' }).click();
    await expect(page).toHaveURL(/\/crm\/leads/);
    await expect(page.getByText(cliente).first()).toBeVisible();
    await snap(page, info, 'Lead do site na lista de leads');
  });

  let oportunidade = '';
  await test.step('4. O vendedor converte o lead em conta e oportunidade', async () => {
    await page.getByRole('button', { name: `Converter ${cliente}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Converter' }).click();
    await expect(
      page.getByRole('heading', { name: new RegExp(`Sistema solar — ${cliente}`) }),
    ).toBeVisible();
    oportunidade = page.url();
    await snap(page, info, 'Oportunidade criada com o código do projeto');
  });

  await test.step('5. Cadastra o imóvel e a unidade consumidora na conta', async () => {
    await page.getByRole('link', { name: cliente }).first().click();
    await page.getByRole('button', { name: /Imóvel/ }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome do imóvel').fill('Residência');
    await dialog.getByLabel('Rua').fill('Rua das Flores');
    await dialog.getByLabel('Número', { exact: true }).fill('10');
    await dialog.getByLabel('Cidade').fill('Fortaleza');
    await dialog.getByLabel('UF').selectOption('CE');
    await dialog.getByLabel('Latitude (°)').fill('-3,73');
    await dialog.getByLabel('Tipo de telhado').selectOption('CERAMIC');
    await dialog.getByLabel('Azimute (°)').fill('0');
    await dialog.getByLabel('Inclinação (°)').fill('15');
    await dialog.getByLabel('Sombreamento').selectOption('NONE');
    await dialog.getByLabel('Área disponível (m²)').fill('80');
    await dialog.getByLabel('Disjuntor de entrada (A)').fill('63');
    await dialog.getByLabel('Aterramento adequado?').selectOption({ index: 1 });
    await snap(page, info, 'Levantamento técnico do imóvel');
    await dialog.getByRole('button', { name: /Salvar|Cadastrar|Criar/ }).click();
    await expect(page.getByText('Residência').first()).toBeVisible();

    await page.getByRole('button', { name: /UC/ }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Número da UC').fill(`UC${stamp}`);
    await dialog.getByLabel('Concessionária').selectOption({ label: `Enel Ceará ${stamp}` });
    await dialog.getByLabel('Imóvel').selectOption({ label: 'Residência' });
    await dialog.getByLabel('Grupo tarifário').selectOption('B');
    await dialog.getByLabel('Tipo de ligação').selectOption('TWO_PHASE');
    await dialog.getByRole('button', { name: /Salvar|Cadastrar|Criar/ }).click();
    await expect(page.getByText(`UC${stamp}`).first()).toBeVisible();
    await snap(page, info, 'Conta com imóvel e unidade consumidora');
  });

  await test.step('6. Liga o imóvel e a UC à oportunidade e avança no funil', async () => {
    await page.goto(oportunidade);
    await page
      .getByRole('button', { name: /Editar/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Imóvel').selectOption({ index: 1 });
    await dialog.getByLabel('Unidade consumidora').selectOption({ index: 1 });
    await dialog.getByRole('button', { name: /Salvar/ }).click();
    for (const etapa of ['Primeiro contato', 'Qualificação', 'Fatura pendente']) {
      await page.getByLabel('Mudar de etapa').selectOption({ label: etapa });
      await expect(page.getByText(`Movida para ${etapa}`)).toBeVisible();
    }
    await snap(page, info, 'Oportunidade em Fatura pendente');
  });

  await test.step('7. Envia a fatura de energia e confere a leitura', async () => {
    await page.getByRole('tab', { name: 'Fatura', exact: true }).click();
    await page.getByLabel('Arquivo da fatura').setInputFiles(fixture('fatura.pdf'));
    await expect(page.getByText('fatura.pdf').first()).toBeVisible();
    await snap(page, info, 'Fatura enviada');
    await page.getByRole('link', { name: 'Revisar' }).click();
    await expect(page.getByText('Confira com o arquivo ao lado')).toBeVisible();
    await snap(page, info, 'Revisão da leitura da fatura');
    await page.getByLabel('Tarifa (R$/kWh, com impostos)').fill('0,95');
    await page.locator('#bill-m-0').fill('2026-01');
    await page.locator('#bill-k-0').fill('500');
    await page.getByRole('button', { name: /Validar|Confirmar/ }).click();
    await expect(page).toHaveURL(/\/crm\/oportunidades\/[\w-]+$/);
  });

  await test.step('8. Calcula a viabilidade pela calculadora, já com os dados da fatura', async () => {
    await page.getByRole('tab', { name: 'Cálculos' }).click();
    await page.getByRole('link', { name: /Novo cálculo/ }).click();
    await snap(page, info, 'Calculadora pré-preenchida');
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
    await page.getByRole('button', { name: /Calcular e salvar/ }).click();
    await expect(page.getByText('4,4 kWp').first()).toBeVisible();
    await snap(page, info, 'Resultado da viabilidade');
  });

  await test.step('9. Faz a triagem e passa para a cotação', async () => {
    await page.goto(oportunidade);
    await page.getByRole('tab', { name: 'Triagem' }).click();
    await page.getByRole('button', { name: 'Avaliar triagem' }).click();
    await expect(page.getByText('Triagem verde')).toBeVisible();
    await snap(page, info, 'Triagem verde');
    await page.getByLabel('Mudar de etapa').selectOption({ label: 'Cotação' });
  });

  await test.step('10. Monta a cotação: margem baixa é avisada e corrigida', async () => {
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
    await snap(page, info, 'Prévia da margem (abaixo do mínimo)');
    await dialog.getByRole('button', { name: 'Salvar cotação' }).click();
    await expect(page.getByText('Abaixo do mínimo')).toBeVisible();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Abaixo do mínimo' })
      .getByRole('button', { name: /Editar/ })
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Preço de venda (R$)').fill('19.800,00');
    await dialog.getByRole('button', { name: 'Salvar cotação' }).click();
    await expect(page.getByText('Dentro da política')).toBeVisible();
    await snap(page, info, 'Cotação dentro da política de margem');
  });

  let linkProposta = '';
  await test.step('11. Gera a proposta e envia o link ao cliente', async () => {
    await page.getByRole('tab', { name: 'Proposta' }).click();
    await page.getByRole('button', { name: /Gerar proposta/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: /v1/ }).check();
    await dialog.getByLabel('Condições de pagamento (opcional)').fill('30% de entrada + 6x');
    await dialog.getByRole('button', { name: 'Gerar proposta' }).click();
    await expect(page.getByText('Proposta v1')).toBeVisible();
    await page.getByRole('button', { name: /^Enviar$/ }).click();
    linkProposta = await page.getByLabel('Link público da proposta').inputValue();
    expect(linkProposta).toMatch(/\/p\/[\w-]{40,}$/);
    await snap(page, info, 'Link público da proposta');
    await page.keyboard.press('Escape');
  });

  await test.step('12. O cliente abre a proposta, sem login, e aceita', async () => {
    await page.goto(new URL(linkProposta).pathname);
    await expect(page.getByText('R$ 19.800,00').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/margem|comiss/i);
    await snap(page, info, 'Proposta vista pelo cliente');
    await page.getByLabel('Nome completo').fill(cliente);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Aceitar proposta' }).click();
    await expect(page.getByText(/Proposta aceita por/)).toBeVisible();
    await snap(page, info, 'Proposta aceita');
  });

  await test.step('13. A administradora assume: gera o contrato e registra a assinatura', async () => {
    await page.goto(`${APP}/crm/oportunidades`);
    await sairEEntrarComo(page, USERS.admin);
    await page.goto(oportunidade);
    await page.getByRole('tab', { name: 'Linha do tempo' }).click();
    await expect(page.getByText(/aceita por/).first()).toBeVisible();
    await snap(page, info, 'Linha do tempo com o aceite');
    await page.getByRole('tab', { name: 'Contrato' }).click();
    await page.getByRole('button', { name: /Gerar contrato/ }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('CPF/CNPJ do cliente').fill('123.456.789-09');
    await dialog
      .getByLabel('CNPJ da empresa (se não estiver em Empresa)')
      .fill('12.345.678/0001-90');
    await dialog.getByRole('button', { name: 'Gerar contrato' }).click();
    await expect(page.getByText('Contrato v1')).toBeVisible();
    await snap(page, info, 'Contrato gerado');
    await page.getByRole('button', { name: /Registrar assinatura/ }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Confirmar assinatura' }).click();
    await dialog.getByLabel('Contrato assinado').setInputFiles(fixture('contrato-assinado.pdf'));
    await dialog.getByLabel('Quem assinou pelo cliente (opcional)').fill(cliente);
    await dialog.getByRole('button', { name: 'Confirmar assinatura' }).click();
    await snap(page, info, 'Contrato assinado');
  });

  await test.step('14. O projeto nasce com o mesmo código e segue até o protocolo', async () => {
    await page.getByRole('link', { name: 'Abrir o projeto' }).click();
    await expect(page.getByRole('heading', { name: 'Checklist de documentos' })).toBeVisible();
    await snap(page, info, 'Projeto criado com o checklist da distribuidora');
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
    await snap(page, info, 'Documentos resolvidos');
    await page.getByRole('button', { name: 'Protocolar na distribuidora' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Número do protocolo').fill(`PROTO-${stamp}`);
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByText('Solicitação protocolada').first()).toBeVisible();
    await snap(page, info, 'Solicitação protocolada');
  });

  await test.step('15. A oportunidade fica Ganha e aparece no painel', async () => {
    await page.goto(oportunidade);
    await expect(page.getByText('Ganha').first()).toBeVisible();
    await snap(page, info, 'Oportunidade ganha');
    await page.goto(`${APP}/crm/painel`);
    await expect(page.getByText('Negócios ganhos')).toBeVisible();
    await snap(page, info, 'Painel comercial');
  });
});
