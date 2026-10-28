import type { AiMessage } from '../ai-provider';
import { findPersonalData, type PersonalDataType } from './detectors';

/** O conteúdo a enviar ao provedor ainda tem dado pessoal. Guarda só os TIPOS e quantos, nunca o dado. */
export class PersonalDataLeak extends Error {
  constructor(readonly counts: Partial<Record<PersonalDataType, number>>) {
    super(`dado pessoal detectado antes do envio: ${JSON.stringify(counts)}`);
    this.name = 'PersonalDataLeak';
  }
}

/**
 * Última barreira antes do provedor (ADR-0030): recusa o envio se qualquer mensagem tiver dado pessoal. O
 * mascaramento acontece antes; isto existe para o caso de alguém esquecê-lo em uma ferramenta nova.
 */
export function assertNoPersonalData(messages: readonly AiMessage[]): void {
  const counts: Partial<Record<PersonalDataType, number>> = {};
  for (const message of messages) {
    const texts = [
      message.content,
      ...(message.toolCalls?.map((c) => JSON.stringify(c.arguments)) ?? []),
    ];
    for (const text of texts)
      for (const m of findPersonalData(text)) counts[m.type] = (counts[m.type] ?? 0) + 1;
  }
  if (Object.keys(counts).length > 0) throw new PersonalDataLeak(counts);
}
