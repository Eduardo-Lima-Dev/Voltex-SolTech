# Casos de ouro do motor

Referências **independentes** (outro software) para conferir o `@voltex/solar-engine`. Só o JSON gerado entra no repositório; o Python e o pvlib **não** são dependência do projeto.

## Arquivos

| Arquivo                     | Fórmula               | Referência                                                                      | Tolerância                                             |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `cases/solar-position.json` | ENG-F16 posição solar | pvlib 0.16.1, `solarposition.get_solarposition(method='nrel_numpy')` (NREL SPA) | altura 0,02° · azimute 0,05° (medido: 0,006° e 0,026°) |

O teste que os consome é `packages/solar-engine/src/solar-position/golden.test.ts`.

## Como regenerar

```bash
python3 -m venv /tmp/pvvenv && /tmp/pvvenv/bin/pip install pvlib
/tmp/pvvenv/bin/python tools/golden/generate.py
```

O arquivo guarda a versão do pvlib e a data. Mudar a versão ou a tolerância é uma decisão revisada, não um ajuste para o teste passar.

## O que ainda não tem caso de ouro (e por quê)

- **Temperatura e strings (F01–F06):** são equações lineares; os casos estão nos testes unitários com valores **calculados à mão** e no [memorial](../../docs/06-calculos/engine-compatibilidade.md). O manual CRESESB (CR-03) traz um exemplo numérico que também entra nos testes na 9E.
- **Transposição, decomposição, potência CC (F18, F19):** entram na 9G com pvlib (`irradiance.get_total_irradiance`, `erbs`) e comparação com o PVGIS.
- **Economia (F23):** planilha de referência na 9H.
- Uso comercial dos dados do PVGIS depende da [conferência de licença](../../docs/referencias/fontes-externas.md); os casos de ouro aqui **não** usam dado do PVGIS.
