# ADR-0026: Segundo fator (TOTP) para usuários internos

- **Status:** Aceita
- **Data:** 2026-10-23

## Contexto

RNF-SEG-011 e RF-PLAT-014 pedem segundo fator para quem acessa dados de clientes.

## Decisão

- TOTP (RFC 6238; 6 dígitos, passo de 30 s, janela de ±1 passo), implementado sem dependência externa.
- O segredo fica **cifrado** no banco. Cada passo aceito é registrado (`mfaLastStep`) e **não vale de novo**.
- Códigos de recuperação guardados só como hash e de uso único.
- Obrigatoriedade configurável por empresa e por perfil (`settings.mfa`). Login em duas etapas: a primeira devolve um
  desafio curto, a segunda troca desafio + código por sessão.

## Consequências

- Perder o aplicativo e os códigos exige reset por um administrador.
- A tolerância de relógio é de 30 s para cada lado.

## Alternativas consideradas

- SMS/e-mail como segundo fator: rejeitada (mais fraco e com custo).
- Biblioteca `otplib`: dispensada, o algoritmo é pequeno e coberto por vetores de teste do RFC.
