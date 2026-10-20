# Memorial: irradiação no plano e simulação horária (ENG-F18 a F21)

**Estado: projeto (implementação na 9G).** A validação é por **casos de ouro** (pvlib e PVGIS) e por comparação automática com o PVGIS no mesmo local.

## ENG-F18: irradiação no plano do arranjo

Três caminhos, na ordem de preferência (RN-018: nada é presumido em silêncio):

1. **Série horária** com global, direta e difusa (PVGIS/NASA via Central de Dados): transposição por hora para o plano (inclinação β, azimute γ do painel) usando a posição solar (F16): `G_plano = G_direta · cosθ_i / cosθ_z + G_difusa·(modelo de céu) + G_global·ρ·(1 − cosβ)/2`. O **modelo de céu** (isotrópico ou anisotrópico, como Hay-Davies/Perez) será escolhido na 9G **por comparação com o pvlib** e registrado na regra `engine.transposition`.
2. **Só global horizontal:** decomposição (ex.: Erbs) para obter a difusa, depois o caminho 1.
3. **Só HSP mensal** (SunData importado): fator mensal de transposição, **tabela versionada** da regra `engine.transposition`. Sem tabela ativa: usa-se o plano horizontal e o resultado leva aviso "sem transposição".

Fonte: Manual CRESESB cap. 3 (CR-12, não extraído nesta fase) e literatura; **a escolha do modelo é pendência da 9G**.

## ENG-F19: simulação

Por hora (8760 h) quando há série; senão mensal. Cadeia por hora: irradiação no plano (F18) → sombra (F17) → temperatura da célula (F01) → potência CC `P = Pstc · (G/1000) · (1 + γ/100·(Tcel − 25))` → perdas (cabos F13, sujeira, descasamento, regras) → limitação do inversor (F20) → eficiência → energia CA. **Perdas em cascata** apresentadas em diagrama (EF-R14 mostra que ferramentas de mercado entregam esse diagrama). **PR sai da simulação** (energia CA ÷ energia ideal), não é constante (EF-G01 segue lacuna do livro; CR-09 só serve de comparação).

## ENG-F20: limitação (clipping)

Hora a hora: `P_ca = min(P_cc_após_perdas · η, P_ca_nom)`; energia cortada = diferença. Sem série: faixa indicativa derivada do FDI (CR-08), marcada como estimativa.

## ENG-F21: degradação

Ano 1 sem degradação extra; depois, taxa anual da **garantia da ficha** (CR-11 serve só de conferência: 0,5–1,0 %/ano em campo). Sem garantia no catálogo: pendente.

## Comparações automáticas

Com o **Calculator** da oportunidade e com a **geração de referência do PVGIS** (mesma localização e configuração). Diferença em % e aviso acima do limite de regra.

## Validação prevista

`tools/golden/` ganhará: transposição (pvlib `irradiance.get_total_irradiance`), decomposição (`erbs`), potência CC de um módulo de teste (`pvsystem`), tudo com tolerância documentada. Um ano de série horária sintética versionada para o teste de ponta a ponta.
