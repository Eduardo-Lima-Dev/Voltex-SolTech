import { UnprocessableEntityException } from '@nestjs/common';
import type { AdapterContext } from '../../../../../platform/integrations/integration-adapter';
import type { IntegrationRequest } from '../../../../../platform/integrations/integration-http';

/** GET/POST JSON com erros em português. 401/403 = credencial recusada; 404 = usina inexistente. */
export async function requestJson(
  ctx: AdapterContext,
  provider: string,
  input: IntegrationRequest,
): Promise<unknown> {
  const response = await ctx.http.request(input);
  if (response.status === 401 || response.status === 403)
    throw new UnprocessableEntityException(
      `${provider}: credenciais recusadas ou sem permissão (HTTP ${response.status})`,
    );
  if (response.status === 404)
    throw new UnprocessableEntityException(`${provider}: usina ou recurso não encontrado`);
  if (response.status < 200 || response.status >= 300)
    throw new UnprocessableEntityException(
      `${provider}: resposta inesperada (HTTP ${response.status})`,
    );
  if (response.json === null)
    throw new UnprocessableEntityException(`${provider}: a resposta não é JSON`);
  return response.json;
}

/** Meses (`AAAA-MM`) que o intervalo `from`..`to` toca, em ordem. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export const inRange = (date: string, from: string, to: string): boolean =>
  date >= from && date <= to;
