import { BadRequestException, Injectable } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import {
  SPEC_SCHEMAS,
  importCommitSchema,
  type CreateEquipmentData,
  type EquipmentDto,
  type EquipmentKind,
  type EquipmentOrigin,
  type ImportCandidateDto,
  type ImportCommitInput,
  type ImportFormat,
  type ImportPreviewDto,
  type SpecIssue,
} from '@voltex/shared';
import {
  ImportParseError,
  equipmentCsvTemplate,
  buildLayoutLines,
  extractInverterDatasheet,
  extractModuleDatasheet,
  extractOffgridDatasheet,
  extractProtectionDatasheet,
  isProtectionKind,
  isOffgridKind,
  type PdfTextItem,
  parseEquipmentCsv,
  decodePvsystBytes,
  parsePvsystFile,
  validateSpec,
  type ParsedEquipment,
} from '@voltex/solar-engine';
import { extractText, getDocumentProxy } from 'unpdf';
import { PrismaService } from '../prisma/prisma.service';
import type { UploadedFile } from '../documents/documents.service';
import { CatalogService } from './catalog.service';

const ORIGIN: Record<ImportFormat, EquipmentOrigin> = {
  csv: 'CSV',
  pan: 'PAN',
  ond: 'OND',
  'datasheet-pdf': 'DATASHEET_PDF',
};

/** Um arquivo, uma prévia, uma gravação: nada entra no catálogo sem a pessoa conferir e confirmar. */
@Injectable()
export class CatalogImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  template(kind: EquipmentKind): string {
    return equipmentCsvTemplate(kind);
  }

  async preview(
    file: UploadedFile | undefined,
    format: ImportFormat,
    kind: EquipmentKind | undefined,
    modelHint = '',
  ): Promise<ImportPreviewDto> {
    if (!file) throw new BadRequestException('Envie o arquivo no campo "file"');
    if (file.size === 0) throw new BadRequestException('Arquivo vazio');
    const errors: ImportPreviewDto['errors'] = [];
    const notes: string[] = [];
    let parsed: ParsedEquipment[] = [];

    try {
      if (format === 'csv') {
        if (!kind)
          throw new BadRequestException('Informe o tipo de equipamento da planilha (kind)');
        const result = parseEquipmentCsv(kind, file.buffer.toString('utf8'));
        parsed = result.items;
        errors.push(...result.errors);
        if (result.ignoredColumns.length)
          notes.push(
            `Colunas ignoradas (o modelo não as conhece): ${result.ignoredColumns.join(', ')}.`,
          );
      } else if (format === 'pan' || format === 'ond') {
        const item = parsePvsystFile(decodePvsystBytes(file.buffer));
        const expected = format === 'pan' ? 'MODULE' : 'INVERTER';
        if (item.kind !== expected)
          throw new ImportParseError(
            `O arquivo é de ${item.kind === 'MODULE' ? 'módulo (.PAN)' : 'inversor (.OND)'}, mas foi enviado como .${format.toUpperCase()}.`,
          );
        parsed = [item];
      } else {
        let text: string;
        const pages: PdfTextItem[][] = [];
        try {
          const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
          text = (await extractText(pdf, { mergePages: true })).text;
          // Posição de cada pedaço de texto: fichas de inversor têm uma coluna por modelo.
          for (let n = 1; n <= pdf.numPages; n++) {
            const content = await (await pdf.getPage(n)).getTextContent();
            pages.push(
              content.items.flatMap((item) =>
                'str' in item
                  ? [
                      {
                        text: item.str,
                        x: item.transform[4],
                        y: item.transform[5],
                        width: item.width,
                      },
                    ]
                  : [],
              ),
            );
          }
        } catch {
          throw new ImportParseError('Não foi possível ler o PDF (corrompido ou protegido).');
        }
        if (text.trim().length < 20)
          throw new ImportParseError(
            'O PDF não tem texto legível (provavelmente é uma imagem escaneada). Preencha à mão.',
          );
        if (isOffgridKind(kind)) {
          // Bateria, controlador, inversor off-grid e gerador: leitor por rótulos e título.
          parsed = [extractOffgridDatasheet(kind, text, modelHint)];
        } else if (isProtectionKind(kind)) {
          // Disjuntor, DPS, fusível, seccionadora, DR, string box e cabos.
          parsed = [extractProtectionDatasheet(kind, text, modelHint)];
        } else {
          // Sem tipo informado, tenta como ficha de inversor (tabela com colunas por modelo) e depois como módulo.
          const inverters =
            kind === 'MODULE'
              ? []
              : pages
                  .flatMap((items) =>
                    extractInverterDatasheet(buildLayoutLines(items), text, modelHint),
                  )
                  .filter((item) => Object.keys(item.spec).length >= 8);
          if (inverters.length > 0) {
            parsed = inverters;
            notes.push(
              `Ficha de inversor com ${inverters.length} modelo(s): confira cada coluna contra o PDF antes de importar.`,
            );
          } else if (kind === 'INVERTER')
            throw new ImportParseError(
              'Não reconheci a tabela de especificações de inversor neste PDF (o layout é diferente dos que o sistema conhece). Preencha à mão ou envie o arquivo .OND.',
            );
          else parsed = [extractModuleDatasheet(text)];
        }
      }
    } catch (error) {
      if (error instanceof ImportParseError) errors.push({ message: error.message });
      else throw error;
    }

    const candidates: ImportCandidateDto[] = [];
    for (const item of parsed) {
      const exists =
        item.manufacturer && item.model
          ? (await this.prisma.db.equipmentItem.count({
              where: { kind: item.kind, manufacturer: item.manufacturer, model: item.model },
            })) > 0
          : false;
      const issues = this.issuesFor(item);
      candidates.push({
        kind: item.kind,
        manufacturer: item.manufacturer,
        model: item.model,
        spec: item.spec,
        origin: ORIGIN[format],
        fieldConfidence: item.fieldConfidence,
        ...(item.referenceCostCents !== undefined
          ? { referenceCostCents: item.referenceCostCents }
          : {}),
        issues,
        exists,
        missing: item.missing,
      });
      notes.push(...item.notes.filter((n) => !notes.includes(n)));
    }
    return { format, candidates, errors, notes };
  }

  /** Só valida a coerência física quando a ficha está completa; faltando campo, o que falta já é o aviso. */
  private issuesFor(item: ParsedEquipment): SpecIssue[] {
    if (item.missing.length > 0) return [];
    const schema = SPEC_SCHEMAS[item.kind].safeParse(item.spec);
    if (!schema.success)
      return schema.error.issues.map((i) => ({
        code: 'SPEC_FORMAT',
        severity: 'ERROR' as const,
        field: i.path.join('.'),
        message: i.message,
      }));
    return validateSpec(item.kind, schema.data);
  }

  /** Grava os candidatos confirmados como rascunhos (nova revisão quando o modelo já existe). */
  async commit(input: ImportCommitInput): Promise<{ created: EquipmentDto[] }> {
    const parsed = importCommitSchema.safeParse(input);
    if (!parsed.success) throw new ZodValidationException(parsed.error);
    const created = await this.prisma.db.$transaction(async (tx) => {
      const out: EquipmentDto[] = [];
      for (const item of parsed.data.items as CreateEquipmentData[])
        out.push(await this.catalog.createDraft(item, { asRevision: true, tx }));
      return out;
    });
    return { created };
  }
}
