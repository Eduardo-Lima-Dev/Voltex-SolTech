#!/usr/bin/env node
/**
 * Cria (ou atualiza) o serviço da API na Render a partir da imagem do registro privado do GitHub, pela API da Render.
 * Lê os segredos de ~/.voltex-deploy (veja scripts/guardar-segredo.sh) e NUNCA os imprime.
 *
 *   node scripts/render-api.mjs <imagem> <endereco-publico-da-aplicacao> [regiao]
 *   ex.: node scripts/render-api.mjs ghcr.io/eduardo-lima-dev/voltex-api:latest https://voltex-app.vercel.app virginia
 *
 * Se o serviço `voltex-api` já existir, só atualiza as variáveis e dispara uma nova publicação.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const dir = `${homedir()}/.voltex-deploy/`;
const lerSegredo = (nome) => readFileSync(dir + nome, 'utf8').trim();
const [imagem, webUrl, regiao = 'virginia'] = process.argv.slice(2);
if (!imagem || !webUrl) {
  console.error('Uso: node scripts/render-api.mjs <imagem> <endereco-da-aplicacao> [regiao]');
  process.exit(1);
}
const NOME = 'voltex-api';
const chave = lerSegredo('render');

async function chamar(metodo, caminho, corpo) {
  const res = await fetch(`https://api.render.com/v1${caminho}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${chave}`,
      accept: 'application/json',
      ...(corpo ? { 'content-type': 'application/json' } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await res.text();
  let json;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  if (!res.ok) {
    const msg = typeof json === 'object' ? JSON.stringify(json) : String(json);
    throw new Error(`${metodo} ${caminho} → ${res.status} ${msg.slice(0, 400)}`);
  }
  return json;
}

const variaveis = [
  ['NODE_ENV', 'production'],
  ['TRUST_PROXY', '2'],
  ['AUTOMATION_SCAN_INTERVAL_MS', '900000'],
  ['WEB_URL', webUrl],
  ['CORS_ORIGIN', webUrl],
  ['DATABASE_URL', lerSegredo('supabase-db-url')],
  ['REDIS_URL', lerSegredo('upstash-redis-url')],
  ['JWT_SECRET', lerSegredo('jwt-secret')],
  ['JWT_REFRESH_SECRET', lerSegredo('jwt-refresh-secret')],
  ['DATA_ENCRYPTION_KEY', lerSegredo('data-encryption-key')],
  ['S3_ENDPOINT', 'https://apqgevozeutjhpodoshy.storage.supabase.co/storage/v1/s3'],
  ['S3_REGION', 'sa-east-1'],
  ['S3_BUCKET', 'voltex-documents'],
  ['S3_ACCESS_KEY', lerSegredo('supabase-s3-access-key')],
  ['S3_SECRET_KEY', lerSegredo('supabase-s3-secret-key')],
  ['S3_FORCE_PATH_STYLE', 'true'],
  ['S3_SERVER_SIDE_ENCRYPTION', 'none'],
].map(([key, value]) => ({ key, value }));

const donos = await chamar('GET', '/owners?limit=5');
const ownerId = donos[0].owner.id;

const existentes = await chamar('GET', '/services?limit=100');
const atual = existentes.map((s) => s.service).find((s) => s.name === NOME);

if (atual) {
  await chamar('PUT', `/services/${atual.id}/env-vars`, variaveis);
  await chamar('POST', `/services/${atual.id}/deploys`, {});
  console.log(`Serviço ${NOME} já existia: variáveis atualizadas e nova publicação pedida.`);
  console.log(`Endereço: ${atual.serviceDetails?.url ?? '(veja no painel)'}`);
} else {
  const credenciais = await chamar('GET', '/registrycredentials');
  let credencial = credenciais.find((c) => c.name === 'ghcr-voltex');
  if (!credencial) {
    credencial = await chamar('POST', '/registrycredentials', {
      ownerId,
      name: 'ghcr-voltex',
      registry: 'GITHUB',
      username: 'Eduardo-Lima-Dev',
      authToken: lerSegredo('ghcr-leitura'),
    });
    console.log('Credencial do registro criada na Render.');
  }
  const criado = await chamar('POST', '/services', {
    type: 'web_service',
    name: NOME,
    ownerId,
    image: { ownerId, imagePath: imagem, registryCredentialId: credencial.id },
    autoDeploy: 'no',
    envVars: variaveis,
    serviceDetails: {
      runtime: 'image',
      plan: 'free',
      region: regiao,
      healthCheckPath: '/api/v1/health/live',
      numInstances: 1,
    },
  });
  const servico = criado.service ?? criado;
  console.log(`Serviço criado: ${servico.name} (${servico.id})`);
  console.log(`Endereço: ${servico.serviceDetails?.url ?? '(veja no painel)'}`);
  console.log(`Painel: ${servico.dashboardUrl ?? 'https://dashboard.render.com'}`);
}
