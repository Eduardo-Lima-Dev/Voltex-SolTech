import { describe, it, expect, beforeAll } from 'vitest';
import { MONITORING_FIXTURES } from './fixtures/monitoring-fixtures';

describe('Monitoring Fixtures — 17 Adaptadores (e2e)', () => {
  const providers = Object.keys(MONITORING_FIXTURES) as (keyof typeof MONITORING_FIXTURES)[];

  describe.each(providers)('%s', (provider) => {
    const fixture = MONITORING_FIXTURES[provider];

    it('tem plantas registradas', () => {
      expect(fixture.plants).toBeDefined();
      expect(fixture.plants.length).toBeGreaterThan(0);
      expect(fixture.plants[0].id).toBeDefined();
      expect(fixture.plants[0].name).toBeDefined();
    });

    it('tem dados diários (energia)', () => {
      expect(fixture.daily).toBeDefined();
      expect(fixture.daily.energy).toBeGreaterThan(0);
      expect(fixture.daily.unit).toBe('kWh');
      expect(fixture.daily.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('tem snapshot (potência instantânea)', () => {
      expect(fixture.snapshot).toBeDefined();
      expect(fixture.snapshot.powerNow).toBeGreaterThan(0);
      expect(fixture.snapshot.unit).toBe('W');
      expect(fixture.snapshot.timestamp).toBeDefined();
    });

    it('tem array de alarmes', () => {
      expect(fixture.alarms).toBeDefined();
      expect(Array.isArray(fixture.alarms)).toBe(true);
    });

    it('formatos estão consistentes', () => {
      // Energia não pode ser maior que potência peak
      const peakPower = fixture.plants[0].power || 10000;
      const maxDailyEnergy = (peakPower / 1000) * 24; // horas de pico teórico
      expect(fixture.daily.energy).toBeLessThanOrEqual(maxDailyEnergy * 1.5);

      // Potência instantânea não pode exceder pico
      expect(fixture.snapshot.powerNow).toBeLessThanOrEqual(peakPower);
    });
  });

  it('todos os 17 provedores têm fixtures', () => {
    expect(providers.length).toBe(17);
    expect(providers).toContain('sma');
    expect(providers).toContain('solaredge');
    expect(providers).toContain('fronius');
    expect(providers).toContain('huawei');
    expect(providers).toContain('growatt');
    expect(providers).toContain('sungrow');
    expect(providers).toContain('deye');
    expect(providers).toContain('solarman');
    expect(providers).toContain('solis');
    expect(providers).toContain('goodwe');
    expect(providers).toContain('apsystems');
    expect(providers).toContain('enphase');
    expect(providers).toContain('growattPortal');
    expect(providers).toContain('goodweSems');
    expect(providers).toContain('hoymiles');
    expect(providers).toContain('solarmanPortal');
    expect(providers).toContain('huaweiKiosk');
  });
});
