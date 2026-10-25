/**
 * Pseudônimos por conversa (ADR-0030). Nome de cliente, contato, usuário interno e equipe nunca vai ao provedor:
 * vira `[CLIENTE_1]`, `[CONTATO_1]`… O mapa fica no servidor, com o id da entidade, e a resposta volta a mostrar o
 * nome real só para quem pode ver aquela entidade.
 */

export type PseudonymKind = 'CLIENTE' | 'CONTATO' | 'USUARIO' | 'EQUIPE';

export interface PseudonymEntry {
  alias: string;
  kind: PseudonymKind;
  entityId: string;
  name: string;
}

const ALIAS = /\[(CLIENTE|CONTATO|USUARIO|EQUIPE)_(\d+)\]/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export class Pseudonymizer {
  private readonly byKey = new Map<string, PseudonymEntry>();
  private readonly byAlias = new Map<string, PseudonymEntry>();
  private readonly counters = new Map<PseudonymKind, number>();

  constructor(entries: readonly PseudonymEntry[] = []) {
    for (const e of entries) {
      this.byKey.set(`${e.kind}:${e.entityId}`, e);
      this.byAlias.set(e.alias, e);
      const n = Number(/_(\d+)\]$/.exec(e.alias)?.[1] ?? 0);
      this.counters.set(e.kind, Math.max(this.counters.get(e.kind) ?? 0, n));
    }
  }

  /** Registra (ou reaproveita) o pseudônimo de uma entidade. Mesma entidade, mesmo pseudônimo na conversa toda. */
  alias(kind: PseudonymKind, entityId: string, name: string): string {
    const key = `${kind}:${entityId}`;
    const existing = this.byKey.get(key);
    if (existing) return existing.alias;
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    const entry: PseudonymEntry = { alias: `[${kind}_${n}]`, kind, entityId, name };
    this.byKey.set(key, entry);
    this.byAlias.set(entry.alias, entry);
    return entry.alias;
  }

  has(alias: string): boolean {
    return this.byAlias.has(alias);
  }

  entries(): PseudonymEntry[] {
    return [...this.byAlias.values()];
  }

  /**
   * Troca, no texto, todo nome já conhecido por seu pseudônimo (sem diferenciar maiúsculas ou acentos, só palavra
   * inteira). Nome mais longo primeiro, para "Maria da Silva" não virar "[CLIENTE_1] da Silva".
   */
  scrub(text: string): string {
    const names = this.entries().sort((a, b) => b.name.length - a.name.length);
    let out = text;
    for (const entry of names) {
      if (entry.name.trim().length < 3) continue;
      const parts = entry.name.trim().split(/\s+/).map(escape);
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
      out = out.replace(re, entry.alias);
      // Também pega a grafia sem acento.
      const folded = fold(entry.name);
      if (folded !== entry.name.toLowerCase()) {
        const foldedRe = new RegExp(
          `(?<![\\p{L}\\p{N}])${folded.split(/\s+/).map(escape).join('\\s+')}(?![\\p{L}\\p{N}])`,
          'giu',
        );
        out = out.replace(foldedRe, entry.alias);
      }
    }
    return out;
  }

  /** Pseudônimos citados no texto que esta conversa não conhece (a IA inventou?). */
  unknownAliases(text: string): string[] {
    const unknown: string[] = [];
    for (const m of text.matchAll(ALIAS)) if (!this.byAlias.has(m[0])) unknown.push(m[0]);
    return [...new Set(unknown)];
  }

  /**
   * Volta ao nome real. `canSee` decide por entidade; sem permissão, o texto fica neutro ("um cliente"), nunca com
   * o nome nem com o pseudônimo.
   */
  reveal(text: string, canSee: (entry: PseudonymEntry) => boolean): string {
    const NEUTRAL: Record<PseudonymKind, string> = {
      CLIENTE: 'um cliente',
      CONTATO: 'um contato',
      USUARIO: 'uma pessoa da equipe',
      EQUIPE: 'uma equipe',
    };
    return text.replace(ALIAS, (alias) => {
      const entry = this.byAlias.get(alias);
      if (!entry) return alias;
      return canSee(entry) ? entry.name : NEUTRAL[entry.kind];
    });
  }
}
