import { describe, expect, it } from 'vitest';
import { INSTALLATION_STATUSES } from '@voltex/shared';
import {
  INSTALLATION_STATUS_LABEL,
  INSTALLATION_TRANSITIONS,
  canTransition,
  isFinal,
  requiresReason,
} from './installation-transitions';

describe('máquina de estados da instalação', () => {
  it('cobre todos os estados, com rótulo e só destinos válidos', () => {
    for (const status of INSTALLATION_STATUSES) {
      expect(INSTALLATION_TRANSITIONS[status]).toBeDefined();
      expect(INSTALLATION_STATUS_LABEL[status]).toBeTruthy();
      for (const target of INSTALLATION_TRANSITIONS[status])
        expect(INSTALLATION_STATUSES).toContain(target);
    }
  });

  it('segue o diagrama: o caminho feliz passa pelos 11 estados em ordem', () => {
    const path = [
      'AWAITING_ENGINEERING',
      'AWAITING_MATERIAL',
      'MATERIAL_READY',
      'SCHEDULING',
      'CREW_ASSIGNED',
      'IN_PROGRESS',
      'INSTALLED',
      'COMMISSIONING',
      'CUSTOMER_ACCEPTANCE',
      'DONE',
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1)
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });

  it('pendência de campo vai e volta de "em instalação", e reprovação no ensaio volta a instalar', () => {
    expect(canTransition('IN_PROGRESS', 'FIELD_ISSUE')).toBe(true);
    expect(canTransition('FIELD_ISSUE', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('COMMISSIONING', 'IN_PROGRESS')).toBe(true);
  });

  it('não pula etapas nem sai de estado final', () => {
    expect(canTransition('AWAITING_ENGINEERING', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('MATERIAL_READY', 'INSTALLED')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'DONE')).toBe(false);
    expect(isFinal('DONE')).toBe(true);
    expect(isFinal('CANCELLED')).toBe(true);
    expect(canTransition('DONE', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('CANCELLED', 'AWAITING_MATERIAL')).toBe(false);
    expect(isFinal('IN_PROGRESS')).toBe(false);
  });

  it('exige motivo para voltar uma etapa e para cancelar, não para avançar', () => {
    expect(requiresReason('CREW_ASSIGNED', 'SCHEDULING')).toBe(true);
    expect(requiresReason('COMMISSIONING', 'IN_PROGRESS')).toBe(true);
    expect(requiresReason('INSTALLED', 'IN_PROGRESS')).toBe(true);
    expect(requiresReason('CUSTOMER_ACCEPTANCE', 'COMMISSIONING')).toBe(true);
    expect(requiresReason('IN_PROGRESS', 'CANCELLED')).toBe(true);
    expect(requiresReason('AWAITING_MATERIAL', 'MATERIAL_READY')).toBe(false);
    expect(requiresReason('FIELD_ISSUE', 'IN_PROGRESS')).toBe(false);
    expect(requiresReason('CUSTOMER_ACCEPTANCE', 'DONE')).toBe(false);
  });
});
