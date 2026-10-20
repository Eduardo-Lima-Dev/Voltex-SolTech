"""Gera os casos de ouro do motor com o pvlib (referência independente).

Uso (fora do repositório, sem poluir o projeto):

    python3 -m venv /tmp/pvvenv && /tmp/pvvenv/bin/pip install pvlib
    /tmp/pvvenv/bin/python tools/golden/generate.py

Só o JSON gerado entra no repositório; o pvlib NÃO é dependência do projeto.
"""
import json
import pathlib
from datetime import datetime, timezone

import pandas as pd
import pvlib

OUT = pathlib.Path(__file__).parent / "cases"

LOCAIS = {
    "brasilia": (-15.78, -47.93, 1172),
    "fortaleza": (-3.73, -38.52, 21),
    "porto-alegre": (-30.03, -51.23, 10),
    "equador": (0.0, 0.0, 0),
}
INSTANTES = [
    "2025-03-20T09:00:00Z",
    "2025-03-20T15:00:00Z",
    "2025-06-21T13:00:00Z",
    "2025-06-21T17:30:00Z",
    "2025-09-22T11:00:00Z",
    "2025-12-21T14:00:00Z",
    "2025-12-21T18:00:00Z",
]


def posicao_solar():
    cases = []
    for nome, (lat, lon, alt) in LOCAIS.items():
        for instante in INSTANTES:
            t = pd.DatetimeIndex([datetime.fromisoformat(instante.replace("Z", "+00:00"))])
            pos = pvlib.solarposition.get_solarposition(
                t, lat, lon, altitude=alt, method="nrel_numpy"
            )
            cases.append(
                {
                    "id": f"solpos-{nome}-{instante}",
                    "input": {"at": instante, "latitudeDegrees": lat, "longitudeDegrees": lon},
                    "expected": {
                        "elevationDegrees": round(float(pos["elevation"].iloc[0]), 5),
                        "azimuthDegrees": round(float(pos["azimuth"].iloc[0]), 5),
                    },
                }
            )
    return {
        "formula": "ENG-F16",
        "reference": f"pvlib {pvlib.__version__}, solarposition.get_solarposition(method='nrel_numpy') (NREL SPA)",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "toleranceElevationDegrees": 0.02,
        "toleranceAzimuthDegrees": 0.05,
        "toleranceNote": "O motor usa as equações do NOAA (Meeus), não o SPA completo. Diferença máxima medida em 2025: 0,006° na altura e 0,026° no azimute.",
        "cases": cases,
    }


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    (OUT / "solar-position.json").write_text(
        json.dumps(posicao_solar(), indent=2, ensure_ascii=False) + "\n"
    )
    print("ok")
