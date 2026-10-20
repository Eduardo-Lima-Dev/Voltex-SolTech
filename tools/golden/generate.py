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


PLANOS = [  # (nome, azimute °N horário, inclinação °)
    ("norte-20", 0.0, 20.0),
    ("leste-15", 90.0, 15.0),
    ("oeste-30", 270.0, 30.0),
]
DIAS = ["2025-03-20", "2025-06-21", "2025-12-21"]
POTENCIA_WP = 5000.0
PERDAS = 0.14
EFICIENCIA = 0.96
GAMMA = -0.4
NOCT = 44.0
ALBEDO = 0.2


def simulacao_horaria():
    """Energia CA diária de um arranjo de 5 kWp: GHI/DHI de céu claro (Ineichen, pvlib), transposição
    isotrópica do pvlib e o mesmo modelo de potência do motor (NOCT, coeficiente de potência, perdas, inversor)."""
    import numpy as np

    cases = []
    for nome, (lat, lon, alt) in LOCAIS.items():
        if nome == "equador":
            continue
        loc = pvlib.location.Location(lat, lon, altitude=alt, tz="UTC")
        for dia in DIAS:
            times = pd.date_range(f"{dia} 00:00", periods=24, freq="h", tz="UTC")
            cs = loc.get_clearsky(times, model="ineichen")
            pos = loc.get_solarposition(times, method="nrel_numpy")
            ghi = cs["ghi"].round(2)
            dhi = cs["dhi"].round(2)
            temp = (22 + 8 * np.sin((np.arange(24) - 9) / 24 * 2 * np.pi)).round(2)
            sin_el = np.maximum(0.01, np.sin(np.radians(pos["elevation"].clip(lower=-90))))
            dni = np.maximum(0, (ghi - dhi) / sin_el)
            dni = np.where(pos["elevation"] > 0, dni, 0.0)
            for pn, az, tilt in PLANOS:
                poa = pvlib.irradiance.get_total_irradiance(
                    tilt, az, pos["apparent_zenith"], pos["azimuth"], dni, ghi, dhi, albedo=ALBEDO, model="isotropic"
                )["poa_global"].fillna(0).clip(lower=0)
                poa = np.where(pos["elevation"] > 0, poa, 0.0)
                cell = temp + (NOCT - 20) / 800 * poa
                dc = POTENCIA_WP * poa / 1000 * (1 + GAMMA / 100 * (cell - 25)) * (1 - PERDAS)
                ac = np.maximum(0, dc) * EFICIENCIA / 1000
                cases.append(
                    {
                        "id": f"sim-{nome}-{dia}-{pn}",
                        "input": {
                            "latitude": lat,
                            "longitude": lon,
                            "startAt": f"{dia}T00:00:00Z",
                            "ghiWhM2": [float(v) for v in ghi],
                            "dhiWhM2": [float(v) for v in dhi],
                            "tempC": [float(v) for v in temp],
                            "azimuthDegrees": az,
                            "tiltDegrees": tilt,
                        },
                        "expected": {
                            "acEnergyKwh": round(float(ac.sum()), 4),
                            "poaWhM2": round(float(np.sum(poa)), 2),
                        },
                    }
                )
    return {
        "formula": "ENG-F18/F19",
        "reference": f"pvlib {pvlib.__version__}: clear-sky Ineichen, nrel_numpy, irradiance.get_total_irradiance(model='isotropic')",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "params": {
            "dcPowerWp": POTENCIA_WP,
            "lossFraction": PERDAS,
            "inverterEfficiencyPct": EFICIENCIA * 100,
            "gammaPmaxPctPerC": GAMMA,
            "noctC": NOCT,
            "albedo": ALBEDO,
        },
        "toleranceRelative": 0.005,
        "toleranceNote": "A decomposição DNI = (GHI − DHI)/sen(altura) é a do motor; o pvlib fornece a posição solar e a transposição isotrópica independentes.",
        "cases": cases,
    }


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    (OUT / "simulation-hourly.json").write_text(
        json.dumps(simulacao_horaria(), indent=1, ensure_ascii=False) + "\n"
    )
    (OUT / "solar-position.json").write_text(
        json.dumps(posicao_solar(), indent=2, ensure_ascii=False) + "\n"
    )
    print("ok")
