"""
Unabhängige Zweitrechnung für den Gaubenwangen-Rechenkern.

Rechnet dieselben Fälle wie modules/gaubenwange/module.js, aber mit anderem
Rechenweg: Spitze S als Schnitt von Kreisen bzw. Strahlen (Vektorrechnung),
Nahtlängen durch Interpolation entlang der Kanten, Querfalz-Schnittkanten als
um die Zugabe parallel verschobene Geraden (Normalenvektor).

Aufruf:  python3 tests/gaubenwange/zweitrechnung.py
Schreibt tests/gaubenwange/soll_zweitrechnung.json, das der JS-Test vergleicht.
Nur Python-Standardbibliothek.
"""
import json
import math
import os

HIER = os.path.dirname(os.path.abspath(__file__))

STANDARD = {
    "regel": "vonVorne", "vorgabe": "schar", "scharbreite": 520, "bandbreite": 600, "raster": 1, "minRest": 100,
    "zugabeFront": 45, "zugabeSpitze": 35, "zugabeErsteFront": 35,
    "querOben": 15, "querUnten": 15,
}


def spitze(e):
    """Liefert (H, Sx, Sy) – Spitze der Wange in der Seitenansicht."""
    art = e["eingabeart"]
    H = float(e["H"])
    if art == "laengen":
        su, so = float(e["su"]), float(e["so"])
        # Kreis um Fu (0,0) mit su, Kreis um Fo (0,H) mit so
        y = (su * su - so * so + H * H) / (2 * H)
        x = math.sqrt(su * su - y * y)
        return H, x, y
    if art == "winkel":
        a, b = math.radians(e["alpha"]), math.radians(e["beta"])
        # Fu + s*(cos a, sin a) = Fo + t*(cos b, sin b)  -> lineares 2x2-System (Cramer)
        a11, a12, r1 = math.cos(a), -math.cos(b), 0.0
        a21, a22, r2 = math.sin(a), -math.sin(b), H
        det = a11 * a22 - a12 * a21
        s = (r1 * a22 - a12 * r2) / det
        return H, s * math.cos(a), s * math.sin(a)
    if art == "tiefe":
        L, a = float(e["L"]), math.radians(e["alpha"])
        return H, L, L * math.tan(a)
    if art == "referenz":
        so, g = float(e["so"]), math.radians(e["schmiege"])
        # Strahl von Fu, um g von der Senkrechten geneigt, schneidet Kreis um Fo mit so
        c = math.cos(g)
        s = H * c + math.sqrt(H * H * c * c - H * H + so * so)
        return H, s * math.sin(g), s * math.cos(g)
    raise ValueError(art)


def achsmasse(o):
    """Erlaubte Achsmasse: erste, übrige, letzte und einzige Schar.
    Bei Vorgabe Bandbreite: Band minus die Stehfalz-Zugaben der jeweiligen Schar
    (an der Spitze hat die letzte Schar keinen), auf das Raster abgerundet."""
    if o.get("vorgabe") == "band":
        r = o["raster"]
        ab = (lambda x: math.floor(x / r + 1e-9) * r) if r > 0 else (lambda x: x)
        B, zf, zs, ze = o["bandbreite"], o["zugabeFront"], o["zugabeSpitze"], o["zugabeErsteFront"]
        return ab(B - ze - zs), ab(B - zf - zs), ab(B - zf), ab(B - ze)
    b = o["scharbreite"]
    return b, b, b, b


def achsen(L, o):
    b1, b, b_letzte, b_einzige = achsmasse(o)
    raster = o["raster"]
    # kaufmännisch runden wie Math.round in JS (Python-round rundet .5 zur geraden Zahl)
    runde = (lambda x: math.floor(x / raster + 0.5) * raster) if raster > 0 else (lambda x: x)
    if o["regel"] == "gleichmaessig":
        n = max(1, math.ceil(L / b - 1e-9))
        while True:
            xs = [0.0] + [runde(i * L / n) for i in range(1, n)] + [L]
            breiten = [xs[i + 1] - xs[i] for i in range(n)]
            grenzen = [b1] + [b] * (n - 1)
            if all(w <= g + 1e-6 for w, g in zip(breiten, grenzen)):
                break
            n += 1
        xs = xs[:-1]
    else:
        # Breiten aufsummieren: erste b1, dann je b, bis der Rest in die letzte Schar passt
        xs, x = [0.0], 0.0
        while L - x > (b_einzige if x == 0 else b_letzte) + 1e-6:
            x = b1 if x == 0 else x + b
            xs.append(runde(x))
    while len(xs) > 1 and xs[-1] >= L - 1e-6:
        xs.pop()
    xs.append(L)
    return xs


def schnitt_senkrecht(p, r, x):
    """y-Wert der Geraden durch p mit Richtung r an der Stelle x."""
    t = (x - p[0]) / r[0]
    return p[1] + t * r[1]


def schnitt_geraden(p, r, q, s):
    det = r[0] * (-s[1]) - (-s[0]) * r[1]
    t = ((q[0] - p[0]) * (-s[1]) - (-s[0]) * (q[1] - p[1])) / det
    return (p[0] + t * r[0], p[1] + t * r[1])


def rechne(fall):
    e = fall["eingabe"]
    o = dict(STANDARD)
    o.update(fall.get("einstellungen", {}))
    H, Sx, Sy = spitze(e)
    L = Sx
    su = math.hypot(Sx, Sy)
    so = math.hypot(Sx, Sy - H)
    alpha = math.degrees(math.atan2(Sy, Sx))
    beta = math.degrees(math.atan2(Sy - H, Sx))

    def naht(x):
        # Interpolation entlang Unter- und Oberkante
        y_u = Sy * x / L
        y_o = H + (Sy - H) * x / L
        return y_o - y_u

    # Kantenrichtungen und Aussennormalen
    ru = (Sx / su, Sy / su)                    # Unterkante Fu -> S
    ro = (Sx / so, (Sy - H) / so)              # Oberkante Fo -> S
    nu = (ru[1], -ru[0])                       # nach unten aussen
    no = (-ro[1], ro[0])                       # nach oben aussen
    pu = (nu[0] * o["querUnten"], nu[1] * o["querUnten"])
    po = (no[0] * o["querOben"], H + no[1] * o["querOben"])
    xT, _ = schnitt_geraden(pu, ru, po, ro)

    xs = achsen(L, o)
    scharen = []
    for i in range(len(xs) - 1):
        x0, x1 = xs[i], xs[i + 1]
        erste, letzte = i == 0, i == len(xs) - 2
        zv = o["zugabeErsteFront"] if erste else o["zugabeFront"]
        zh = 0 if letzte else o["zugabeSpitze"]
        xa, xb = x0 - zv, x1 + zh
        spitz = xb >= xT - 1e-9
        if spitz:
            xb = xT
        ua, oa = schnitt_senkrecht(pu, ru, xa), schnitt_senkrecht(po, ro, xa)
        ub, ob = schnitt_senkrecht(pu, ru, xb), schnitt_senkrecht(po, ro, xb)
        scharen.append({
            "nr": i + 1, "x0": x0, "x1": x1, "breite": x1 - x0,
            "h0": naht(x0), "h1": 0.0 if letzte else naht(x1),
            "zBreite": xb - xa,
            "hoeheLinks": oa - ua,
            "hoeheRechts": 0.0 if spitz else ob - ub,
            "versatzUnten": ub - ua,
            "versatzOben": 0.0 if spitz else ob - oa,
            "spitz": spitz,
        })
    return {
        "name": fall["name"],
        "wange": {"H": H, "L": L, "su": su, "so": so, "alpha": alpha, "beta": beta,
                  "yS": Sy, "flaeche": H * L / 2},
        "scharen": scharen,
    }


def main():
    with open(os.path.join(HIER, "faelle.json"), encoding="utf-8") as f:
        faelle = json.load(f)["faelle"]
    ergebnis = {"hinweis": "Erzeugt von zweitrechnung.py – nicht von Hand ändern.",
                "faelle": [rechne(f) for f in faelle]}
    with open(os.path.join(HIER, "soll_zweitrechnung.json"), "w", encoding="utf-8") as f:
        json.dump(ergebnis, f, ensure_ascii=False, indent=1)
    for r in ergebnis["faelle"]:
        w = r["wange"]
        print(f'{r["name"]}: L {w["L"]:.2f}  su {w["su"]:.2f}  so {w["so"]:.2f}  '
              f'alpha {w["alpha"]:.3f}  beta {w["beta"]:.3f}  Scharen {len(r["scharen"])}')


if __name__ == "__main__":
    main()
