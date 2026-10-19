-- Executado apenas na primeira criação do volume do PostgreSQL (desenvolvimento).
-- Extensões úteis para busca e normalização; as tabelas são criadas pelas migrations do Prisma.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
