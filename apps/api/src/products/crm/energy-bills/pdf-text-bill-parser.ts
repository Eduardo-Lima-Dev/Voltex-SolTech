import { Injectable, Logger } from '@nestjs/common';
import { extractText, getDocumentProxy } from 'unpdf';
import {
  extractBillFields,
  type BillParseInput,
  type BillParseResult,
  type BillParserProvider,
} from './bill-parser';

/**
 * Leitura de faturas em PDF com camada de texto, por heurísticas. Imagens e PDFs escaneados não têm texto:
 * nesses casos nada é lido e a pessoa digita os campos na revisão (um adaptador de OCR entra por `BillParserProvider`).
 */
@Injectable()
export class PdfTextBillParser implements BillParserProvider {
  readonly name = 'pdf-text-heuristic';
  readonly version = '1.0.0';
  private readonly logger = new Logger(PdfTextBillParser.name);

  async parse(input: BillParseInput): Promise<BillParseResult> {
    const base = { parserName: this.name, parserVersion: this.version };
    if (input.mimeType !== 'application/pdf') return { ...base, fields: {}, textLength: 0 };
    try {
      const pdf = await getDocumentProxy(new Uint8Array(input.buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      return {
        ...base,
        fields: extractBillFields(text, input.distributorNames),
        textLength: text.length,
      };
    } catch (error) {
      // PDF corrompido ou protegido: segue sem leitura automática.
      this.logger.warn(
        `Não foi possível ler o PDF: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ...base, fields: {}, textLength: 0 };
    }
  }
}
