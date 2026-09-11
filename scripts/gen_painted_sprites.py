#!/usr/bin/env python3
"""Phase 26: generate painted multi-layer side-view race sprites (greyscale body for multiply tint).
No trademark logos/badges. Distinct proportions per model. Facing right.
"""
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "assets" / "race-sprites"
VB = 'viewBox="0 0 160 56" width="320" height="112"'

DEFS = """
  <defs>
    <linearGradient id="paint" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="28%" stop-color="#f2f2f2"/>
      <stop offset="55%" stop-color="#c8c8c8"/>
      <stop offset="82%" stop-color="#8a8a8a"/>
      <stop offset="100%" stop-color="#5a5a5a"/>
    </linearGradient>
    <linearGradient id="paintHi" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="45%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a222c"/>
      <stop offset="50%" stop-color="#0c1016"/>
      <stop offset="100%" stop-color="#06080c"/>
    </linearGradient>
    <linearGradient id="rocker" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.45"/>
    </linearGradient>
    <radialGradient id="rimShine" cx="35%" cy="30%" r="65%">
      <stop offset="0%" stop-color="#6a6a6a"/>
      <stop offset="55%" stop-color="#2a2a2a"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </radialGradient>
  </defs>
"""


def wheel(cx, cy, r=9.5, spokes=5):
    """Detailed multi-spoke wheel (dark tire + rim + spokes)."""
    tire = f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#0a0a0c"/>'
    rim = f'<circle cx="{cx}" cy="{cy}" r="{r*0.72}" fill="url(#rimShine)"/>'
    hub = f'<circle cx="{cx}" cy="{cy}" r="{r*0.18}" fill="#1a1a1c"/>'
    hub2 = f'<circle cx="{cx}" cy="{cy}" r="{r*0.08}" fill="#3a3a3c"/>'
    spoke_paths = []
    import math
    for i in range(spokes):
        a0 = (i / spokes) * 2 * math.pi - math.pi / 2
        a1 = a0 + (0.55 / spokes) * 2 * math.pi
        # wedge spoke
        x1 = cx + math.cos(a0) * r * 0.22
        y1 = cy + math.sin(a0) * r * 0.22
        x2 = cx + math.cos(a0) * r * 0.62
        y2 = cy + math.sin(a0) * r * 0.62
        x3 = cx + math.cos(a1) * r * 0.62
        y3 = cy + math.sin(a1) * r * 0.62
        x4 = cx + math.cos(a1) * r * 0.22
        y4 = cy + math.sin(a1) * r * 0.22
        spoke_paths.append(
            f'<path d="M{x1:.2f} {y1:.2f} L{x2:.2f} {y2:.2f} L{x3:.2f} {y3:.2f} L{x4:.2f} {y4:.2f} Z" fill="#4a4a4e"/>'
        )
    lip = f'<circle cx="{cx}" cy="{cy}" r="{r*0.72}" fill="none" stroke="#555558" stroke-width="0.6"/>'
    tire_lip = f'<circle cx="{cx}" cy="{cy}" r="{r*0.92}" fill="none" stroke="#1c1c20" stroke-width="1.2"/>'
    return "\n    ".join([tire, tire_lip, rim] + spoke_paths + [hub, hub2, lip])


def sprite(name, comment, body, glass, highlight, shadow="", extras="", wr=9.5, rear=(38, 42), front=(122, 42), spokes=5):
    """Assemble a painted SVG."""
    parts = [
        f'<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" {VB}>',
        f'  <!-- Phase 26 painted side-view — {comment}; no logos/badges; facing right -->',
        DEFS,
        f'  <g id="vehicle">',
        f'    <!-- body -->',
        f'    <path fill="url(#paint)" d="{body}"/>',
    ]
    if shadow:
        parts.append(f'    <path fill="url(#rocker)" d="{shadow}"/>')
    parts.append(f'    <!-- shoulder / hood highlight -->')
    parts.append(f'    <path fill="url(#paintHi)" d="{highlight}"/>')
    if extras:
        parts.append(f'    {extras}')
    parts.append(f'    <!-- glass -->')
    parts.append(f'    <path fill="url(#glass)" d="{glass}"/>')
    parts.append(f'    <!-- wheels -->')
    parts.append(f'    {wheel(rear[0], rear[1], wr, spokes)}')
    parts.append(f'    {wheel(front[0], front[1], wr, spokes)}')
    # subtle headlamp / taillight (no logo)
    parts.append(f'    <rect x="148" y="28" width="4.5" height="4" rx="0.8" fill="#d8d8d8" opacity="0.85"/>')
    parts.append(f'    <rect x="8" y="30" width="3.5" height="3.5" rx="0.6" fill="#888890" opacity="0.7"/>')
    parts.append(f'  </g>')
    parts.append(f'</svg>')
    return "\n".join(parts) + "\n"


# Distinct silhouettes — proportions inspired by real side profiles (de-badged originals)
VEHICLES = {}

# Mustang S550: long hood, short deck, fastback C-pillar
VEHICLES["mustang"] = dict(
    comment="Mustang-like fastback coupe",
    body="M6 38 L10 30 L16 22 L28 14 L48 8 L68 6 L86 8 L104 14 L122 22 L146 30 L152 36 L148 40 L140 42 L18 42 Z",
    glass="M52 10 L70 8 L88 12 L100 20 L96 24 L72 22 L54 18 Z",
    highlight="M14 24 L30 14 L50 8 L70 6 L90 10 L108 16 L120 22 L118 24 L100 18 L72 10 L48 12 L28 18 Z",
    shadow="M18 38 L140 38 L140 42 L18 42 Z",
    extras='<path fill="none" stroke="#666" stroke-width="0.5" opacity="0.45" d="M58 14 L58 38"/><path fill="#707070" opacity="0.35" d="M6 36 L12 30 L16 34 L10 38 Z"/>',
    spokes=5,
)

# Camaro 6th gen: more angular, higher beltline, different C-pillar
VEHICLES["camaro"] = dict(
    comment="Camaro-like angular coupe",
    body="M8 38 L14 26 L26 14 L44 8 L66 5 L88 6 L110 12 L132 22 L150 32 L152 38 L142 42 L20 42 Z",
    glass="M50 9 L68 7 L90 10 L106 18 L102 24 L70 22 L52 16 Z",
    highlight="M16 26 L30 14 L48 8 L70 5 L92 8 L114 14 L130 22 L128 24 L108 16 L74 8 L48 10 L28 18 Z",
    shadow="M20 38 L142 38 L142 42 L20 42 Z",
    extras='<path fill="none" stroke="#666" stroke-width="0.5" opacity="0.4" d="M64 12 L64 38"/><path fill="#606060" opacity="0.4" d="M8 36 L14 28 L20 34 L12 40 Z"/>',
    spokes=5,
)

# Corvette C8: low mid-engine wedge, short front overhang feel, long rear deck
VEHICLES["corvette"] = dict(
    comment="Corvette-like mid-engine sports",
    body="M4 40 L14 30 L32 18 L52 10 L78 6 L106 8 L132 16 L152 28 L150 38 L138 42 L16 42 Z",
    glass="M58 9 L82 8 L104 14 L108 22 L84 24 L60 18 Z",
    highlight="M12 30 L34 16 L56 8 L82 6 L110 10 L134 18 L146 28 L142 30 L118 18 L84 10 L56 12 L32 20 Z",
    shadow="M16 38 L138 38 L138 42 L16 42 Z",
    extras='<path fill="#505050" opacity="0.35" d="M100 10 L118 14 L116 20 L98 16 Z"/>',
    wr=9.0,
    rear=(42, 42),
    front=(126, 42),
    spokes=5,
)

# Challenger: long, boxy muscle, thick C-pillar, upright
VEHICLES["challenger"] = dict(
    comment="Challenger-like muscle coupe",
    body="M6 38 L12 28 L22 18 L40 10 L62 6 L90 6 L114 12 L136 24 L150 34 L148 40 L138 42 L18 42 Z",
    glass="M48 9 L70 7 L96 10 L108 20 L104 26 L72 24 L50 16 Z",
    highlight="M14 28 L26 16 L46 8 L70 6 L96 8 L118 14 L136 24 L132 26 L110 16 L74 8 L46 10 L24 20 Z",
    shadow="M18 38 L138 38 L138 42 L18 42 Z",
    extras='<path fill="none" stroke="#555" stroke-width="0.55" opacity="0.4" d="M72 10 L72 38"/>',
    spokes=5,
)

# Charger: 4-door sedan muscle, longer cabin, flatter roof
VEHICLES["charger"] = dict(
    comment="Charger-like 4-door muscle sedan",
    body="M6 38 L12 28 L24 16 L42 9 L64 6 L108 6 L130 14 L148 26 L152 36 L146 40 L138 42 L18 42 Z",
    glass="M46 9 L64 7 L92 7 L114 12 L118 22 L96 24 L66 22 L48 16 Z",
    highlight="M14 28 L28 16 L48 8 L72 6 L110 6 L132 14 L146 26 L142 28 L124 16 L92 8 L64 8 L42 12 L24 20 Z",
    shadow="M18 38 L138 38 L138 42 L18 42 Z",
    extras='<path fill="none" stroke="#555" stroke-width="0.45" opacity="0.35" d="M64 9 L64 38"/><path fill="none" stroke="#555" stroke-width="0.45" opacity="0.35" d="M92 9 L92 38"/>',
    spokes=5,
)

# Civic Type R hatch: compact hatch, taller, rear spoiler wing
VEHICLES["civic"] = dict(
    comment="Civic hatch-like compact",
    body="M14 38 L20 26 L34 14 L52 9 L78 8 L104 12 L124 22 L136 32 L134 38 L126 42 L24 42 Z",
    glass="M48 11 L72 9 L98 14 L108 24 L104 28 L74 26 L50 18 Z",
    highlight="M22 26 L38 14 L56 9 L82 8 L106 12 L124 22 L122 24 L102 14 L76 10 L52 12 L36 18 Z",
    shadow="M24 38 L126 38 L126 42 L24 42 Z",
    extras='<path fill="url(#paint)" d="M118 10 L136 8 L138 14 L122 16 Z"/><path fill="none" stroke="#555" stroke-width="0.45" opacity="0.35" d="M72 11 L72 38"/>',
    wr=8.8,
    rear=(40, 42),
    front=(118, 42),
    spokes=5,
)

# Porsche 911: rounder, sloping rear, distinctive silhouette
VEHICLES["porsche-911"] = dict(
    comment="911-like rear-engine coupe",
    body="M12 38 L20 26 L36 14 L58 8 L84 7 L110 10 L130 18 L146 30 L148 38 L138 42 L24 42 Z",
    glass="M54 10 L78 8 L102 12 L114 22 L110 26 L80 24 L56 16 Z",
    highlight="M22 26 L40 14 L62 8 L88 7 L114 12 L132 20 L142 30 L138 32 L120 20 L90 10 L62 10 L38 16 Z",
    shadow="M24 38 L138 38 L138 42 L24 42 Z",
    extras='<path fill="#606060" opacity="0.3" d="M120 18 Q142 24 140 36 L132 38 Q136 24 120 18 Z"/>',
    wr=9.2,
    rear=(40, 42),
    front=(120, 42),
    spokes=5,
)

# Tesla Model S: sleek sedan, smooth continuous roof, flush
VEHICLES["tesla-model-s"] = dict(
    comment="Model S-like EV sedan",
    body="M8 38 L14 26 L28 14 L50 8 L74 6 L104 6 L128 12 L146 24 L152 34 L148 40 L138 42 L18 42 Z",
    glass="M48 9 L72 7 L104 8 L122 14 L124 24 L100 26 L72 24 L50 16 Z",
    highlight="M16 26 L32 14 L54 8 L80 6 L110 6 L132 14 L148 26 L144 28 L126 16 L96 8 L70 8 L46 12 L28 18 Z",
    shadow="M18 38 L138 38 L138 42 L18 42 Z",
    extras='<path fill="none" stroke="#666" stroke-width="0.4" opacity="0.3" d="M72 9 L72 38"/><path fill="none" stroke="#666" stroke-width="0.4" opacity="0.3" d="M100 10 L100 38"/>',
    spokes=5,
)

# Tesla Model 3: shorter sedan, similar but more compact
VEHICLES["tesla-model-3"] = dict(
    comment="Model 3-like compact EV sedan",
    body="M12 38 L18 26 L32 14 L52 9 L74 7 L100 8 L122 14 L140 26 L146 36 L140 40 L132 42 L22 42 Z",
    glass="M50 10 L72 8 L100 10 L114 18 L112 26 L86 26 L52 18 Z",
    highlight="M20 26 L36 14 L56 9 L80 7 L106 9 L126 16 L140 28 L136 30 L118 18 L90 10 L68 10 L48 14 L32 20 Z",
    shadow="M22 38 L132 38 L132 42 L22 42 Z",
    spokes=5,
)

# Sportbike: aggressive lean, fairing, high tail
VEHICLES["sportbike"] = dict(
    comment="Sportbike lean fairing",
    body="M36 40 L44 22 L58 8 L74 6 L88 14 L108 26 L130 34 L126 40 L96 42 L52 42 Z",
    glass="M58 10 L72 8 L82 14 L78 20 L64 18 Z",
    highlight="M44 22 L58 8 L74 6 L86 12 L100 22 L118 30 L114 32 L88 20 L72 10 L56 14 Z",
    shadow="",
    extras='<path fill="url(#paint)" d="M58 8 L72 2 L86 8 L78 16 Z"/><path fill="#404048" d="M70 18 L92 28 L88 34 L68 26 Z"/>',
    wr=8.5,
    rear=(52, 42),
    front=(118, 42),
    spokes=3,
)

# Motorcycle (cruiser/standard fallback)
VEHICLES["motorcycle"] = dict(
    comment="Motorcycle class fallback",
    body="M40 40 L48 24 L62 12 L78 10 L92 18 L112 28 L124 34 L120 40 L88 42 L52 42 Z",
    glass="M64 14 L78 12 L86 18 L82 24 L68 22 Z",
    highlight="M48 24 L62 12 L78 10 L90 16 L106 26 L118 32 L114 34 L92 22 L76 14 L60 18 Z",
    extras='<path fill="url(#paint)" d="M78 10 L90 4 L98 10 L90 18 Z"/>',
    wr=8.5,
    rear=(54, 42),
    front=(116, 42),
    spokes=3,
)

# Pickup: cab + open bed
VEHICLES["pickup"] = dict(
    comment="Pickup truck cab+bed",
    body="M6 38 L10 28 L20 16 L36 9 L58 8 L66 16 L148 16 L152 28 L148 40 L140 42 L16 42 Z",
    glass="M28 12 L48 10 L62 14 L64 28 L30 28 L26 18 Z",
    highlight="M12 28 L24 16 L42 9 L58 8 L66 16 L148 16 L148 20 L66 20 L58 12 L40 12 L22 20 Z",
    shadow="M16 38 L140 38 L140 42 L16 42 Z",
    extras='<path fill="#707070" opacity="0.4" d="M66 16 L70 10 L148 10 L148 16 Z"/><path fill="none" stroke="#555" stroke-width="0.5" opacity="0.4" d="M66 16 L66 40"/>',
    wr=9.8,
    rear=(36, 42),
    front=(128, 42),
    spokes=5,
)

# Bronco: boxy off-road SUV, upright windshield, short overhangs
VEHICLES["bronco"] = dict(
    comment="Bronco-like boxy SUV",
    body="M10 40 L14 26 L26 12 L42 5 L50 4 L118 4 L132 10 L146 24 L150 36 L146 42 L20 42 Z",
    glass="M44 7 L70 6 L100 6 L118 10 L120 24 L46 24 L42 12 Z",
    highlight="M16 26 L30 12 L48 5 L80 4 L120 4 L136 12 L148 26 L144 28 L128 14 L96 6 L56 6 L36 12 L22 22 Z",
    shadow="M20 38 L146 38 L146 42 L20 42 Z",
    extras='<path fill="none" stroke="#555" stroke-width="0.5" opacity="0.4" d="M70 8 L70 38"/><path fill="none" stroke="#555" stroke-width="0.5" opacity="0.4" d="M100 8 L100 38"/><path fill="#505050" opacity="0.35" d="M10 36 L16 26 L22 32 L14 40 Z"/>',
    wr=10.2,
    rear=(40, 42),
    front=(124, 42),
    spokes=5,
)

# Supra A90: long hood, short cabin, flowing roof
VEHICLES["supra"] = dict(
    comment="Supra-like grand tourer coupe",
    body="M6 38 L14 26 L28 14 L48 7 L72 5 L96 7 L120 14 L144 26 L152 36 L146 40 L138 42 L18 42 Z",
    glass="M54 9 L76 7 L98 12 L110 22 L106 26 L78 24 L56 16 Z",
    highlight="M16 26 L32 14 L54 7 L78 5 L102 8 L124 16 L144 28 L140 30 L118 18 L86 8 L58 10 L34 18 Z",
    shadow="M18 38 L138 38 L138 42 L18 42 Z",
    spokes=5,
)

# GT-R: aggressive, wide, rear wing optional
VEHICLES["gtr"] = dict(
    comment="GT-R-like widebody coupe",
    body="M6 38 L14 24 L28 12 L50 6 L78 5 L104 8 L128 16 L148 28 L152 36 L146 40 L138 42 L18 42 Z",
    glass="M52 8 L74 6 L100 10 L114 20 L110 26 L76 24 L54 16 Z",
    highlight="M16 24 L32 12 L54 6 L82 5 L110 10 L132 18 L148 30 L144 32 L122 20 L90 8 L58 8 L34 16 Z",
    shadow="M18 38 L138 38 L138 42 L18 42 Z",
    extras='<path fill="url(#paint)" d="M118 8 L142 5 L144 12 L122 14 Z"/>',
    spokes=5,
)

# Viper: long hood, cab-rearward, aggressive
VEHICLES["viper"] = dict(
    comment="Viper-like long-hood sports",
    body="M4 40 L10 30 L20 20 L40 10 L68 5 L96 6 L122 14 L146 26 L152 36 L146 40 L136 42 L16 42 Z",
    glass="M64 8 L88 7 L108 14 L112 24 L90 26 L66 18 Z",
    highlight="M12 30 L24 18 L46 8 L74 5 L102 8 L126 16 L146 28 L142 30 L118 18 L84 8 L56 10 L30 20 Z",
    shadow="M16 38 L136 38 L136 42 L16 42 Z",
    wr=9.0,
    rear=(44, 42),
    front=(128, 42),
    spokes=5,
)

# Miata: tiny roadster, soft top shape, short
VEHICLES["miata"] = dict(
    comment="Miata-like compact roadster",
    body="M16 40 L24 30 L38 18 L56 12 L84 12 L106 18 L126 28 L134 36 L130 40 L122 42 L28 42 Z",
    glass="M52 14 L74 13 L96 18 L100 28 L76 30 L54 24 Z",
    highlight="M26 30 L42 18 L60 12 L88 12 L110 18 L128 30 L124 32 L104 20 L78 14 L56 16 L40 24 Z",
    shadow="M28 38 L122 38 L122 42 L28 42 Z",
    wr=8.2,
    rear=(42, 42),
    front=(116, 42),
    spokes=5,
)

# WRX / Impreza hatch: compact, taller, boxier hatch
VEHICLES["wrx"] = dict(
    comment="WRX hatch-like compact",
    body="M14 38 L20 26 L34 14 L52 9 L80 8 L106 12 L124 22 L136 32 L134 38 L126 42 L24 42 Z",
    glass="M48 11 L72 9 L100 14 L112 24 L108 28 L76 26 L50 18 Z",
    highlight="M22 26 L38 14 L56 9 L84 8 L110 12 L126 22 L124 24 L104 14 L78 10 L52 12 L36 18 Z",
    shadow="M24 38 L126 38 L126 42 L24 42 Z",
    extras='<path fill="url(#paint)" d="M116 12 L132 10 L134 16 L120 16 Z"/>',
    wr=8.8,
    rear=(40, 42),
    front=(118, 42),
    spokes=5,
)

# Firebird / Trans Am: classic long hood muscle
VEHICLES["firebird"] = dict(
    comment="Firebird-like classic muscle",
    body="M6 38 L12 28 L24 16 L44 8 L68 5 L92 6 L116 14 L140 26 L150 34 L148 40 L138 42 L18 42 Z",
    glass="M52 8 L74 6 L98 12 L110 22 L106 26 L76 24 L54 16 Z",
    highlight="M14 28 L28 16 L50 8 L74 5 L100 8 L122 16 L142 28 L138 30 L116 18 L84 8 L58 8 L34 16 Z",
    shadow="M18 38 L138 38 L138 42 L18 42 Z",
    spokes=5,
)

# Huracan / Lambo: ultra-low wedge, sharp angles
VEHICLES["huracan"] = dict(
    comment="Huracan-like low wedge supercar",
    body="M4 40 L18 30 L40 16 L68 8 L100 6 L128 12 L150 26 L148 38 L136 42 L18 42 Z",
    glass="M62 10 L90 8 L114 16 L116 26 L92 28 L64 20 Z",
    highlight="M14 30 L42 14 L70 8 L104 6 L132 14 L148 28 L144 30 L122 16 L90 10 L62 12 L36 20 Z",
    shadow="M18 38 L136 38 L136 42 L18 42 Z",
    wr=8.8,
    rear=(44, 42),
    front=(124, 42),
    spokes=5,
)

# Chiron: hypercar, massive rear, long low
VEHICLES["chiron"] = dict(
    comment="Chiron-like hypercar",
    body="M2 40 L14 30 L36 16 L64 8 L96 5 L124 8 L148 20 L154 32 L150 38 L138 42 L14 42 Z",
    glass="M60 9 L90 7 L116 14 L120 26 L94 28 L62 18 Z",
    highlight="M10 30 L38 14 L68 7 L100 5 L128 10 L148 22 L150 32 L146 34 L130 18 L96 8 L64 10 L34 20 Z",
    shadow="M14 38 L138 38 L138 42 L14 42 Z",
    extras='<path fill="url(#paint)" d="M72 5 L92 1 L100 8 L80 10 Z"/>',
    wr=9.0,
    rear=(40, 42),
    front=(128, 42),
    spokes=5,
)

# Model X / crossover EV
VEHICLES["model-x"] = dict(
    comment="Model X-like crossover EV",
    body="M8 38 L14 24 L30 10 L52 4 L100 4 L126 10 L146 24 L152 34 L148 40 L138 42 L18 42 Z",
    glass="M44 7 L72 5 L108 6 L126 12 L128 26 L48 26 L44 12 Z",
    highlight="M16 24 L34 10 L56 4 L104 4 L130 12 L148 26 L144 28 L124 14 L96 6 L64 6 L40 12 L24 22 Z",
    shadow="M18 38 L138 38 L138 42 L18 42 Z",
    extras='<path fill="none" stroke="#555" stroke-width="0.45" opacity="0.35" d="M72 7 L72 38"/><path fill="none" stroke="#555" stroke-width="0.45" opacity="0.35" d="M104 8 L104 38"/>',
    wr=9.5,
    rear=(40, 42),
    front=(124, 42),
    spokes=5,
)

# Cybertruck: angular stainless wedge
VEHICLES["cybertruck"] = dict(
    comment="Cybertruck angular pickup",
    body="M4 42 L8 24 L52 4 L148 4 L154 24 L148 42 Z",
    glass="M40 8 L70 6 L110 6 L132 12 L130 28 L42 28 L38 14 Z",
    highlight="M8 24 L52 4 L148 4 L148 10 L56 10 L20 24 Z",
    shadow="M10 38 L148 38 L148 42 L10 42 Z",
    extras='<path fill="none" stroke="#666" stroke-width="0.6" opacity="0.4" d="M70 8 L70 40"/>',
    wr=9.5,
    rear=(36, 42),
    front=(130, 42),
    spokes=5,
)

# NSX: mid-engine, flowing Japanese supercar
VEHICLES["nsx"] = dict(
    comment="NSX-like mid-engine coupe",
    body="M6 40 L18 28 L40 14 L68 6 L100 6 L128 14 L150 28 L148 38 L136 42 L18 42 Z",
    glass="M60 9 L88 8 L112 16 L114 26 L90 28 L62 18 Z",
    highlight="M14 28 L42 12 L72 6 L104 6 L132 16 L148 30 L144 32 L122 18 L90 10 L62 10 L36 18 Z",
    shadow="M18 38 L136 38 L136 42 L18 42 Z",
    wr=8.8,
    rear=(44, 42),
    front=(124, 42),
    spokes=5,
)

# AMG GT: long hood GT, cab rearward
VEHICLES["amg-gt"] = dict(
    comment="AMG GT-like long-hood GT",
    body="M4 40 L12 28 L28 16 L50 8 L78 5 L104 7 L128 16 L148 28 L152 36 L146 40 L136 42 L16 42 Z",
    glass="M66 8 L90 7 L110 14 L114 26 L92 28 L68 18 Z",
    highlight="M12 28 L32 14 L56 7 L84 5 L112 10 L134 20 L148 30 L144 32 L122 18 L90 8 L62 10 L36 18 Z",
    shadow="M16 38 L136 38 L136 42 L16 42 Z",
    wr=9.0,
    rear=(44, 42),
    front=(126, 42),
    spokes=5,
)

# BMW M3: 4-door coupe/sedan sport, kidney-less silhouette
VEHICLES["m3"] = dict(
    comment="M3-like sport sedan",
    body="M8 38 L14 26 L28 14 L48 8 L72 6 L108 6 L130 14 L148 26 L152 36 L146 40 L138 42 L18 42 Z",
    glass="M48 9 L68 7 L100 8 L118 14 L120 24 L96 26 L70 24 L50 16 Z",
    highlight="M16 26 L32 14 L54 8 L80 6 L114 6 L134 14 L148 28 L144 30 L126 16 L96 8 L68 8 L46 12 L28 18 Z",
    shadow="M18 38 L138 38 L138 42 L18 42 Z",
    extras='<path fill="none" stroke="#555" stroke-width="0.4" opacity="0.35" d="M68 9 L68 38"/><path fill="none" stroke="#555" stroke-width="0.4" opacity="0.35" d="M96 10 L96 38"/>',
    spokes=5,
)

# Golf GTI hatch
VEHICLES["golf"] = dict(
    comment="Golf hatch-like compact",
    body="M16 38 L22 26 L36 14 L54 9 L86 8 L110 14 L126 26 L132 36 L128 40 L120 42 L26 42 Z",
    glass="M50 11 L76 9 L104 14 L114 26 L110 30 L78 28 L52 18 Z",
    highlight="M24 26 L40 14 L60 9 L90 8 L114 14 L128 28 L124 30 L106 16 L82 10 L56 12 L38 18 Z",
    shadow="M26 38 L120 38 L120 42 L26 42 Z",
    wr=8.6,
    rear=(40, 42),
    front=(116, 42),
    spokes=5,
)

# Tahoe / full-size SUV
VEHICLES["tahoe"] = dict(
    comment="Tahoe-like full-size SUV",
    body="M6 40 L12 26 L26 12 L44 4 L108 4 L132 10 L148 24 L152 36 L148 42 L18 42 Z",
    glass="M42 7 L68 5 L104 5 L126 10 L128 26 L46 26 L42 12 Z",
    highlight="M14 26 L30 12 L50 4 L112 4 L136 12 L150 26 L146 28 L128 14 L100 6 L60 6 L36 12 L22 22 Z",
    shadow="M18 38 L148 38 L148 42 L18 42 Z",
    extras='<path fill="none" stroke="#555" stroke-width="0.45" opacity="0.35" d="M68 7 L68 38"/><path fill="none" stroke="#555" stroke-width="0.45" opacity="0.35" d="M100 7 L100 38"/>',
    wr=10.0,
    rear=(38, 42),
    front=(126, 42),
    spokes=5,
)

# Class: coupe
VEHICLES["coupe"] = dict(
    comment="Generic coupe class",
    body="M8 38 L14 26 L26 14 L48 7 L74 5 L100 8 L124 16 L146 28 L152 36 L146 40 L136 42 L18 42 Z",
    glass="M50 9 L72 7 L98 12 L112 22 L108 26 L76 24 L52 16 Z",
    highlight="M16 26 L30 14 L52 7 L80 5 L106 10 L128 18 L146 30 L142 32 L120 20 L88 8 L58 10 L34 16 Z",
    shadow="M18 38 L136 38 L136 42 L18 42 Z",
    spokes=5,
)

# Class: sedan
VEHICLES["sedan"] = dict(
    comment="Generic sedan class",
    body="M10 38 L16 26 L30 14 L52 8 L78 6 L104 8 L126 16 L146 28 L150 36 L144 40 L134 42 L20 42 Z",
    glass="M48 10 L70 8 L100 10 L116 18 L114 26 L90 26 L72 24 L50 16 Z",
    highlight="M18 26 L34 14 L56 8 L84 6 L110 8 L130 16 L146 30 L142 32 L122 18 L96 10 L70 10 L48 14 L32 20 Z",
    shadow="M20 38 L134 38 L134 42 L20 42 Z",
    extras='<path fill="none" stroke="#555" stroke-width="0.4" opacity="0.3" d="M70 10 L70 38"/><path fill="none" stroke="#555" stroke-width="0.4" opacity="0.3" d="M96 12 L96 38"/>',
    spokes=5,
)

# Class: SUV
VEHICLES["suv"] = dict(
    comment="Generic SUV class",
    body="M8 40 L14 26 L28 12 L46 5 L108 5 L130 12 L148 26 L152 36 L148 42 L18 42 Z",
    glass="M44 8 L70 6 L106 6 L126 12 L128 26 L48 26 L44 12 Z",
    highlight="M16 26 L32 12 L52 5 L112 5 L134 14 L150 28 L146 30 L126 16 L96 7 L64 7 L40 12 L24 22 Z",
    shadow="M18 38 L148 38 L148 42 L18 42 Z",
    extras='<path fill="none" stroke="#555" stroke-width="0.45" opacity="0.35" d="M70 8 L70 38"/><path fill="none" stroke="#555" stroke-width="0.45" opacity="0.35" d="M104 8 L104 38"/>',
    wr=9.8,
    rear=(40, 42),
    front=(124, 42),
    spokes=5,
)

# Class: hypercar
VEHICLES["hypercar"] = dict(
    comment="Generic hypercar class",
    body="M4 40 L16 30 L40 16 L70 8 L104 6 L132 12 L152 26 L150 36 L138 42 L18 42 Z",
    glass="M64 10 L94 8 L118 16 L120 26 L96 28 L66 18 Z",
    highlight="M12 30 L42 14 L74 8 L108 6 L136 14 L150 28 L146 30 L126 16 L94 10 L66 12 L38 20 Z",
    shadow="M18 38 L138 38 L138 42 L18 42 Z",
    wr=8.8,
    rear=(44, 42),
    front=(124, 42),
    spokes=5,
)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for key, cfg in sorted(VEHICLES.items()):
        svg = sprite(key, **cfg)
        path = OUT / f"{key}.svg"
        path.write_text(svg, encoding="utf-8")
        print(f"wrote {path.name} ({len(svg)} bytes)")
    print(f"total {len(VEHICLES)} sprites → {OUT}")


if __name__ == "__main__":
    main()
