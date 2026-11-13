#!/usr/bin/env python3
"""Generate ten synthetic, watertight ScanRuler STL test specimens (millimetres).

Only Python standard library; deterministic and free of third-party scan data.
Each specimen is a closed triangulated height-field prism, intended for scan-side
fitting, sectioning, surface/deviation and 2D sketch tests. These STLs are meshes,
NOT editable CAD STEP bodies; imported-face Edit Surface requires a separate STEP test.
SPDX-License-Identifier: AGPL-3.0-only
"""
from __future__ import annotations

import hashlib
import html
import json
import math
import pathlib
import struct
import sys
from collections import Counter

NX, NY = 32, 24
WIDTH_MM, HEIGHT_MM = 60.0, 40.0

CASES = [
    ("01-planar-plate", "Piastra piana", "Fit plane / planar datum / 2D sketch dimension"),
    ("02-linear-ramp", "Rampa inclinata", "Fit inclined plane / angle measurement"),
    ("03-diagonal-ramp", "Piano obliquo", "Inclined sections / sketch alignment"),
    ("04-convex-dome", "Superficie convessa", "Freeform fit / Zebra continuity"),
    ("05-concave-bowl", "Superficie concava", "Local surface replacement / deviation"),
    ("06-saddle", "Superficie a sella", "B-spline fitting / control-net stress"),
    ("07-raised-ridge", "Nervatura rialzata", "Sharp-ish ridge / cross-section profiles"),
    ("08-twin-bosses", "Due rilievi", "Local edits and feature preservation"),
    ("09-central-pocket", "Depressione centrale", "Flatten/raise localized surface / deviation"),
    ("10-sinusoidal-wave", "Ondulazione", "Zebra striping / smoothing without overshoot"),
]

def z_for(case_id: str, u: float, v: float) -> float:
    if case_id.startswith("01-"):
        return 6.0
    if case_id.startswith("02-"):
        return 6.0 + 2.0 * u
    if case_id.startswith("03-"):
        return 6.0 + 1.4 * u + 0.9 * v
    if case_id.startswith("04-"):
        return 5.0 + 1.2 * (1.0 - u*u - v*v)
    if case_id.startswith("05-"):
        return 4.5 + 0.8 * (u*u + v*v)
    if case_id.startswith("06-"):
        return 5.0 + 1.1 * (u*u - v*v)
    if case_id.startswith("07-"):
        return 4.0 + 2.0 * math.exp(-((u / 0.17)**2))
    if case_id.startswith("08-"):
        return 4.0 + 1.8 * math.exp(-(((u-0.43)/0.21)**2 + (v/0.37)**2)) + 1.8 * math.exp(-(((u+0.43)/0.21)**2 + (v/0.37)**2))
    if case_id.startswith("09-"):
        return 6.0 - 2.0 * math.exp(-((u/0.35)**2 + (v/0.45)**2))
    if case_id.startswith("10-"):
        return 5.0 + 0.55 * math.sin(2.0 * math.pi * u) * math.cos(math.pi * v)
    raise ValueError(f"Unknown case: {case_id}")

def make_triangles(case_id: str):
    def point(i: int, j: int, top: bool):
        u = 2.0 * i / NX - 1.0
        v = 2.0 * j / NY - 1.0
        return (WIDTH_MM*u/2, HEIGHT_MM*v/2, z_for(case_id, u, v) if top else 0.0)

    t = []
    for i in range(NX):
        for j in range(NY):
            a, b, c, d = (point(i,j,True), point(i+1,j,True),
                          point(i+1,j+1,True), point(i,j+1,True))
            t.extend(((a,b,c),(a,c,d)))
            a, b, c, d = (point(i,j,False), point(i+1,j,False),
                          point(i+1,j+1,False), point(i,j+1,False))
            t.extend(((a,c,b),(a,d,c)))

    def wall(p0, p1, q0, q1):
        t.extend(((p0,p1,q1),(p0,q1,q0)))
    for i in range(NX):
        wall(point(i,0,False), point(i+1,0,False), point(i,0,True), point(i+1,0,True))
        wall(point(i+1,NY,False), point(i,NY,False), point(i+1,NY,True), point(i,NY,True))
    for j in range(NY):
        wall(point(NX,j,False), point(NX,j+1,False), point(NX,j,True), point(NX,j+1,True))
        wall(point(0,j+1,False), point(0,j,False), point(0,j+1,True), point(0,j,True))
    return t

def cross(a,b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])

def dot(a,b):
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]

def triangle_normal(a,b,c):
    ab=tuple(b[i]-a[i] for i in range(3))
    ac=tuple(c[i]-a[i] for i in range(3))
    n=cross(ab,ac)
    l=math.sqrt(dot(n,n))
    if l < 1e-9:
        raise ValueError("Degenerate triangle")
    return tuple(x/l for x in n)

def write_stl(path: pathlib.Path, triangles):
    edges=Counter()
    volume=0.0
    payload=bytearray()
    for a,b,c in triangles:
        normal=triangle_normal(a,b,c)
        payload.extend(struct.pack("<12fH", *normal, *a, *b, *c, 0))
        volume += dot(a,cross(b,c))/6.0
        for p,q in ((a,b),(b,c),(c,a)):
            edges[tuple(sorted((p,q)))] += 1
    bad=sum(v != 2 for v in edges.values())
    if bad or volume <= 0:
        raise ValueError(f"Non-manifold/orientation: {bad} bad edges; volume {volume:.3f}")
    header=("TMAR ScanRuler synthetic fixture "+path.stem).encode("ascii")[:80].ljust(80,b"\0")
    contents=header+struct.pack("<I",len(triangles))+payload
    path.write_bytes(contents)
    return {"triangles":len(triangles),"volume_mm3":round(volume,2),
            "bytes":len(contents),"sha256":hashlib.sha256(contents).hexdigest(),
            "watertight":True}

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: generate-fixtures.py OUTPUT_DIRECTORY")
    root=pathlib.Path(sys.argv[1])
    root.mkdir(parents=True,exist_ok=True)
    manifest={"unit":"mm","geometry":"synthetic closed triangular meshes, not editable CAD B-Rep",
              "purpose":"scan import, sections, deviation, Zebra, fit surfaces and 2D sketch",
              "source":"Generated by ops/vps-preview/generate-fixtures.py",
              "cases":[]}
    for case_id, title, task in CASES:
        filename=case_id+".stl"
        metrics=write_stl(root/filename,make_triangles(case_id))
        manifest["cases"].append({"id":case_id,"file":filename,"title":title,
                                  "test":task,"size_mm":[WIDTH_MM,HEIGHT_MM],
                                  **metrics})
    (root/"manifest.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    items="\n".join(
        f'<li><a href="{html.escape(c["file"])}">{html.escape(c["title"])}</a>'
        f' — {html.escape(c["test"])} ({c["triangles"]} triangoli)</li>'
        for c in manifest["cases"]
    )
    index=f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>TMAR ScanRuler — 10 casi di prova</title>
<style>body{{max-width:840px;margin:3rem auto;padding:0 1rem;font:16px/1.6 system-ui;background:#11151c;color:#eef3f7}}
a{{color:#8ed0ff}}li{{padding:.5rem 0}}code{{color:#efce93}}</style></head>
<body><h1>TMAR ScanRuler — 10 modelli sintetici</h1>
<p>Dieci file STL scaricabili, chiusi e verificati. Le dimensioni sono 60 × 40 mm;
le quote Z variano per modello. File di test NON derivati da Airbox, scansioni private
o software proprietario.</p>
<p>Aprire ciascun file come <strong>Scan</strong> per fitting, sezioni, Zebra e prove
2D Sketch. Gli STL sono mesh: <strong>non</strong> servono a verificare la modifica
di una faccia CAD STEP importata, per la quale è necessario un caso STEP separato.</p>
<ol>{items}</ol><p><a href="manifest.json">Manifest JSON con controlli di integrità</a>
 · <a href="/">Torna a ScanRuler</a> ·
<a href="https://github.com/mrhz1973/tmar-scan-desktop">Sorgente AGPL-3.0</a></p>
</body></html>"""
    (root/"index.html").write_text(index,encoding="utf-8")
    print(f"OK {len(manifest['cases'])} synthetic watertight STL files, {sum(c['bytes'] for c in manifest['cases'])} bytes")

if __name__ == "__main__":
    main()
