import type { DailyReading } from './providers/types';

export const MAX_CSV_ROWS = 3700;

export interface CsvParseResult {
  rows: DailyReading[];
  rejected: { line: number; reason: string }[];
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function toIso(text: string): string | null {
  let y: number, m: number, d: number;
  const iso = ISO.exec(text);
  const br = BR.exec(text);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (br) [d, m, y] = [Number(br[1]), Number(br[2]), Number(br[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return date.toISOString().slice(0, 10);
}

/** "1234.5" · "1.234,5" · "1234,5". Devolve `null` se não for um número válido e não negativo. */
export function parseKwh(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, '');
  if (text === '') return null;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Planilha de geração diária: duas colunas, data e kWh. Aceita separador `;`, tabulação ou `,` (com `,` o kWh usa
 * ponto decimal), data `AAAA-MM-DD` ou `DD/MM/AAAA`, cabeçalho opcional. Linhas inválidas são devolvidas com o
 * motivo e não impedem as demais. Datas futuras são recusadas; data repetida vale a última.
 */
export function parseGenerationCsv(text: string, today: Date = new Date()): CsvParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const rejected: CsvParseResult['rejected'] = [];
  const byDate = new Map<string, number>();
  const limit = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
  let seen = 0;
  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    if (line.trim() === '') continue;
    const delimiter = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
    const cells = line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
    const date = toIso(cells[0] ?? '');
    if (date === null && seen === 0 && !ISO.test(cells[0] ?? '') && !BR.test(cells[0] ?? '')) {
      // Primeira linha que não é data: cabeçalho.
      seen += 1;
      continue;
    }
    seen += 1;
    if (seen > MAX_CSV_ROWS + 1) {
      rejected.push({ line: number, reason: `Limite de ${MAX_CSV_ROWS} linhas por arquivo` });
      continue;
    }
    if (cells.length < 2) {
      rejected.push({ line: number, reason: 'Esperadas duas colunas: data e kWh' });
      continue;
    }
    if (date === null) {
      rejected.push({
        line: number,
        reason: `Data inválida: "${cells[0]}" (use AAAA-MM-DD ou DD/MM/AAAA)`,
      });
      continue;
    }
    if (date > limit) {
      rejected.push({ line: number, reason: 'Data no futuro' });
      continue;
    }
    const kwh = parseKwh(cells[1] ?? '');
    if (kwh === null) {
      rejected.push({ line: number, reason: `kWh inválido: "${cells[1]}"` });
      continue;
    }
    byDate.set(date, kwh);
  }
  const rows = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, kwh]) => ({ date, kwh }));
  return { rows, rejected };
}
