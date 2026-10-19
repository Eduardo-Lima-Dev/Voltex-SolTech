import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  bearer,
  createTestApp,
  seedTenant,
  tokenFor,
  type SeededTenant,
  type TestApp,
} from './helpers';

describe('Métricas Prometheus (e2e)', () => {
  let t: TestApp;
  let a: SeededTenant;
  let owner: string;
  const scrape = (token?: string) => {
    const req = t.http.get(`${API}/metrics`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await seedTenant(t.prisma, 'metrics');
    owner = await tokenFor(t.http, a.owner);
  });
  afterAll(() => t.close());

  it('exige o token: sem ele ou com token errado é 401', async () => {
    expect((await scrape()).status).toBe(401);
    expect((await scrape('token-errado-token-errado')).status).toBe(401);
    expect((await t.http.get(`${API}/metrics`).set(bearer(owner))).status).toBe(401);
  });

  it('com o token devolve o formato Prometheus: processo, HTTP por rota e fila de eventos', async () => {
    await t.http.get(`${API}/tenant`).set(bearer(owner));
    const res = await scrape('e2e-metrics-token-0123456789');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('voltex_process_cpu_user_seconds_total');
    expect(res.text).toMatch(
      /voltex_http_requests_total\{method="GET",route="\/api\/v1\/tenant",status="200"\} \d+/,
    );
    expect(res.text).toContain('voltex_http_request_duration_seconds_bucket');
    expect(res.text).toMatch(/voltex_outbox_pending_events \d+/);
    expect(res.text).toMatch(/voltex_outbox_failed_events \d+/);
  });

  it('não expõe dados de clientes nem usa URLs reais como rótulo', async () => {
    await t.http
      .get(`${API}/opportunities/0192b0c0-0000-7000-8000-00000000dead`)
      .set(bearer(owner));
    const text = (await scrape('e2e-metrics-token-0123456789')).text;
    expect(text).not.toContain('0192b0c0-0000-7000-8000-00000000dead');
    expect(text).toContain('route="/api/v1/opportunities/:id"');
  });
});
