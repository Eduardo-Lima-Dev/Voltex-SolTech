# Casos de ouro do motor

Referências **independentes** (outro software) para conferir o `@voltex/solar-engine`. Só o JSON gerado entra no repositório; o Python e o pvlib **não** são dependência do projeto.

## Arquivos

| Arquivo                     | Fórmula               | Referência                                                                      | Tolerância                                             |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `cases/solar-position.json` | ENG-F16 posição solar | pvlib 0.16.1, `solarposition.get_solarposition(method='nrel_numpy')` (NREL SPA) | altura 0,02° · azimute 0,05° (medido: 0,006° e 0,026°) |

| `cases/simulation-hourly.json` | ENG-F18/F19 transposição isotrópica e potência CA | pvlib 0.16.1: céu claro Ineichen, SPA e `irradiance.get_total_irradiance(model='isotropic')`, albedo 0,2; 27 casos (3 locais × 3 dias × 3 planos) | energia CA diária 0,5% (medido: abaixo disso em todos os casos) |

Os testes que os consomem são `packages/solar-engine/src/solar-position/golden.test.ts` e `packages/solar-engine/src/engine/simulation.golden.test.ts`. A decomposição DNI = (GHI − DHI)/sen(altura) é a do motor; o pvlib fornece posição solar e transposição independentes. A comparação com o PVGIS é feita em tempo de projeto (referência anual informada no desenho), não aqui, por causa da licença.

## Como regenerar

```bash
python3 -m venv /tmp/pvvenv && /tmp/pvvenv/bin/pip install pvlib
/tmp/pvvenv/bin/python tools/golden/generate.py
```

O arquivo guarda a versão do pvlib e a data. Mudar a versão ou a tolerância é uma decisão revisada, não um ajuste para o teste passar.

## O que ainda não tem caso de ouro (e por quê)

- **Temperatura e strings (F01–F06):** são equações lineares; os casos estão nos testes unitários com valores **calculados à mão** e no [memorial](../../docs/06-calculos/engine-compatibilidade.md). O manual CRESESB (CR-03) traz um exemplo numérico que também entra nos testes na 9E.
- **Modelos de transposição anisotrópicos (Hay-Davies, Perez) e decomposição Erbs:** o motor usa o modelo isotrópico (conservador para céu encoberto); outros modelos exigiriam novos casos.
- **Economia (F23):** planilha de referência na 9H.
- Uso comercial dos dados do PVGIS depende da [conferência de licença](../../docs/referencias/fontes-externas.md); os casos de ouro aqui **não** usam dado do PVGIS.
