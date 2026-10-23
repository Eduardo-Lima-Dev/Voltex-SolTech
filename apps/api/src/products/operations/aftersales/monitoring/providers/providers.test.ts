import { describe, expect, it } from 'vitest';
import type { AdapterContext } from '../../../../../platform/integrations/integration-adapter';
import type {
  IntegrationHttp,
  IntegrationRequest,
} from '../../../../../platform/integrations/integration-http';
import { apsystems, apsystemsHeaders } from './apsystems';
import { fronius, parseFroniusValues } from './fronius';
import { MONITORING_PROVIDERS } from './index';
import { solaredge } from './solaredge';

/** Respostas gravadas de exemplo (contrato público; não validadas com conta real). */
function ctx(
  credentials: Record<string, string>,
  route: (req: IntegrationRequest) => { status?: number; json: unknown },
  seen: IntegrationRequest[] = [],
): AdapterContext {
  const http: IntegrationHttp = {
    request: (req) => {
      seen.push(req);
      const res = route(req);
      return Promise.resolve({ status: res.status ?? 200, headers: {}, text: '', json: res.json });
    },
  };
  return { tenantId: 't', connectionId: 'c', credentials, config: {}, http };
}

describe('catálogo', () => {
  it('17 provedores; só SolarEdge, APsystems e Fronius têm adaptador', () => {
    expect(MONITORING_PROVIDERS).toHaveLength(17);
    expect(
      MONITORING_PROVIDERS.filter((p) => p.implemented)
        .map((p) => p.key)
        .sort(),
    ).toEqual(['apsystems', 'fronius', 'solaredge']);
    expect(new Set(MONITORING_PROVIDERS.map((p) => p.key)).size).toBe(17);
    expect(MONITORING_PROVIDERS.filter((p) => !p.official)).toHaveLength(5);
  });

  it('provedor pendente não consulta nada e explica o motivo', async () => {
    const pending = MONITORING_PROVIDERS.find((p) => p.key === 'goodwe')!;
    const result = await pending.test(ctx({}, () => ({ json: null })));
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/não implementado/);
    await expect(
      pending.readDaily(
        ctx({}, () => ({ json: null })),
        'x',
        '2026-10-01',
        '2026-10-02',
      ),
    ).rejects.toThrow();
  });
});

describe('SolarEdge', () => {
  const route = (req: IntegrationRequest) => {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/energy'))
      return {
        json: {
          energy: {
            unit: 'Wh',
            values: [
              { date: '2026-10-20 00:00:00', value: 18_250 },
              { date: '2026-10-21 00:00:00', value: null },
              { date: '2026-10-22 00:00:00', value: 0 },
            ],
          },
        },
      };
    return { json: {} };
  };

  it('converte Wh em kWh, ignora dia sem valor e envia datas e chave na consulta', async () => {
    const seen: IntegrationRequest[] = [];
    const out = await solaredge.readDaily(
      ctx({ apiKey: 'k1' }, route, seen),
      '4711',
      '2026-10-20',
      '2026-10-22',
    );
    expect(out).toEqual([
      { date: '2026-10-20', kwh: 18.25 },
      { date: '2026-10-22', kwh: 0 },
    ]);
    expect(seen[0]?.url).toContain(
      '/site/4711/energy?timeUnit=DAY&startDate=2026-10-20&endDate=2026-10-22&api_key=k1',
    );
  });

  it('recusa unidade desconhecida em vez de gravar número errado', async () => {
    const bad = () => ({
      json: { energy: { unit: 'MWh', values: [{ date: '2026-10-20 00:00:00', value: 1 }] } },
    });
    await expect(
      solaredge.readDaily(ctx({ apiKey: 'k1' }, bad), '1', '2026-10-20', '2026-10-20'),
    ).rejects.toThrow(/unidade/);
  });

  it('403 vira "credenciais recusadas"', async () => {
    await expect(
      solaredge.test(ctx({ apiKey: 'k1' }, () => ({ status: 403, json: null }))),
    ).rejects.toThrow(/credenciais recusadas/);
  });
});

describe('APsystems', () => {
  it('assina só com o último segmento do caminho e muda com o nonce', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    const a = apsystemsHeaders(
      'APPID123456',
      'secret12',
      '/user/api/v2/systems/details/SID1',
      now,
      'n'.repeat(32),
    );
    const b = apsystemsHeaders(
      'APPID123456',
      'secret12',
      '/outro/caminho/SID1',
      now,
      'n'.repeat(32),
    );
    const c = apsystemsHeaders(
      'APPID123456',
      'secret12',
      '/user/api/v2/systems/details/SID1',
      now,
      'm'.repeat(32),
    );
    expect(a['X-CA-Signature']).toBe(b['X-CA-Signature']);
    expect(a['X-CA-Signature']).not.toBe(c['X-CA-Signature']);
    expect(a).toMatchObject({
      'X-CA-AppId': 'APPID123456',
      'X-CA-Signature-Method': 'HmacSHA256',
      'X-CA-Timestamp': String(now.getTime()),
    });
  });

  it('lê a energia do mês: a posição na lista é o dia', async () => {
    const route = () => ({ json: { code: 0, data: ['10.5', '0', 'x', '12'] } });
    const out = await apsystems.readDaily(
      ctx({ appId: 'APPID123456', appSecret: 'secret12' }, route),
      'SID1',
      '2026-10-02',
      '2026-10-04',
    );
    expect(out).toEqual([
      { date: '2026-10-02', kwh: 0 },
      { date: '2026-10-04', kwh: 12 },
    ]);
    const wide = await apsystems.readDaily(
      ctx({ appId: 'APPID123456', appSecret: 'secret12' }, route),
      'SID1',
      '2026-10-01',
      '2026-10-31',
    );
    expect(wide).toEqual([
      { date: '2026-10-01', kwh: 10.5 },
      { date: '2026-10-02', kwh: 0 },
      { date: '2026-10-04', kwh: 12 },
    ]);
  });

  it('código de erro no corpo (HTTP 200) é erro', async () => {
    const route = () => ({ json: { code: 4000, data: null } });
    await expect(
      apsystems.readDaily(
        ctx({ appId: 'APPID123456', appSecret: 'secret12' }, route),
        'SID1',
        '2026-10-01',
        '2026-10-02',
      ),
    ).rejects.toThrow(/4000/);
  });

  it('o teste exige um ID de usina, porque a API não lista usinas', async () => {
    const result = await apsystems.test(
      ctx({ appId: 'APPID123456', appSecret: 'secret12' }, () => ({ json: null })),
    );
    expect(result.ok).toBe(false);
    expect(apsystems.listPlants).toBeUndefined();
  });

  it('status da usina pela cor (light)', async () => {
    const mk = (light: number) => () => ({ json: { code: 0, data: { light } } });
    const read = (light: number) =>
      apsystems.readNow!(ctx({ appId: 'APPID123456', appSecret: 'secret12' }, mk(light)), 'SID1');
    expect(await read(1)).toMatchObject({ status: 'ONLINE' });
    expect(await read(2)).toMatchObject({ status: 'ALARM' });
    expect(await read(3)).toMatchObject({ status: 'OFFLINE' });
    expect(await read(4)).toMatchObject({ status: 'UNKNOWN' });
  });
});

describe('Fronius Solar.web', () => {
  it('aceita o mapa de dias, a lista e datas ISO; recusa outra forma', () => {
    expect(parseFroniusValues({ '1': 1000, '2': '2500' }, '2026-10')).toEqual([
      { date: '2026-10-01', value: 1000 },
      { date: '2026-10-02', value: 2500 },
    ]);
    expect(parseFroniusValues([10, 20], '2026-10')).toEqual([
      { date: '2026-10-01', value: 10 },
      { date: '2026-10-02', value: 20 },
    ]);
    expect(parseFroniusValues({ '2026-10-05T00:00:00Z': 7 }, '2026-10')).toEqual([
      { date: '2026-10-05', value: 7 },
    ]);
    expect(() => parseFroniusValues('texto', '2026-10')).toThrow(/inesperado/);
  });

  it('lê o mês pelo caminho do swagger, com os cabeçalhos da chave, e converte Wh em kWh', async () => {
    const seen: IntegrationRequest[] = [];
    const route = () => ({
      json: {
        data: {
          channels: [
            {
              channelName: 'EnergyProductionTotal',
              unit: 'Wh',
              values: { '1': 40_783.84, '2': 1000 },
            },
          ],
        },
      },
    });
    const out = await fronius.readDaily(
      ctx({ accessKeyId: 'KEYID1234', accessKeyValue: 'KEYVALUE1' }, route, seen),
      'abc-uuid',
      '2026-10-01',
      '2026-10-01',
    );
    expect(out).toEqual([{ date: '2026-10-01', kwh: 40.78384 }]);
    expect(seen[0]?.url).toBe(
      'https://api.solarweb.com/swqapi/pvsystems/abc-uuid/AggData/years/2026/months/10/days?Channel=EnergyProductionTotal',
    );
    expect(seen[0]?.headers).toEqual({ AccessKeyId: 'KEYID1234', AccessKeyValue: 'KEYVALUE1' });
  });

  it('lista as usinas e informa se está online', async () => {
    const list = await fronius.listPlants!(
      ctx({ accessKeyId: 'KEYID1234', accessKeyValue: 'KEYVALUE1' }, () => ({
        json: { pvSystems: [{ pvSystemId: 'u-1', name: 'Sítio' }] },
      })),
    );
    expect(list).toEqual([{ id: 'u-1', name: 'Sítio' }]);
    const now = await fronius.readNow!(
      ctx({ accessKeyId: 'KEYID1234', accessKeyValue: 'KEYVALUE1' }, () => ({
        json: {
          status: { isOnline: true },
          data: { channels: [{ channelName: 'PowerPV', value: 4200 }] },
        },
      })),
      'u-1',
    );
    expect(now).toEqual({ powerKw: 4.2, status: 'ONLINE' });
  });
});
