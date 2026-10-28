/**
 * Disjuntor: depois de `threshold` falhas em `windowMs`, para de tentar por `openMs`. Passado o tempo, deixa passar
 * uma tentativa (meia-abertura): se der certo fecha; se falhar, abre de novo. Assim uma queda do provedor não faz
 * cada pergunta esperar o prazo inteiro (o usuário nunca fica esperando à toa).
 */
export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private probing = false;

  constructor(
    private readonly threshold = 3,
    private readonly windowMs = 60_000,
    private readonly openMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get isOpen(): boolean {
    return this.openedAt !== null && this.now() - this.openedAt < this.openMs;
  }

  /** Pode tentar agora? Fechado: sim. Aberto: não. Meia-aberto: só uma tentativa de cada vez. */
  canAttempt(): boolean {
    if (this.openedAt === null) return true;
    if (this.now() - this.openedAt < this.openMs) return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = [];
    this.openedAt = null;
    this.probing = false;
  }

  recordFailure(): void {
    const t = this.now();
    this.probing = false;
    this.failures = [...this.failures.filter((f) => t - f < this.windowMs), t];
    if (this.openedAt !== null || this.failures.length >= this.threshold) this.openedAt = t;
  }
}
