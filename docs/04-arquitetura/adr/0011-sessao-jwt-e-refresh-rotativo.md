# ADR-0011: Sessão com JWT de acesso e refresh token opaco rotativo

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

A suíte precisa de login seguro para um SPA React, logout efetivo, revogação imediata ao desativar um usuário e proteção contra roubo de token (RNF-SEG-004).

## Decisão

- **Access token:** JWT HS256 de 15 min (`sub`, `tid`, `role`), enviado no header `Authorization: Bearer`. Mantido só em memória no front.
- **Refresh token:** valor **opaco** aleatório (256 bits), guardado no banco apenas como SHA-256, entregue em cookie `httpOnly`, `SameSite=Lax`, `Path=/api/v1/auth`, `Secure` em produção. Não há segredo de assinatura para ele.
- **Rotação com detecção de reuso:** cada refresh gera um token novo na mesma `familyId`. Reapresentar um token já rotacionado revoga a família inteira e audita o incidente, com tolerância de 10 s para abas simultâneas.
- **Estado sempre atual:** o guard recarrega usuário/tenant do banco a cada requisição, então perfil, desativação e suspensão valem na hora, apesar de o JWT ser stateless.
- Senhas com **argon2id**; login sem enumeração de usuários e com limite de 5 tentativas/min.

## Consequências

- Uma consulta por requisição autenticada (indexada por chave primária). Se virar gargalo, cachear por poucos segundos com invalidação.
- CSRF: o cookie só autentica `/auth/*`, é `SameSite=Lax` e as rotas mutáveis exigem o header `Authorization`, que o navegador não envia sozinho.
- MFA (Fase 11) entra como etapa extra do login; os campos já existem em `User`.

## Alternativas consideradas

JWT de longa duração (não revogável); sessão por cookie de servidor (acopla o front à API e dificulta clientes móveis/parceiros); refresh token JWT (exige gerenciar mais um segredo sem ganho).
