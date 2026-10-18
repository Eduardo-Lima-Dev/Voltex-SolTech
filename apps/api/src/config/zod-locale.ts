import { z } from 'zod';

// Mensagens de validação em português do Brasil em toda a API (os `details` dos erros 422 chegam ao usuário).
z.config(z.locales.ptBR());
