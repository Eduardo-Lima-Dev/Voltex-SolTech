import { UnsupportedMediaTypeException } from '@nestjs/common';

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const SIGNATURES: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46], // %PDF
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

/** Valida o tipo declarado e, para PDF/PNG/JPEG, confere a assinatura do conteúdo (evita extensão/MIME forjados). */
export function assertAllowedFile(mimeType: string, content: Buffer): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new UnsupportedMediaTypeException(`Tipo de arquivo não permitido: ${mimeType}`);
  }
  const signature = SIGNATURES[mimeType];
  if (signature && !signature.every((byte, i) => content[i] === byte)) {
    throw new UnsupportedMediaTypeException(
      'O conteúdo do arquivo não corresponde ao tipo informado',
    );
  }
}

/** Remove caminho e caracteres de controle; limita o tamanho. Nunca confie no nome enviado pelo cliente. */
export function sanitizeFilename(original: string): string {
  const lastSegment = original.replace(/\\/g, '/').split('/').pop() ?? '';
  const withoutControl = [...lastSegment].filter((char) => {
    const code = char.charCodeAt(0);
    return code > 0x1f && code !== 0x7f;
  });
  const safe = withoutControl.join('').trim().slice(-200);
  return safe.length > 0 ? safe : 'arquivo';
}

/** Parte do nome usada na chave do objeto: só ASCII seguro. */
export function toStorageName(filename: string): string {
  return filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(-80);
}
