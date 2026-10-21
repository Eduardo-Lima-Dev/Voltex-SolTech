import { describe, expect, it } from 'vitest';
import { describeElement, ELEMENT_TYPES } from './element-catalog';

describe('descrição de objetos em texto', () => {
  it('reconhece o tipo, as medidas e a cor', () => {
    const r = describeElement('Contêiner azul de 6 x 2,5 x 2,6 m');
    expect(r).toMatchObject({
      kind: 'CONTAINER',
      widthM: 6,
      depthM: 2.5,
      heightM: 2.6,
      recognized: true,
    });
    expect(r.color).toBe('#1976d2');
    expect(r.notes.join(' ')).toContain('Medidas');
  });

  it('a palavra mais específica vence (casa de máquinas × casa)', () => {
    expect(describeElement('casa de máquinas').kind).toBe('POWER_ROOM');
    expect(describeElement('casa de campo').kind).toBe('HOUSE');
    expect(describeElement('caixa d’água de 5 mil litros').kind).toBe('TANK');
  });

  it('altura explícita e comprimento solto', () => {
    expect(describeElement('torre de antena com 20 metros de altura')).toMatchObject({
      kind: 'TOWER',
      heightM: 20,
    });
    expect(describeElement('muro de 15 metros')).toMatchObject({ kind: 'WALL', widthM: 15 });
    expect(describeElement('árvore de 8 metros').heightM).toBe(8);
    expect(describeElement('poço 1,5 por 1,5').widthM).toBe(1.5);
  });

  it('adjetivos de tamanho e cor com mais de uma palavra', () => {
    const big = describeElement('galpão grande');
    expect(big.widthM).toBeCloseTo(ELEMENT_TYPES.SHED.widthM * 1.5, 1);
    expect(describeElement('galpão pequeno').widthM).toBeLessThan(ELEMENT_TYPES.SHED.widthM);
    expect(describeElement('reservatório azul claro').color).toBe('#4fc3f7');
  });

  it('sem tipo reconhecido vira bloco genérico, mantendo medidas e cor', () => {
    const r = describeElement('coisa estranha vermelha 3 x 3');
    expect(r).toMatchObject({ kind: 'OTHER', widthM: 3, depthM: 3, recognized: false });
    expect(r.color).toBe('#d32f2f');
    expect(r.notes[0]).toContain('Não reconheci');
  });

  it('texto vazio ou longo usa o nome padrão do tipo e limita as medidas', () => {
    expect(describeElement('').name).toBe('Outro objeto');
    expect(describeElement('silo ' + 'x'.repeat(60)).name).toBe('Silo');
    expect(describeElement('galpão 900 x 900 x 900').widthM).toBe(200);
  });

  it('cada tipo tem palavras e tamanho', () => {
    for (const [kind, info] of Object.entries(ELEMENT_TYPES)) {
      expect(info.label.length).toBeGreaterThan(2);
      if (kind !== 'OTHER') expect(info.keywords.length).toBeGreaterThan(0);
    }
  });
});
