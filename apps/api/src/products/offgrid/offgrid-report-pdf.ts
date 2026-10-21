import PDFDocument from 'pdfkit';
import type { EngineeringVersionStatus, OffgridDesign, OffgridResults } from '@voltex/shared';

const n = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('pt-BR', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export interface OffgridReportInput {
  projectCode: string;
  projectName: string;
  version: number;
  status: EngineeringVersionStatus;
  design: OffgridDesign;
  results: OffgridResults;
}

/**
 * Memorial do projeto off-grid/híbrido. Gerado do desenho e dos resultados já gravados, sem consulta externa.
 * Não é ART nem substitui projeto elétrico assinado.
 */
export function buildOffgridReportPdf(input: OffgridReportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 46,
      info: {
        Title: `Memorial off-grid — ${input.projectCode}`,
        Subject: `Versão ${input.version}`,
        Author: 'Voltex SolTech',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const { results: r, design } = input;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const heading = (text: string) => {
      if (doc.y > doc.page.height - 115) doc.addPage();
      doc.moveDown(0.75).font('Helvetica-Bold').fontSize(14).fillColor('#002362').text(text);
      doc.moveDown(0.25).fillColor('#111');
    };
    const line = (label: string, value: string) => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9).text(`${label}: `, { continued: true });
      doc.font('Helvetica').fontSize(9).text(value);
    };
    const bullet = (text: string, color = '#111') => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      doc.fillColor(color).font('Helvetica').fontSize(9).text(`• ${text}`, { width });
      doc.fillColor('#111');
    };

    doc.rect(0, 0, doc.page.width, 78).fill('#002362');
    doc
      .fillColor('#fff')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(
        design.systemType === 'HYBRID'
          ? 'Memorial — sistema híbrido'
          : 'Memorial — sistema isolado',
        46,
        26,
      );
    doc
      .fillColor('#111')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(input.projectName, 46, 100, { width });
    line('Projeto', input.projectCode);
    line('Versão', `${input.version} · ${input.status}`);
    line(
      'Local',
      `${n(design.site.latitude, 4)}, ${n(design.site.longitude, 4)} ${design.site.city ?? ''}`,
    );
    if (input.status !== 'APPROVED')
      doc
        .moveDown(0.7)
        .fillColor('#a82020')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('RASCUNHO PARA REVISÃO — não substitui projeto elétrico assinado.')
        .fillColor('#111');
    if (r.pending.length > 0)
      for (const p of r.pending) bullet(`Pendência: ${p.message}`, '#a82020');

    heading('1. Cargas');
    line(
      'Energia diária (mês crítico)',
      `${n(r.load.dailyWh)} Wh (CA ${n(r.load.dailyAcWh)} · CC ${n(r.load.dailyDcWh)})`,
    );
    line('Pico / partida', `${n(r.load.peakW)} W / ${n(r.load.surgeW)} W`);
    line('Potência instalada', `${n(r.load.installedW)} W`);
    line('Consumo noturno', `${n(r.load.nightFraction * 100)}%`);
    for (const load of design.loads)
      bullet(
        `${load.name}: ${load.quantity} × ${n(load.powerW)} W, ${n(load.hoursPerDay, 1)} h/dia (${load.kind})`,
      );

    heading('2. Recurso solar');
    line(
      'Fonte',
      r.resource.source === 'SERIES'
        ? 'Série horária da Central'
        : r.resource.source === 'SYNTHETIC'
          ? 'Ano sintético da climatologia'
          : 'Sem recurso solar',
    );
    line(
      'Plano',
      `inclinação ${n(r.resource.tiltDegrees)}°, azimute ${n(r.resource.azimuthDegrees)}°`,
    );
    line(
      'HSP por mês (kWh/m²·dia)',
      MONTHS.map((m, i) => `${m} ${n(r.resource.hspMonthly[i], 2)}`).join(' · '),
    );
    line('Mês de projeto', MONTHS[r.resource.designMonthIndex] ?? '—');

    heading('3. Dimensionamento (CRESESB, mês crítico)');
    line(
      'Energia do banco por dia',
      `${n(r.sizing.energyRequiredWh)} Wh (ηbat ${n(r.sizing.batteryEfficiency, 2)}, ηinv ${n(r.sizing.inverterEfficiency, 2)})`,
    );
    line(
      'Potência FV de pico',
      `${n(r.sizing.pvPowerWp)} Wp (Red1 ${n(r.sizing.red1, 2)} · Red2 ${n(r.sizing.red2, 2)})`,
    );
    line(
      'Autonomia',
      `${n(r.sizing.autonomyDays, 1)} dia(s); sugerida pelo manual ${n(r.sizing.suggestedAutonomyDays, 2)}`,
    );
    line(
      'Banco',
      `${n(r.sizing.bankWhRequired)} Wh · ${n(r.sizing.bankAhRequired)} Ah a ${r.sizing.systemVoltageV} V (DoD ${n(r.sizing.dodPct)}%)`,
    );
    line(
      'Inversor mínimo',
      `${n(r.sizing.inverterContinuousW)} W contínuos · ${n(r.sizing.inverterSurgeW)} W de surto`,
    );

    heading('4. Equipamentos escolhidos');
    if (r.selected) {
      line('FV', `${n(r.selected.pvPowerWp)} Wp (${r.selected.moduleCount} módulos)`);
      line(
        'Banco',
        `${n(r.selected.bankNominalWh)} Wh nominais · ${n(r.selected.bankUsableWh)} Wh úteis · ${r.selected.batteryCount} baterias`,
      );
      line('Controlador', `${n(r.selected.controllerCurrentA)} A`);
      line(
        'Inversor',
        `${n(r.selected.inverterContinuousW)} W / ${n(r.selected.inverterSurgeW)} W`,
      );
      if (r.selected.generatorW) line('Gerador', `${n(r.selected.generatorW)} W`);
    } else bullet('Seleção incompleta.');
    for (const check of r.checks)
      bullet(
        `${check.severity === 'OK' ? 'OK' : check.severity === 'WARNING' ? 'AVISO' : 'ERRO'} — ${check.message}`,
        check.severity === 'ERROR' ? '#a82020' : check.severity === 'WARNING' ? '#8a5a00' : '#111',
      );

    if (r.simulation) {
      heading('5. Simulação horária');
      line('Geração FV', `${n(r.simulation.pvKwh)} kWh/ano`);
      line('Consumo / atendido', `${n(r.simulation.loadKwh)} / ${n(r.simulation.servedKwh)} kWh`);
      line(
        'Perda de carga',
        `${n(r.simulation.lolpPct, 2)}% das horas; ${n(r.simulation.unmetKwh, 1)} kWh não atendidos`,
      );
      line('Maior falha seguida', `${r.simulation.longestOutageHours} h`);
      line(
        'Banco',
        `SOC mínimo ${n(r.simulation.minSocPct, 1)}%; ${n(r.simulation.batteryCycles, 0)} ciclos/ano; vida ${n(r.simulation.batteryLifeYears, 1)} anos`,
      );
      if (r.simulation.generatorHours > 0)
        line(
          'Gerador',
          `${r.simulation.generatorHours} h; ${n(r.simulation.generatorKwh)} kWh; ${n(r.simulation.fuelLiters, 1)} L`,
        );
      if (r.simulation.gridKwh > 0) line('Rede', `${n(r.simulation.gridKwh)} kWh (sem injeção)`);
      line('Energia desperdiçada', `${n(r.simulation.curtailedKwh)} kWh`);
    }
    if (r.stress) {
      heading('6. Teste de estresse');
      line(
        'Cenário',
        `${r.stress.cloudyDays} dias nublados (${n(r.stress.irradianceFactor * 100)}% do sol), carga +${n(r.stress.loadGrowthPct)}%`,
      );
      line(
        'Resultado',
        r.stress.survives
          ? 'Atende'
          : `Falha: ${n(r.stress.unmetKwh, 2)} kWh sem atender; SOC mínimo ${n(r.stress.minSocPct, 1)}%`,
      );
    }
    if (r.economics) {
      heading('7. Custo');
      line('CAPEX', money(r.economics.capexCents));
      line(
        'OPEX anual',
        `${money(r.economics.annualOpexCents)} + combustível ${money(r.economics.annualFuelCents)} + rede ${money(r.economics.annualGridCents)}`,
      );
      line('Custo nivelado', `${money(r.economics.lcoeCentsPerKwh)}/kWh`);
      for (const item of r.economics.capexItems)
        bullet(
          `${item.description}: ${item.quantity} × ${money(item.unitCostCents)} = ${money(item.totalCents)}`,
        );
    }
    if (r.layout && (r.layout.runs.length > 0 || r.layout.arrays.length > 0)) {
      heading('Terreno e cabos');
      line('Terreno', `${n(design.layout.lotWidthM, 1)} × ${n(design.layout.lotDepthM, 1)} m`);
      for (const a of r.layout.arrays)
        bullet(
          `${a.name}: ${n(a.widthM, 1)} × ${n(a.depthM, 1)} m em (${n(a.centerM.x, 1)}; ${n(a.centerM.y, 1)}), sombra das construções ${n(a.annualShadingLossPct, 1)}% da componente direta`,
        );
      for (const run of r.layout.runs)
        bullet(
          `${run.from} → ${run.to}: ${n(run.distanceM, 1)} m, ${n(run.currentA, 1)} A a ${n(run.voltageV, 0)} V, seção mínima ${n(run.minSectionMm2, 1)} mm², comercial ${run.suggestedSectionMm2 ?? 'acima de 240'} mm² (queda máxima ${n(run.dropLimitPct, 1)}%)`,
        );
      bullet(
        'Estimativa pela queda de tensão (CRESESB 6.33); a capacidade de condução segue a regra de cabos.',
        '#555',
      );
      for (const w of r.layout.warnings) bullet(w, '#8a5a00');
    }
    if (r.scenarios.length > 0) {
      heading('8. Cenários');
      for (const s of r.scenarios)
        bullet(
          `${s.name}: FV ${n(s.pvPowerWp)} Wp, banco ${n(s.bankNominalWh)} Wh, perda de carga ${n(s.lolpPct, 2)}%, CAPEX ${money(s.capexCents)}`,
        );
    }
    if (r.warnings.length > 0) {
      heading('Avisos');
      for (const w of r.warnings) bullet(w, '#8a5a00');
    }
    doc
      .moveDown(1)
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor('#555')
      .text(
        `Algoritmos: ${Object.entries(r.algorithmVersions)
          .map(([k, v]) => `${k} ${v}`)
          .join(' · ')}`,
        { width },
      );
    doc.end();
  });
}
