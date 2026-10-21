import { describe, expect, it } from 'vitest';
import { OFFGRID_PROVISIONAL_PARAMETERS } from './parameters.js';
import { computeOffgridResults, type OffgridContext } from './project.js';
import { IDS, baseContext, baseDesign } from './fixtures.js';

const rules = (patch: Partial<OffgridContext> = {}): OffgridContext =>
  baseContext({ parameters: { ...OFFGRID_PROVISIONAL_PARAMETERS }, ...patch });

describe('ramos de borda do projeto off-grid', () => {
  it('sem cargas, com equipamento escolhido, não divide por zero', () => {
    const r = computeOffgridResults(baseDesign({ loads: [] }), rules());
    expect(r.simulation?.coveragePct).toBe(100);
    expect(r.simulation?.lolpPct).toBe(0);
    expect(r.sizing.bankWhRequired).toBeNull();
    expect(r.stress?.autonomyDaysEffective).toBe(0);
    expect(
      r.checks.find((c) => c.code === 'AUTONOMY_OK' || c.code === 'AUTONOMY_BELOW_MIN'),
    ).toBeDefined();
  });

  it('banco sem bateria escolhida usa a DoD pedida para dimensionar', () => {
    const r = computeOffgridResults(
      baseDesign({ bank: { seriesCount: 1, parallelCount: 1, designDodPct: 50 } }),
      rules(),
    );
    expect(r.sizing.dodPct).toBe(50);
    expect(r.sizing.bankWhRequired).toBeGreaterThan(0);
    expect(r.sizing.batterySeries).toBeNull();
    expect(r.selected).toBeNull();
  });

  it('módulo sem NOCT, sem βVmpp, controlador sem eficiência e inversor sem potência FV', () => {
    const module = {
      ...(baseContext().modules[IDS.module] as object),
      noctC: undefined,
      betaVmppPctPerC: undefined,
    } as never;
    const controller = {
      ...(baseContext().controllers[IDS.controller] as object),
      efficiencyPct: undefined,
      pvPowerMaxW: undefined,
      mpptMinV: undefined,
    } as never;
    const inverter = {
      ...(baseContext().inverters[IDS.inverter] as object),
      efficiencyPct: undefined,
      standbyW: undefined,
      chargerCurrentA: undefined,
    } as never;
    const r = computeOffgridResults(
      baseDesign({ inverterId: IDS.inverter }),
      rules({
        modules: { [IDS.module]: module },
        controllers: { [IDS.controller]: controller },
        inverters: { [IDS.inverter]: inverter },
      }),
    );
    expect(r.selected).not.toBeNull();
    expect(r.checks.map((c) => c.code)).not.toContain('CONTROLLER_POWER_OK');
  });

  it('inversor com MPPT embutido sem potência máxima e sem contagem', () => {
    const inverter = {
      ...(baseContext().inverters[IDS.inverter] as object),
      mpptBuiltIn: true,
      pvVocMaxV: 250,
      mpptCurrentA: 40,
      mpptMinV: 60,
      mpptMaxV: 230,
    } as never;
    const r = computeOffgridResults(
      baseDesign({ controllerId: undefined }),
      rules({ inverters: { [IDS.inverter]: inverter } }),
    );
    expect(r.selected?.controllerCurrentA).toBe(40);
  });

  it('inversor com MPPT embutido incompleto não vale como controlador', () => {
    const inverter = {
      ...(baseContext().inverters[IDS.inverter] as object),
      mpptBuiltIn: true,
    } as never;
    const r = computeOffgridResults(
      baseDesign({ controllerId: undefined }),
      rules({ inverters: { [IDS.inverter]: inverter } }),
    );
    expect(r.pending.map((p) => p.code)).toContain('CONTROLLER_NOT_SELECTED');
  });

  it('sem preços e sem rótulos a lista de custos aponta os itens', () => {
    const r = computeOffgridResults(baseDesign(), rules({ prices: undefined }));
    expect(r.economics?.missingPrices.length).toBeGreaterThan(3);
    expect(r.warnings.join(' ')).toContain('Sem preço');
    const labeled = computeOffgridResults(
      baseDesign(),
      rules({ labels: { [IDS.module]: 'Módulo 550' } }),
    );
    expect(labeled.economics?.capexItems.some((i) => i.description === 'Módulo 550')).toBe(true);
  });

  it('o clima sem temperaturas de projeto usa as mínimas e máximas do clima', () => {
    const r = computeOffgridResults(
      baseDesign({ site: { ...baseDesign().site, designTminC: null, designTmaxAmbientC: null } }),
      rules(),
    );
    expect(r.pending.map((p) => p.code)).not.toContain('DESIGN_TMIN_MISSING');
  });

  it('o cenário descarta strings quando o primeiro arranjo não existe', () => {
    const r = computeOffgridResults(
      baseDesign({ arrays: [], scenarios: [{ id: 's', name: 'Vazio', parallelStrings: 2 }] }),
      rules(),
    );
    expect(r.scenarios[0]?.pvPowerWp).toBe(0);
    expect(r.scenarios[0]?.capexCents).toBe(0);
  });

  it('status válido sem avisos quando há série e albedo', () => {
    const hours = 24 * 365;
    const sunny = (i: number) => (i % 24 >= 7 && i % 24 < 17 ? 500 : 0);
    const r = computeOffgridResults(
      baseDesign({ albedo: 0.2, stress: { enabled: false } }),
      rules({
        series: {
          startAt: '2021-01-01T00:00:00',
          timeStandard: 'LST',
          ghiWhM2: Array.from({ length: hours }, (_, i) => sunny(i)),
          dhiWhM2: Array.from({ length: hours }, (_, i) => sunny(i) * 0.3),
          tempC: Array(hours).fill(25),
          missingHours: 0,
        },
      }),
    );
    expect(r.resource.source).toBe('SERIES');
    expect(r.status).toBe('VALID');
  });
});

describe('equipamentos citados mas ausentes do contexto', () => {
  it('não quebra e deixa o projeto incompleto', () => {
    const r = computeOffgridResults(
      baseDesign({ generator: { enabled: true, generatorId: IDS.generator } }),
      rules({ modules: {}, batteries: {}, controllers: {}, inverters: {}, generators: {} }),
    );
    expect(r.selected).toBeNull();
    expect(r.simulation).toBeNull();
    expect(r.status).toBe('INCOMPLETE');
    expect(r.checks.filter((c) => c.code === 'EQUIPMENT_NOT_FOUND').length).toBe(0);
  });

  it('com inversor ausente e demais presentes', () => {
    const r = computeOffgridResults(baseDesign(), rules({ inverters: {} }));
    expect(r.selected).toBeNull();
  });
});
