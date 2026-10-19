/**
 * Confere se o armazenamento de arquivos (S3 ou compatível, como o do Supabase) funciona com a configuração atual,
 * usando exatamente as operações que a API usa: verificar o bucket, gravar, ler, gerar o link de download com o nome
 * do arquivo, baixar por esse link e apagar. Não deixa nada para trás.
 *
 *   S3_ENDPOINT=... S3_REGION=... S3_BUCKET=... S3_ACCESS_KEY=... S3_SECRET_KEY=... \
 *     node dist/cli/check-storage.js
 *
 * (as demais variáveis obrigatórias da API são preenchidas com valores de teste se faltarem).
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { envSchema } from '../config/env';

type Result = { name: string; ok: boolean; detail?: string };

async function main(): Promise<void> {
  const parsed = envSchema.safeParse({
    DATABASE_URL: 'postgresql://nao-usado',
    JWT_SECRET: 'x'.repeat(40),
    JWT_REFRESH_SECRET: 'y'.repeat(40),
    ...process.env,
  });
  if (!parsed.success) {
    console.error('Configuração inválida:', parsed.error.issues.map((i) => i.message).join('; '));
    process.exit(2);
  }
  const env = parsed.data;
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  const Bucket = env.S3_BUCKET;
  const Key = `__verificacao/${Date.now()}.txt`;
  const body = `Voltex SolTech: teste de armazenamento ${new Date().toISOString()}`;
  const results: Result[] = [];
  const step = async (name: string, run: () => Promise<string | void>) => {
    try {
      results.push({ name, ok: true, detail: (await run()) || undefined });
    } catch (error) {
      results.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await step('Verificar o bucket (HeadBucket)', async () => {
    await client.send(new HeadBucketCommand({ Bucket }));
  });
  await step('Gravar um arquivo (PutObject)', async () => {
    await client.send(
      new PutObjectCommand({ Bucket, Key, Body: Buffer.from(body), ContentType: 'text/plain' }),
    );
  });
  await step('Ler o arquivo (GetObject)', async () => {
    const out = await client.send(new GetObjectCommand({ Bucket, Key }));
    const text = Buffer.from((await out.Body?.transformToByteArray()) ?? []).toString();
    if (text !== body) throw new Error('o conteúdo lido é diferente do gravado');
  });
  await step('Link temporário de download, com o nome do arquivo', async () => {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket,
        Key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent('proposta com acento.txt')}`,
      }),
      { expiresIn: 60 },
    );
    const res = await fetch(url);
    if (!res.ok) throw new Error(`o link respondeu ${res.status}`);
    if ((await res.text()) !== body) throw new Error('o link devolveu outro conteúdo');
    const disposition = res.headers.get('content-disposition') ?? '';
    // Não é erro grave: o arquivo baixa, mas com outro nome.
    return /proposta/.test(decodeURIComponent(disposition))
      ? 'nome do arquivo respeitado'
      : `ATENÇÃO: o armazenamento ignorou o nome do arquivo (cabeçalho: "${disposition || 'vazio'}")`;
  });
  await step('Apagar o arquivo (DeleteObject)', async () => {
    await client.send(new DeleteObjectCommand({ Bucket, Key }));
  });

  console.log(`Armazenamento: ${env.S3_ENDPOINT} (bucket ${Bucket})`);
  for (const r of results)
    console.log(`${r.ok ? 'OK    ' : 'FALHOU'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

void main();
