#!/usr/bin/env node
/**
 * Pede à Render uma nova publicação do serviço da API com uma imagem específica e ESPERA ela ficar no ar.
 * Usado pelo GitHub Actions (.github/workflows/deploy-demo.yml) e também à mão.
 *
 *   RENDER_API_KEY=... RENDER_SERVICE_ID=srv-... node scripts/render-deploy.mjs ghcr.io/dono/voltex-api:ETIQUETA
 *
 * Também define, antes de publicar, `DATA_HUB_ENABLED_SOURCES` (fontes externas ligadas) quando informada no ambiente.
 *
 * Fora do Actions, a chave vem de ~/.voltex-deploy/render e o serviço é o `voltex-api`.
 * Sai com código 1 se a publicação falhar ou se a API não responder depois dela.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const imagem = process.argv[2];
if (!imagem) {
  console.error('Uso: node scripts/render-deploy.mjs <imagem:etiqueta>');
  process.exit(1);
}
const arquivoChave = `${homedir()}/.voltex-deploy/render`;
const chave =
  process.env.RENDER_API_KEY ??
  (existsSync(arquivoChave) ? readFileSync(arquivoChave, 'utf8').trim() : '');
if (!chave) {
  console.error('Defina RENDER_API_KEY (ou guarde a chave com scripts/guardar-segredo.sh render).');
  process.exit(1);
}

// Endereço da API da Render (configurável só para testar o script contra um servidor falso).
const BASE = process.env.RENDER_API_URL ?? 'https://api.render.com/v1';

async function chamar(metodo, caminho, corpo) {
  const res = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${chave}`,
      accept: 'application/json',
      ...(corpo ? { 'content-type': 'application/json' } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`${metodo} ${caminho} → ${res.status} ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

let servicoId = process.env.RENDER_SERVICE_ID;
let urlServico = process.env.API_URL;
if (!servicoId) {
  const servicos = await chamar('GET', '/services?limit=100');
  const achado = servicos.map((s) => s.service).find((s) => s.name === 'voltex-api');
  if (!achado) throw new Error('Serviço voltex-api não encontrado na Render.');
  servicoId = achado.id;
  urlServico ??= achado.serviceDetails?.url;
}

// Variáveis NÃO secretas que a publicação mantém a cada deploy. Uma a uma (PUT por chave): a Render troca só o valor
// desta chave e preserva as demais. Sem isso a fonte ficaria desligada (o padrão da API é vazio = nada é buscado).
// Valor vazio ou ausente = não mexe.
for (const chaveVar of ['DATA_HUB_ENABLED_SOURCES']) {
  const valor = process.env[chaveVar]?.trim();
  if (!valor) continue;
  try {
    await chamar('PUT', `/services/${servicoId}/env-vars/${chaveVar}`, { value: valor });
    console.log(`Variável ${chaveVar} definida: ${valor}`);
  } catch (erro) {
    // Não impede a publicação: a variável fica como estava e o aviso aparece no log do Actions.
    console.warn(`::warning::Não foi possível definir ${chaveVar} na Render: ${erro.message}`);
  }
}

const pedido = await chamar('POST', `/services/${servicoId}/deploys`, { imageUrl: imagem });
const deployId = pedido.id ?? pedido.deploy?.id;
console.log(`Publicação ${deployId} pedida com a imagem ${imagem}.`);

const ATIVOS = new Set([
  'created',
  'queued',
  'build_in_progress',
  'update_in_progress',
  'pre_deploy_in_progress',
]);
const limite = Date.now() + 15 * 60_000;
let estado = 'created';
while (ATIVOS.has(estado) && Date.now() < limite) {
  await new Promise((r) => setTimeout(r, 10_000));
  const d = await chamar('GET', `/services/${servicoId}/deploys/${deployId}`);
  estado = d.status;
  console.log(`  estado: ${estado}`);
}
if (estado !== 'live') {
  console.error(`A publicação terminou como "${estado}" (esperado: live).`);
  process.exit(1);
}

if (urlServico) {
  for (let i = 0; i < 12; i++) {
    try {
      const r = await fetch(`${urlServico}/api/v1/health/live`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) {
        console.log(`API respondendo em ${urlServico}.`);
        process.exit(0);
      }
    } catch {
      // ainda acordando
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  console.error(`A API não respondeu em ${urlServico} depois da publicação.`);
  process.exit(1);
}
console.log('Publicação concluída (sem endereço para verificar a saúde).');
