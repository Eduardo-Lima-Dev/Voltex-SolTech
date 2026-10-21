import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { EquipmentDetailDto, EquipmentDto, ImportPreviewDto } from '@voltex/shared';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const now = '2026-10-20T12:00:00.000Z';

const moduleSpec = {
  technology: 'MONO_SI',
  pmaxWp: 550,
  vmppV: 41.7,
  imppA: 13.19,
  vocV: 49.7,
  iscA: 13.98,
  betaVocPctPerC: -0.27,
  alphaIscPctPerC: 0.05,
  gammaPmaxPctPerC: -0.34,
  lengthMm: 2278,
  widthMm: 1134,
  bifacial: false,
};

const equipment = (overrides: Partial<EquipmentDto> = {}): EquipmentDto => ({
  id: 'e-1',
  kind: 'MODULE',
  manufacturer: 'Fabricante Teste',
  model: 'FT-550M',
  spec: moduleSpec as never,
  origin: 'MANUAL',
  fieldConfidence: {},
  referenceCostCents: null,
  datasheetDocumentId: null,
  inmetroRegistration: null,
  inmetroStatus: 'NOT_VERIFIED',
  inmetroCheckedAt: null,
  inmetroCheckedBy: null,
  status: 'DRAFT',
  revision: 1,
  supersedesId: null,
  approvedById: null,
  approvedAt: null,
  retiredAt: null,
  notes: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const detail = (overrides: Partial<EquipmentDetailDto> = {}): EquipmentDetailDto => ({
  ...equipment(),
  issues: [
    {
      code: 'INMETRO_NOT_VERIFIED',
      severity: 'WARNING',
      field: 'inmetroStatus',
      message: 'O registro no INMETRO ainda não foi conferido na consulta oficial.',
    },
  ],
  revisions: [],
  ...overrides,
});

const page = (data: EquipmentDto[]) => ({
  data,
  meta: { page: 1, pageSize: 20, total: data.length },
});

describe('Administração → Catálogo técnico', () => {
  const base = (...overrides: Parameters<typeof server.use>) =>
    server.use(
      ...overrides,
      http.get(`${API}/catalog/source-links`, () => HttpResponse.json([])),
      http.get(`${API}/catalog/items`, ({ request }) => {
        const kind = new URL(request.url).searchParams.get('kind');
        return HttpResponse.json(
          page(
            kind === 'MODULE'
              ? [
                  equipment(),
                  equipment({
                    id: 'e-2',
                    model: 'FT-600M',
                    status: 'APPROVED',
                    revision: 2,
                    origin: 'PAN',
                    inmetroStatus: 'VERIFIED',
                  }),
                ]
              : [],
          ),
        );
      }),
      http.get(`${API}/catalog/references`, () => HttpResponse.json(page([]))),
      http.get(`${API}/catalog/prices`, () => HttpResponse.json([])),
    );

  it('lista os módulos com resumo da ficha, situação e origem; as outras abas começam vazias', async () => {
    base();
    renderApp('/engine/catalogo');
    const draft = (await screen.findByText(/FT-550M/)).closest('tr') as HTMLElement;
    expect(within(draft).getByText('550 Wp · 49,7 V (Voc)')).toBeInTheDocument();
    expect(within(draft).getByText('Rascunho')).toBeInTheDocument();
    expect(within(draft).getByText('Manual')).toBeInTheDocument();
    const approved = screen.getByText(/FT-600M/).closest('tr') as HTMLElement;
    expect(within(approved).getByText('Aprovado')).toBeInTheDocument();
    expect(within(approved).getByText('INMETRO')).toBeInTheDocument();
    expect(within(approved).getByText('Arquivo .PAN')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('tab', { name: 'Inversores' }));
    expect(await screen.findByText(/Nada por aqui ainda/)).toBeInTheDocument();
  });

  it('cadastra um módulo à mão e abre o rascunho criado', async () => {
    let body:
      | { kind: string; manufacturer: string; model: string; spec: Record<string, unknown> }
      | undefined;
    base(
      http.post(`${API}/catalog/items`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json(equipment({ id: 'e-9', model: 'NOVO' }), { status: 201 });
      }),
      http.get(`${API}/catalog/items/e-9`, () =>
        HttpResponse.json(detail({ id: 'e-9', model: 'NOVO' })),
      ),
    );
    renderApp('/engine/catalogo');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Novo módulo/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Fabricante'), 'Fabricante Teste');
    await user.type(within(dialog).getByLabelText('Modelo'), 'NOVO');
    await user.selectOptions(within(dialog).getByLabelText(/Tecnologia/), 'MONO_SI');
    const fill = async (label: RegExp, value: string) =>
      user.type(within(dialog).getByLabelText(label), value);
    await fill(/Potência máxima/, '550');
    await fill(/Tensão de máxima potência/, '41,7');
    await fill(/Corrente de máxima potência/, '13,19');
    await fill(/Tensão de circuito aberto/, '49,7');
    await fill(/Corrente de curto-circuito/, '13,98');
    await fill(/Coeficiente de Voc/, '-0,27');
    await fill(/Coeficiente de Isc/, '0,05');
    await fill(/Coeficiente de potência/, '-0,34');
    await fill(/Comprimento/, '2278');
    await fill(/Largura/, '1134');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      kind: 'MODULE',
      manufacturer: 'Fabricante Teste',
      model: 'NOVO',
      spec: {
        technology: 'MONO_SI',
        pmaxWp: 550,
        vmppV: 41.7,
        betaVocPctPerC: -0.27,
        lengthMm: 2278,
      },
    });
    expect(await screen.findByText(/revisão 1/)).toBeInTheDocument();
  });

  it('o formulário aponta campos obrigatórios e números inválidos sem chamar a API', async () => {
    let calls = 0;
    base(
      http.post(`${API}/catalog/items`, () => {
        calls += 1;
        return HttpResponse.json(equipment(), { status: 201 });
      }),
    );
    renderApp('/engine/catalogo');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Novo módulo/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Potência máxima/), 'abc');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar rascunho' }));
    expect(await within(dialog).findByText('Informe o fabricante.')).toBeInTheDocument();
    expect(within(dialog).getByText('Use um número.')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Obrigatório.').length).toBeGreaterThan(3);
    expect(calls).toBe(0);
  });

  it('o responsável técnico aprova; quem só edita o catálogo não vê o botão de aprovar', async () => {
    let approved = 0;
    base(
      http.get(`${API}/catalog/items/e-1`, () => HttpResponse.json(detail())),
      http.post(`${API}/catalog/items/e-1/approve`, () => {
        approved += 1;
        return HttpResponse.json(detail({ status: 'APPROVED', approvedAt: now }));
      }),
    );
    const view = renderApp('/engine/catalogo', { session: makeSession('TECHNICAL_LEAD') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Abrir Fabricante Teste FT-550M/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/INMETRO ainda não foi conferido/)).toBeInTheDocument();
    expect(within(dialog).getByText('550 Wp')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Aprovar para uso' }));
    await waitFor(() => expect(approved).toBe(1));
    view.unmount();

    base(http.get(`${API}/catalog/items/e-1`, () => HttpResponse.json(detail())));
    renderApp('/engine/catalogo', { session: makeSession('ENGINEERING') });
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: /Abrir Fabricante Teste FT-550M/ }));
    const eng = await screen.findByRole('dialog');
    expect(
      await within(eng).findByText(/A aprovação é do responsável técnico/),
    ).toBeInTheDocument();
    expect(within(eng).queryByRole('button', { name: 'Aprovar para uso' })).not.toBeInTheDocument();
    expect(within(eng).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
  });

  it('erro físico na ficha desabilita a aprovação', async () => {
    base(
      http.get(`${API}/catalog/items/e-1`, () =>
        HttpResponse.json(
          detail({
            issues: [
              {
                code: 'VMPP_NOT_BELOW_VOC',
                severity: 'ERROR',
                field: 'vmppV',
                message: 'Vmpp deve ser menor que Voc.',
              },
            ],
          }),
        ),
      ),
    );
    renderApp('/engine/catalogo', { session: makeSession('TECHNICAL_LEAD') });
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: /Abrir Fabricante Teste FT-550M/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Vmpp deve ser menor que Voc.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Aprovar para uso' })).toBeDisabled();
  });

  it('item aprovado: nova revisão em vez de editar; INMETRO é conferido à mão', async () => {
    let revised = 0;
    let inmetro: unknown;
    base(
      http.get(`${API}/catalog/items/e-2`, () =>
        HttpResponse.json(detail({ id: 'e-2', status: 'APPROVED', approvedAt: now, revision: 2 })),
      ),
      http.post(`${API}/catalog/items/e-2/revise`, () => {
        revised += 1;
        return HttpResponse.json(equipment({ id: 'e-3', revision: 3 }), { status: 201 });
      }),
      http.post(`${API}/catalog/items/e-2/inmetro`, async ({ request }) => {
        inmetro = await request.json();
        return HttpResponse.json(equipment({ id: 'e-2', status: 'APPROVED' }));
      }),
    );
    renderApp('/engine/catalogo', { session: makeSession('TECHNICAL_LEAD') });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Abrir Fabricante Teste FT-600M/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('button', { name: 'Nova revisão' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Número do registro'), '012345/2026');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar conferência' }));
    await waitFor(() =>
      expect(inmetro).toEqual({ status: 'VERIFIED', registration: '012345/2026' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Nova revisão' }));
    await waitFor(() => expect(revised).toBe(1));
  });

  describe('importação', () => {
    const candidate = (over: Partial<ImportPreviewDto['candidates'][number]> = {}) => ({
      kind: 'MODULE' as const,
      manufacturer: '',
      model: '',
      spec: { technology: 'MONO_SI', pmaxWp: 550 },
      origin: 'DATASHEET_PDF' as const,
      fieldConfidence: { pmaxWp: 'MEDIUM' as const },
      issues: [],
      exists: false,
      missing: ['vmppV', 'imppA', 'vocV', 'iscA'],
      ...over,
    });

    it('lê o arquivo, mostra o que falta, exige completar e só então grava o rascunho', async () => {
      let committed:
        | {
            items: {
              manufacturer: string;
              model: string;
              spec: Record<string, unknown>;
              origin: string;
            }[];
          }
        | undefined;
      base(
        http.post(`${API}/catalog/import/preview`, () =>
          HttpResponse.json({
            format: 'datasheet-pdf',
            candidates: [candidate()],
            errors: [],
            notes: ['Fabricante e modelo não são lidos da ficha: informe à mão.'],
          } satisfies ImportPreviewDto),
        ),
        http.post(`${API}/catalog/import/commit`, async ({ request }) => {
          committed = (await request.json()) as typeof committed;
          return HttpResponse.json({ created: [equipment()] }, { status: 201 });
        }),
        http.post(`${API}/catalog/items/:id/approve`, () => HttpResponse.json(equipment())),
      );
      renderApp('/engine/catalogo');
      const user = userEvent.setup();
      await user.click(
        (await screen.findAllByRole('button', { name: /Importar/ }))[0] as HTMLElement,
      );
      const dialog = await screen.findByRole('dialog');
      await user.selectOptions(within(dialog).getByLabelText('Tipo de arquivo'), 'datasheet-pdf');
      await user.upload(
        within(dialog).getByLabelText('Arquivo'),
        new File(['%PDF'], 'ficha.pdf', { type: 'application/pdf' }),
      );
      await user.click(within(dialog).getByRole('button', { name: /Ler arquivo/ }));
      expect(await within(dialog).findByText('faltam 4 campo(s)')).toBeInTheDocument();
      expect(within(dialog).getByText(/Fabricante e modelo não são lidos/)).toBeInTheDocument();
      const save = within(dialog).getByRole('button', { name: /Importar e aprovar 0/ });
      expect(save).toBeDisabled();
      expect(within(dialog).getAllByRole('checkbox')[0] as HTMLElement).toBeDisabled();

      await user.click(within(dialog).getByRole('button', { name: 'Conferir e completar' }));
      const form = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement;
      expect(within(form).getByText('convertido: confira')).toBeInTheDocument();
      await user.type(within(form).getByLabelText('Fabricante'), 'Fabricante Teste');
      await user.type(within(form).getByLabelText('Modelo'), 'FT-550M');
      await user.type(within(form).getByLabelText(/Tensão de máxima potência/), '41,7');
      await user.type(within(form).getByLabelText(/Corrente de máxima potência/), '13,19');
      await user.type(within(form).getByLabelText(/Tensão de circuito aberto/), '49,7');
      await user.type(within(form).getByLabelText(/Corrente de curto-circuito/), '13,98');
      await user.type(within(form).getByLabelText(/Coeficiente de Voc/), '-0,27');
      await user.type(within(form).getByLabelText(/Coeficiente de Isc/), '0,05');
      await user.type(within(form).getByLabelText(/Coeficiente de potência/), '-0,34');
      await user.type(within(form).getByLabelText(/Comprimento/), '2278');
      await user.type(within(form).getByLabelText(/Largura/), '1134');
      // Com um item só, completar já grava e aprova: não há segundo clique.
      await user.click(within(form).getByRole('button', { name: 'Salvar, aprovar e usar' }));
      await waitFor(() => expect(committed).toBeDefined());
      expect(committed?.items[0]).toMatchObject({
        manufacturer: 'Fabricante Teste',
        model: 'FT-550M',
        origin: 'DATASHEET_PDF',
        spec: { pmaxWp: 550, vmppV: 41.7, lengthMm: 2278 },
      });
    });

    it('arquivo ilegível mostra o motivo e deixa escolher outro', async () => {
      base(
        http.post(`${API}/catalog/import/preview`, () =>
          HttpResponse.json({
            format: 'pan',
            candidates: [],
            errors: [
              { message: 'Arquivo não reconhecido: o cabeçalho deveria ser PVObject_=pvModule.' },
            ],
            notes: [],
          } satisfies ImportPreviewDto),
        ),
      );
      renderApp('/engine/catalogo');
      const user = userEvent.setup();
      await user.click(
        (await screen.findAllByRole('button', { name: /Importar/ }))[0] as HTMLElement,
      );
      const dialog = await screen.findByRole('dialog');
      await user.selectOptions(within(dialog).getByLabelText('Tipo de arquivo'), 'pan');
      await user.upload(within(dialog).getByLabelText('Arquivo'), new File(['x'], 'x.pan'));
      await user.click(within(dialog).getByRole('button', { name: /Ler arquivo/ }));
      expect(await within(dialog).findByText(/Arquivo não reconhecido/)).toBeInTheDocument();
      expect(
        within(dialog).getByText('Nenhum equipamento encontrado no arquivo.'),
      ).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Escolher outro arquivo' }));
      expect(await within(dialog).findByLabelText('Arquivo')).toBeInTheDocument();
    });
  });

  it('preços: confere a planilha antes de importar e mostra linhas sem par e com erro', async () => {
    let dry: string | null = null;
    base(
      http.post(`${API}/catalog/prices/import`, ({ request }) => {
        dry = new URL(request.url).searchParams.get('dryRun');
        return HttpResponse.json({
          rowsRead: 3,
          created: 0,
          unmatched: [{ row: 3, manufacturer: 'Ninguém', model: 'X' }],
          errors: [{ row: 4, message: 'Preço inválido (use reais, ex.: 1234,50).' }],
          dryRun: true,
        });
      }),
    );
    renderApp('/engine/catalogo');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Preços' }));
    await user.upload(
      await screen.findByLabelText('Planilha (CSV)'),
      new File(['a;b'], 'precos.csv', { type: 'text/csv' }),
    );
    await user.click(screen.getByRole('button', { name: 'Conferir' }));
    expect(await screen.findByText(/Linha 3: Ninguém X não está aprovado/)).toBeInTheDocument();
    expect(screen.getByText(/Linha 4: Preço inválido/)).toBeInTheDocument();
    expect(dry).toBe('true');
  });

  it('referências externas: explica por que a lista está vazia e permite adotar com os campos que faltam', async () => {
    let adopted: unknown;
    base(
      http.get(`${API}/catalog/sources`, () => HttpResponse.json([])),
      http.get(`${API}/catalog/references`, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get('search') === 'vazio'
            ? page([])
            : {
                data: [
                  {
                    id: 'r-1',
                    kind: 'MODULE',
                    manufacturer: 'Ref',
                    model: 'R-550',
                    source: 'cec-library',
                    collectedAt: now,
                    attribution: 'Biblioteca de equipamentos CEC/SAM.',
                    spec: { ...moduleSpec, lengthMm: undefined, widthMm: undefined },
                  },
                ],
                meta: { page: 1, pageSize: 20, total: 1 },
              },
        ),
      ),
      http.post(`${API}/catalog/references/r-1/adopt`, async ({ request }) => {
        adopted = await request.json();
        return HttpResponse.json(equipment({ origin: 'CEC' }), { status: 201 });
      }),
    );
    renderApp('/engine/catalogo');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Referências externas' }));
    expect(await screen.findByText(/Ref R-550/)).toBeInTheDocument();
    expect(screen.getByText('Biblioteca de equipamentos CEC/SAM.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adotar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Fabricante')).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Comprimento/), '2278');
    await user.type(within(dialog).getByLabelText(/Largura/), '1134');
    await user.click(within(dialog).getByRole('button', { name: 'Adotar como rascunho' }));
    await waitFor(() => expect(adopted).toMatchObject({ spec: { lengthMm: 2278, widthMm: 1134 } }));
  });

  it('fontes na internet: lista as fontes, busca fichas, lê a prévia e só importa depois da confirmação', async () => {
    let committed: unknown;
    const sources = [
      {
        key: 'techlux',
        label: 'Techlux (distribuidora): fichas técnicas e manuais',
        baseUrl: 'https://techlux.com.br',
        license: 'x',
        attribution: 'Techlux',
        licenseStatus: 'PENDING_REVIEW',
        enabled: true,
        notes: 'Só a lista de links é guardada.',
        documentCount: 2,
        indexedAt: now,
        mode: 'documents',
      },
      {
        key: 'cec-library',
        label: 'Biblioteca CEC/SAM',
        baseUrl: 'https://github.com/NREL/SAM',
        license: 'x',
        attribution: 'CEC',
        licenseStatus: 'PENDING_REVIEW',
        enabled: false,
        notes: 'Bloqueada.',
        documentCount: 0,
        indexedAt: null,
        mode: 'library',
      },
    ];
    const doc = {
      id: 'd-1',
      sourceKey: 'techlux',
      docType: 'Datasheet',
      title: 'Inversor CSI 15-25K Trifásico',
      brand: 'CSI',
      pdfUrl: 'https://techlux.com.br/storage/a.pdf',
      productUrl: null,
      equipmentHint: 'INVERTER',
      collectedAt: now,
    };
    const preview: ImportPreviewDto = {
      format: 'datasheet-pdf',
      candidates: [
        {
          kind: 'INVERTER',
          manufacturer: 'CSI',
          model: 'CSI-15K',
          spec: { topology: 'STRING', pAcNomW: 15000 } as never,
          origin: 'DATASHEET_PDF',
          fieldConfidence: {},
          issues: [],
          exists: false,
          missing: [],
        } as never,
      ],
      errors: [],
      notes: ['Fonte: Inversor CSI — https://techlux.com.br/storage/a.pdf'],
    };
    base(
      http.get(`${API}/catalog/sources`, () => HttpResponse.json(sources)),
      http.get(`${API}/catalog/sources/techlux/documents`, ({ request }) => {
        const q = new URL(request.url).searchParams.get('search');
        return HttpResponse.json(
          q === 'nada' ? page([]) : { data: [doc], meta: { page: 1, pageSize: 20, total: 1 } },
        );
      }),
      http.post(`${API}/catalog/sources/documents/d-1/preview`, () => HttpResponse.json(preview)),
      http.post(`${API}/catalog/import/commit`, async ({ request }) => {
        committed = await request.json();
        return HttpResponse.json({ created: [{ id: 'n-1' }] }, { status: 201 });
      }),
      http.post(`${API}/catalog/items/:id/approve`, () => HttpResponse.json({ id: 'n-1' })),
    );
    renderApp('/engine/catalogo');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Referências externas' }));
    // Todas as fontes aparecem, com situação e licença.
    expect(
      await screen.findByText('Techlux (distribuidora): fichas técnicas e manuais'),
    ).toBeInTheDocument();
    expect(screen.getByText('Biblioteca CEC/SAM')).toBeInTheDocument();
    expect(screen.getByText('Ligada')).toBeInTheDocument();
    expect(screen.getByText('Desligada')).toBeInTheDocument();
    await user.click(
      screen.getAllByRole('button', { name: 'Buscar nesta fonte' })[0] as HTMLElement,
    );
    expect(await screen.findByText('Inversor CSI 15-25K Trifásico')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Buscar fichas técnicas'), 'nada');
    expect(await screen.findByText(/Nenhum documento/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Buscar fichas técnicas'));
    await user.click(await screen.findByRole('button', { name: 'Ver prévia e importar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Fonte: Inversor CSI/)).toBeInTheDocument();
    expect(committed).toBeUndefined();
    // A ficha completa já vem marcada para importar.
    await user.click(within(dialog).getByRole('button', { name: /Importar e aprovar 1|Gravar 1/ }));
    await waitFor(() =>
      expect(committed).toMatchObject({
        items: [{ kind: 'INVERTER', model: 'CSI-15K', origin: 'DATASHEET_PDF' }],
      }),
    );
  });

  it('suas fontes por link: cola o endereço, o sistema analisa e mostra o que achou e por quê; a prévia abre para importar', async () => {
    const link = {
      id: 'l-1',
      url: 'https://loja.example.com/downloads',
      label: 'Loja Exemplo',
      status: 'ACTIVE',
      lastAnalyzedAt: now,
      lastError: null,
      pagesRead: 2,
      documentCount: 2,
      byEquipment: { MODULE: 1, CABLE: 1 },
      createdAt: now,
    };
    let created = false;
    let added: unknown;
    const doc = {
      id: 'd-1',
      linkId: 'l-1',
      url: 'https://loja.example.com/a.pdf',
      fileType: 'pdf',
      title: 'Ficha técnica Módulo Jinko 550 W',
      brand: 'Jinko',
      docType: 'DATASHEET',
      equipmentHint: 'MODULE',
      productUrl: null,
      confidence: 'HIGH',
      reasons: ['Palavras de ficha técnica/datasheet', 'Marca "Jinko" reconhecida'],
      collectedAt: now,
    };
    base(
      http.get(`${API}/catalog/sources`, () => HttpResponse.json([])),
      http.get(`${API}/catalog/source-links`, () => HttpResponse.json(created ? [link] : [])),
      http.post(`${API}/catalog/source-links`, async ({ request }) => {
        added = await request.json();
        created = true;
        return HttpResponse.json(link, { status: 201 });
      }),
      http.get(`${API}/catalog/source-links/l-1/documents`, () =>
        HttpResponse.json({ data: [doc], meta: { page: 1, pageSize: 25, total: 1 } }),
      ),
      http.post(`${API}/catalog/source-links/documents/d-1/preview`, () =>
        HttpResponse.json({
          format: 'datasheet-pdf',
          candidates: [
            {
              kind: 'MODULE',
              manufacturer: 'Jinko',
              model: 'JKM550M',
              spec: { pmaxWp: 550 },
              origin: 'DATASHEET_PDF',
              fieldConfidence: {},
              issues: [],
              exists: false,
              missing: ['technology'],
            },
          ],
          errors: [],
          notes: ['Fonte: Loja Exemplo — https://loja.example.com/a.pdf'],
        }),
      ),
    );
    renderApp('/engine/catalogo');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Referências externas' }));
    expect(await screen.findByText('Nenhuma fonte cadastrada ainda.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Endereço (link)'), 'https://loja.example.com/downloads');
    await user.type(screen.getByLabelText('Nome (opcional)'), 'Loja Exemplo');
    await user.click(screen.getByRole('button', { name: 'Adicionar e analisar' }));
    await waitFor(() =>
      expect(added).toEqual({ url: 'https://loja.example.com/downloads', label: 'Loja Exemplo' }),
    );
    expect(await screen.findByText('Loja Exemplo')).toBeInTheDocument();
    expect(await screen.findByText(/2 arquivo\(s\) · 1 módulo · 1 cabo/)).toBeInTheDocument();
    // A fonte recém-analisada já abre a lista, com a classificação e o motivo.
    expect(await screen.findByText('Ficha técnica Módulo Jinko 550 W')).toBeInTheDocument();
    expect(screen.getByText('Alta').closest('[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('Marca "Jinko" reconhecida'),
    );
    await user.click(screen.getByRole('button', { name: 'Ver prévia e importar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Fonte: Loja Exemplo/)).toBeInTheDocument();
  });

  it('quem não tem permissão de ler o catálogo não acessa a tela', async () => {
    base();
    renderApp('/engine/catalogo', { session: makeSession('SALESPERSON') });
    expect(
      await screen.findByText(/não tem permissão|sem permissão|Acesso negado/i),
    ).toBeInTheDocument();
  });

  describe('busca dentro dos modais do catálogo', () => {
    const result = (over: object = {}) => ({
      origin: 'SOURCE',
      id: 'r-1',
      kind: 'MODULE',
      manufacturer: 'Fonte',
      model: 'FT-550M',
      sourceLabel: 'Techlux (distribuidora)',
      detail: 'Módulo · Datasheet (PDF)',
      fileType: 'pdf',
      ...over,
    });

    it('o modal de novo equipamento busca nas fontes e preenche o formulário com o que leu', async () => {
      let body:
        { origin: string; fieldConfidence: Record<string, string>; model: string } | undefined;
      base(
        http.get(`${API}/catalog/search`, () => HttpResponse.json([result()])),
        http.post(`${API}/catalog/sources/documents/r-1/preview`, () =>
          HttpResponse.json({
            format: 'datasheet-pdf',
            candidates: [
              {
                kind: 'MODULE',
                manufacturer: 'Jinko',
                model: 'JKM550M',
                spec: { ...moduleSpec, technology: 'MONO_SI' },
                origin: 'DATASHEET_PDF',
                fieldConfidence: { pmaxWp: 'MEDIUM' },
                issues: [],
                exists: false,
                missing: [],
              },
            ],
            errors: [],
            notes: ['Fonte: Techlux'],
          } satisfies ImportPreviewDto),
        ),
        http.post(`${API}/catalog/items`, async ({ request }) => {
          body = (await request.json()) as typeof body;
          return HttpResponse.json(equipment({ id: 'e-9' }), { status: 201 });
        }),
        http.get(`${API}/catalog/items/e-9`, () => HttpResponse.json(detail({ id: 'e-9' }))),
      );
      renderApp('/engine/catalogo');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Novo módulo/ }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByLabelText(/Buscar para preencher/));
      await user.click(await within(dialog).findByRole('option', { name: /FT-550M/ }));
      // O campo já existe antes da leitura da ficha terminar: espera o preenchimento, não só o campo.
      await waitFor(() => expect(within(dialog).getByLabelText('Fabricante')).toHaveValue('Jinko'));
      expect(await within(dialog).findByText(/Preenchido a partir de Techlux/)).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Modelo')).toHaveValue('JKM550M');
      expect(within(dialog).getByLabelText(/Potência máxima/)).toHaveValue('550');
      await user.click(within(dialog).getByRole('button', { name: 'Salvar rascunho' }));
      await waitFor(() => expect(body).toBeDefined());
      expect(body).toMatchObject({
        origin: 'DATASHEET_PDF',
        model: 'JKM550M',
        fieldConfidence: { pmaxWp: 'MEDIUM' },
      });
    });

    it('resultado do seu catálogo copia a ficha como base; PDF ilegível avisa e não preenche', async () => {
      base(
        http.get(`${API}/catalog/search`, () =>
          HttpResponse.json([
            result({
              origin: 'CATALOG',
              id: 'e-1',
              manufacturer: 'Fabricante Teste',
              model: 'FT-550M',
              status: 'APPROVED',
            }),
            result({ id: 'r-2', model: 'Ruim' }),
          ]),
        ),
        http.get(`${API}/catalog/items/e-1`, () => HttpResponse.json(detail())),
        http.post(`${API}/catalog/sources/documents/r-2/preview`, () =>
          HttpResponse.json({
            format: 'datasheet-pdf',
            candidates: [],
            errors: [{ message: 'PDF sem texto' }],
            notes: [],
          } satisfies ImportPreviewDto),
        ),
      );
      renderApp('/engine/catalogo');
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Novo módulo/ }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByLabelText(/Buscar para preencher/));
      await user.click(await within(dialog).findByRole('option', { name: /Ruim/ }));
      await waitFor(() => expect(within(dialog).getByLabelText('Modelo')).toHaveValue(''));
      await user.click(within(dialog).getByLabelText(/Buscar para preencher/));
      await user.click(
        await within(dialog).findByRole('option', { name: /Fabricante Teste FT-550M/ }),
      );
      expect(await within(dialog).findByText(/Copiado da ficha/)).toBeInTheDocument();
      await waitFor(() => expect(within(dialog).getByLabelText('Modelo')).toHaveValue('FT-550M'));
    });

    it('o modal de importar também tem busca e abre a conferência da ficha escolhida', async () => {
      base(
        http.get(`${API}/catalog/search`, () => HttpResponse.json([result()])),
        http.post(`${API}/catalog/sources/documents/r-1/preview`, () =>
          HttpResponse.json({
            format: 'datasheet-pdf',
            candidates: [
              {
                kind: 'MODULE',
                manufacturer: 'Jinko',
                model: 'JKM550M',
                spec: moduleSpec,
                origin: 'DATASHEET_PDF',
                fieldConfidence: {},
                issues: [],
                exists: false,
                missing: [],
              },
            ],
            errors: [],
            notes: [],
          } satisfies ImportPreviewDto),
        ),
      );
      renderApp('/engine/catalogo');
      const user = userEvent.setup();
      await user.click(
        (await screen.findAllByRole('button', { name: /Importar/ }))[0] as HTMLElement,
      );
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByLabelText(/Buscar uma ficha/));
      await user.click(await within(dialog).findByRole('option', { name: /FT-550M/ }));
      expect(await within(dialog).findByText('ficha completa')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: /Importar e aprovar 1/ })).toBeEnabled();
    });
  });
});
