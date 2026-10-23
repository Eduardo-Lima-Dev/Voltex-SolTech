# ADR-0026: MFA com TOTP (RNF-SEG-011)

**Status:** Accepted (2026-10-23)

**Context**

Usuários internos (OWNER, ADMIN, INSTALLER, etc) acessam dados sensíveis: clientes, geolocalização,
ordens de serviço. RNF-SEG-011 pede autenticação de dois fatores. TOTP (Time-based OTP) é padrão,
offline, sem dependência de SMS ou provider.

**Decision**

1. MFA baseado em TOTP (biblioteca `otplib`).
2. Setup: usuário escaneia QR code e confirma código 6 dígitos.
3. Backup codes: 10 códigos hash, cada um usável uma vez.
4. Login com MFA: após password, pede código TOTP ou backup code.
5. Obrigatoriedade: configurável por empresa e perfil (no tenant.settings).
6. Secret TOTP cifrado no banco (`PROTECTED`).

**Rationale**

- TOTP é seguro, sem SMS cost.
- Backup codes cobrem perda de telefone.
- Setup rápido, UX simples.

**Consequences**

- Usuário sem telefone pode perder acesso (daí os backup codes).
- Se perder o secret, requer reset via admin.

**Related**

- RNF-SEG-011: autenticação de dois fatores
- 11I: DocuSeal, MFA, lead scoring, wa.me
