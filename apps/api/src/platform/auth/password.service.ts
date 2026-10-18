import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

@Injectable()
export class PasswordService {
  /** Hash de uma senha aleatória: usado para igualar o tempo de resposta quando o usuário não existe. */
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password);
  }

  async verify(storedHash: string | null | undefined, password: string): Promise<boolean> {
    const target = storedHash ?? (await this.getDummyHash());
    try {
      const ok = await verify(target, password);
      return storedHash ? ok : false;
    } catch {
      return false;
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hash('voltex-dummy-password-for-timing');
    return this.dummyHash;
  }
}
