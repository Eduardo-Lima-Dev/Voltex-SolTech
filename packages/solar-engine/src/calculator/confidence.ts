import { AlertSeverity } from '@voltex/shared';
import type { CalculationAlert, ParsedQuickCalculationInput } from './types.js';

const OCR_CONFIDENCE_FLOOR = 0.8;

/**
 * Score de confiança (0–100): parte de 100 e desconta por histórico incompleto,
 * dado ausente, HSP manual, OCR de baixa confiança e alertas.
 */
export const confidenceScore = (
  input: ParsedQuickCalculationInput,
  alerts: readonly CalculationAlert[],
): number => {
  let score = 100;
  score -= ((12 - input.consumptionMonthlyKwh.length) / 12) * 20;
  score -= input.missingCriticalData.length * 15;
  if (input.hspSource === 'MANUAL') score -= 5;
  if (input.ocrConfidence !== undefined && input.ocrConfidence < OCR_CONFIDENCE_FLOOR) score -= 10;
  for (const alert of alerts) {
    if (alert.severity === AlertSeverity.BLOCKING) score -= 20;
    else if (alert.severity === AlertSeverity.WARNING && alert.code !== 'MISSING_CRITICAL_DATA')
      score -= 5;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
};
