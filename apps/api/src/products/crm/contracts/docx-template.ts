import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { MISSING_VALUE, extractTemplateVariables } from '@voltex/shared';

export class DocxTemplateError extends Error {}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const options = {
  delimiters: { start: '{{', end: '}}' },
  paragraphLoop: true,
  linebreaks: true,
} as const;

function open(buffer: Buffer, nullGetter?: (part: { value?: string }) => string): Docxtemplater {
  try {
    return new Docxtemplater(new PizZip(buffer), {
      ...options,
      ...(nullGetter ? { nullGetter } : {}),
    });
  } catch (error) {
    const detail = (
      error as { properties?: { errors?: { properties?: { explanation?: string } }[] } }
    ).properties?.errors
      ?.map((e) => e.properties?.explanation)
      .filter(Boolean)
      .slice(0, 3)
      .join(' ');
    throw new DocxTemplateError(
      `Não foi possível ler o modelo em Word. ${detail ? `Problema encontrado: ${detail}` : 'Confira se o arquivo é um .docx válido e se as variáveis {{assim}} estão completas.'}`,
    );
  }
}

/** Texto do modelo (com as variáveis ainda como `{{...}}`) e as variáveis usadas. */
export function inspectDocx(buffer: Buffer): { text: string; variables: string[] } {
  const text = open(buffer).getFullText();
  return { text, variables: extractTemplateVariables(text) };
}

export interface RenderedDocx {
  buffer: Buffer;
  /** Texto final, para a pré-visualização. */
  text: string;
  missing: string[];
}

/** Preenche o modelo em Word: mantém toda a formatação e troca só as variáveis. */
export function renderDocx(
  template: Buffer,
  values: Record<string, string | null | undefined>,
): RenderedDocx {
  const missing = new Set<string>();
  const doc = open(template, (part) => {
    if (part.value) missing.add(part.value);
    return MISSING_VALUE;
  });
  // As chaves com ponto (`cliente.nome`) são lidas como nome simples pelo modelo: dados planos.
  const data = Object.fromEntries(
    Object.entries(values).map(([k, v]) => {
      if (v === null || v === undefined || v.trim() === '') {
        missing.add(k);
        return [k, MISSING_VALUE];
      }
      return [k, v];
    }),
  );
  try {
    doc.render(data);
  } catch {
    throw new DocxTemplateError(
      'Não foi possível preencher o modelo em Word. Confira as variáveis do modelo.',
    );
  }
  return {
    buffer: doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer,
    text: doc.getFullText(),
    missing: [...missing],
  };
}
