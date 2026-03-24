# STL Analyzer

> **Volume · Integrity · Slicer · Cost Estimation**

A comprehensive Node.js tool for analyzing STL (Stereolithography) 3D model files. It calculates physical properties, checks mesh integrity, performs layer-by-layer slicing, detects overhangs requiring support structures, and estimates print cost based on real slicer calculations — not just bounding box volume.

---

## Features

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Volume Analysis** | Calculates exact model volume (cm³/mm³/in³), weight, surface area, bounding box, center of mass, and fill ratio |
| 2 | **Mesh Integrity** | Detects open holes (boundary edges), non-manifold geometry, degenerate/duplicate triangles, flipped normals, Euler characteristic, and shell count |
| 3 | **Layer Slicer** | Performs real triangle–plane intersection slicing, chains segments into closed contours, computes per-layer area and filament usage |
| 4 | **Support Detection** | Identifies overhang triangles exceeding the angle threshold (default 45°), generates support pillar geometry, and exports a support STL file |
| 5 | **Cost Estimation** | Estimates material cost, machine time cost, electricity cost, and labor — based on actual slicer data, not bounding box approximations |
| 6 | **JSON Reports** | Writes a complete machine-readable JSON report for every analysis run |
| 7 | **STL Output** | Exports `model + supports` and `supports only` binary STL files |

---

## Stack

- **Runtime**: Node.js (CommonJS)
- **STL parsing/volume**: [`node-stl`](https://github.com/johannesboyne/node-stl)
- **CLI**: [`commander`](https://github.com/tj/commander.js)
- **Terminal output**: [`chalk`](https://github.com/chalk/chalk) + [`cli-table3`](https://github.com/cli-utils/cli-table3)
- **File utilities**: [`fs-extra`](https://github.com/jprichardson/node-fs-extra)

---

## Installation

```bash
git clone <repo-url>
cd stl-analyzer
npm install
```

---

## Quick Start

### Run the demo (generates 5 sample models and analyses each)

```bash
npm run demo
# or
node src/demo.js
```

This will:
1. Generate sample STL files (cube, sphere, cylinder, torus, overhang test model) in `./samples/`
2. Run full analysis on each model
3. Print colour reports to the terminal
4. Write JSON reports and support STL files to `./output/demo/`

---

### Analyse your own STL file

```bash
node src/index.js analyze path/to/your_model.stl
```

**With all options:**

```bash
node src/index.js analyze path/to/model.stl \
  --material PETG \
  --printer "Prusa MK4" \
  --layer-height 0.15 \
  --nozzle 0.4 \
  --infill 25 \
  --shells 3 \
  --overhang-angle 45 \
  --price-per-kg 2000 \
  --electricity 6.5 \
  --machine-rate 75 \
  --operator-rate 500 \
  --profit-margin 20 \
  --output ./output
```

> All prices are in **roubles (₽)**.

---

## CLI Reference

### `analyze <file>` command

```
node src/index.js analyze <file> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-m, --material <name>` | `PLA` | Material preset key (see `list-materials`) |
| `-p, --printer <name>` | `Стандартный FDM` | Printer preset (see `list-printers`) |
| `-l, --layer-height <mm>` | `0.2` | Layer height in mm |
| `-n, --nozzle <mm>` | `0.4` | Nozzle diameter in mm |
| `-i, --infill <pct>` | `20` | Infill percentage (0–100) |
| `-s, --shells <n>` | `3` | Number of perimeter shell walls |
| `-a, --overhang-angle <deg>` | `45` | Overhang support threshold in degrees |
| `-k, --price-per-kg <₽>` | preset | Material price per kg (₽) |
| `-e, --electricity <₽/kwh>` | `6.5` | Electricity price per kWh (₽) |
| `-r, --machine-rate <₽/h>` | preset | Machine depreciation cost per hour (₽) |
| `--operator-rate <₽/h>` | `0` | Operator hourly labor rate (₽) |
| `--profit-margin <pct>` | `0` | Profit markup percentage |
| `--filament-diameter <mm>` | `1.75` | Filament spool diameter |
| `--waste-factor <n>` | `1.05` | Waste multiplier (e.g. 1.05 = 5% waste) |
| `-o, --output <dir>` | `./output` | Directory for output files |
| `--no-support-stl` | — | Skip writing support STL files |
| `--only <steps>` | all | Run only specific steps: `volume,integrity,slicer,cost` |

### Helper commands

```bash
# List available material presets with densities and prices
node src/index.js list-materials

# List available printer presets with speeds and costs
node src/index.js list-printers
```

---

## Analysis Steps

### 1. Volume Analysis

Uses `node-stl` under the hood which computes volume via the **signed tetrahedron** method (Gauss divergence theorem). Results include:

- Volume in cm³, mm³, and in³
- Weight (based on material density)
- Surface area
- Bounding box dimensions (W × D × H in mm)
- Bounding box fill ratio (how efficiently the model fills its bounding box)
- Center of mass

### 2. Mesh Integrity

A fully custom manifold checker that runs:

| Check | Method |
|-------|--------|
| **Open holes** | Every edge must be shared by exactly 2 triangles. Edges shared by only 1 triangle are boundary edges (holes). |
| **Non-manifold geometry** | Edges shared by 3+ triangles indicate geometry that cannot be printed. |
| **Degenerate triangles** | Triangles with zero or near-zero area. |
| **Duplicate triangles** | Identical triangles (order-independent vertex matching). |
| **Flipped normals** | Stored normals compared against cross-product computed normals. Dot product < –0.1 indicates inversion. |
| **Euler characteristic** | χ = V − E + F must equal 2 for a closed orientable surface. |
| **Shell count** | Union-Find algorithm to count disconnected bodies. |

### 3. Slicing & Support Detection

**Slicing algorithm:**
1. Find Z extents of the model
2. For each layer at `Z = minZ + (i + 0.5) × layerHeight`:
   - Intersect every triangle with the horizontal plane → line segments
   - Chain unordered segments into closed contours (polygons) via adjacency graph
   - Compute layer area (shoelace formula) and filament volume estimate

**Support detection:**
1. For each triangle, compute the actual face normal from vertex cross-product
2. If `dot(faceNormal, -Z) > cos(overhangAngle)` → triangle is an overhang
3. Overhangs touching the build plate are excluded
4. One cylindrical support pillar is placed at the centroid of each overhang triangle
5. Nearby pillars are merged to avoid redundant structures
6. Pillars are tessellated into binary STL triangles (octagonal prism)

**Filament estimate per layer:**

```
shellVolume  = perimeter × nozzleDiameter × layerHeight × shellCount
infillVolume = innerArea × layerHeight × infillDensity
layerVolume  = shellVolume + infillVolume
```

### 4. Cost Estimation

All costs derive from **real slicer output**, not bounding box approximations.

**Print time model:**

```
For each layer:
  shellTime  = (perimeter × shellCount) / printSpeed
  infillTime = (area / lineSpacing) / printSpeed
  travelTime = perimeter × 0.05 / travelSpeed

totalTime = Σ layerTimes + warmupOverhead (5 min)
```

**Cost breakdown:**

| Component | Formula |
|-----------|---------|
| Material | `totalWeight (g) × pricePerGram` |
| Machine | `printTimeHours × machineHourRate` |
| Electricity | `(powerWatts / 1000) × printTimeHours × electricityRate` |
| Labor | `operatorRate × (prepTime + postProcessTime) / 60` |
| **Total** | `(material + machine + electricity + labor) × (1 + profitMargin%)` |

---

## Material Presets

All prices are in **roubles (₽) per kg**.

### PLA и вариации

| Key | Label | Density (g/cm³) | Price (₽/kg) |
|-----|-------|-----------------|--------------|
| `PLA` | PLA (стандартный) | 1.24 | 1 800 |
| `PLA+` | PLA+ (усиленный) | 1.24 | 2 200 |
| `PLA Silk` | PLA Silk (шёлковый) | 1.24 | 2 500 |
| `PLA Matte` | PLA Matte (матовый) | 1.24 | 2 300 |
| `PLA Metal` | PLA Metal (металлизированный) | 1.60 | 3 500 |
| `PLA Wood` | PLA Wood (с древесным наполнением) | 1.15 | 3 000 |
| `PLA Marble` | PLA Marble (под мрамор) | 1.27 | 2 800 |
| `PLA Glow` | PLA Glow (светящийся) | 1.24 | 2 600 |
| `PLA-CF` | PLA Carbon Fiber (с углеволокном) | 1.30 | 4 500 |
| `PLA HT` | PLA HT (термостойкий) | 1.24 | 3 200 |

### ABS / ASA

| Key | Label | Density (g/cm³) | Price (₽/kg) |
|-----|-------|-----------------|--------------|
| `ABS` | ABS (стандартный) | 1.04 | 1 600 |
| `ABS+` | ABS+ (усиленный) | 1.04 | 2 000 |
| `ABS-CF` | ABS Carbon Fiber (с углеволокном) | 1.10 | 4 800 |
| `ASA` | ASA (УФ-стойкий) | 1.07 | 2 400 |
| `ASA-CF` | ASA Carbon Fiber (с углеволокном) | 1.12 | 5 000 |

### PETG

| Key | Label | Density (g/cm³) | Price (₽/kg) |
|-----|-------|-----------------|--------------|
| `PETG` | PETG (стандартный) | 1.27 | 2 000 |
| `PETG-CF` | PETG Carbon Fiber (с углеволокном) | 1.35 | 4 500 |
| `PETG Silk` | PETG Silk (шёлковый) | 1.27 | 2 600 |
| `PETG HF` | PETG High Flow (высокоскоростной) | 1.27 | 2 800 |

### TPU / Гибкие

| Key | Label | Density (g/cm³) | Price (₽/kg) |
|-----|-------|-----------------|--------------|
| `TPU` | TPU (гибкий, 95A) | 1.21 | 3 200 |
| `TPU 85A` | TPU 85A (мягкий) | 1.20 | 3 500 |
| `TPU 98A` | TPU 98A (жёсткий) | 1.22 | 3 100 |
| `TPE` | TPE (эластомер) | 1.18 | 3 800 |
| `TPU95HF` | TPU HF (высокоскоростной) | 1.21 | 3 600 |

### Нейлон

| Key | Label | Density (g/cm³) | Price (₽/kg) |
|-----|-------|-----------------|--------------|
| `Nylon` | Нейлон PA6 | 1.14 | 4 000 |
| `Nylon PA12` | Нейлон PA12 | 1.01 | 4 500 |
| `Nylon CF` | Нейлон Carbon Fiber (с углеволокном) | 1.20 | 7 500 |
| `Nylon GF` | Нейлон Glass Fiber (со стекловолокном) | 1.35 | 6 000 |
| `Nylon+` | Нейлон PA6+ (усиленный) | 1.14 | 5 000 |

### Высокотемпературные

| Key | Label | Density (g/cm³) | Price (₽/kg) |
|-----|-------|-----------------|--------------|
| `PC` | Поликарбонат (PC) | 1.20 | 5 000 |
| `PC-CF` | PC Carbon Fiber (с углеволокном) | 1.27 | 8 000 |
| `PC-ABS` | PC-ABS (сплав) | 1.10 | 4 000 |
| `PEEK` | PEEK (высокоэффективный) | 1.32 | 35 000 |
| `PEI` | PEI / Ultem (жаростойкий) | 1.27 | 25 000 |
| `PEKK` | PEKK (авиационный) | 1.30 | 40 000 |
| `PPS` | PPS (химически стойкий) | 1.35 | 28 000 |
| `PSU` | PSU (полисульфон) | 1.24 | 22 000 |
| `HIPS` | HIPS (растворимые поддержки) | 1.04 | 1 700 |

### Специальные / Экзотические

| Key | Label | Density (g/cm³) | Price (₽/kg) |
|-----|-------|-----------------|--------------|
| `PVOH` | PVA / PVOH (водорастворимые поддержки) | 1.23 | 12 000 |
| `PP` | Полипропилен (PP) | 0.90 | 3 500 |
| `PP-CF` | PP Carbon Fiber (с углеволокном) | 1.00 | 6 500 |
| `PMMA` | PMMA / Акрил (прозрачный) | 1.19 | 4 500 |
| `Co-Polyester` | Co-Polyester (Amphora) | 1.23 | 3 800 |
| `PVB` | PVB (полируемый) | 1.19 | 5 000 |

### Фотополимеры (SLA / MSLA / DLP)

| Key | Label | Density (g/cm³) | Price (₽/kg) |
|-----|-------|-----------------|--------------|
| `Resin` | Фотополимер стандартный | 1.10 | 4 500 |
| `Resin ABS-like` | Фотополимер ABS-подобный | 1.10 | 5 000 |
| `Resin Tough` | Фотополимер Tough (ударопрочный) | 1.15 | 6 000 |
| `Resin Flexible` | Фотополимер Flexible (гибкий) | 1.10 | 7 000 |
| `Resin Castable` | Фотополимер Castable (для литья) | 1.05 | 12 000 |
| `Resin Dental` | Фотополимер Dental (стоматологический) | 1.15 | 20 000 |
| `Resin Water-Washable` | Фотополимер водосмываемый | 1.10 | 5 500 |
| `Resin 8K` | Фотополимер 8K (высокодетализированный) | 1.10 | 5 000 |

---

## Printer Presets

All rates are in **roubles (₽) per hour**.

### FDM — Creality

| Printer | Speed (mm/s) | Power (W) | Rate (₽/h) |
|---------|-------------|-----------|------------|
| Ender 3 | 50 | 120 | 30 |
| Ender 3 V3 SE | 80 | 150 | 40 |
| Ender 3 S1 Pro | 60 | 200 | 45 |
| Creality K1 | 200 | 350 | 85 |
| Creality K1 Max | 120 | 300 | 90 |
| Creality K2 Plus | 300 | 500 | 130 |
| Neptune 4 Pro | 150 | 280 | 55 |
| Neptune 4 Max | 150 | 350 | 65 |

### FDM — Prusa

| Printer | Speed (mm/s) | Power (W) | Rate (₽/h) |
|---------|-------------|-----------|------------|
| Prusa MINI+ | 60 | 90 | 50 |
| Prusa MK3S+ | 60 | 120 | 60 |
| Prusa MK4 | 80 | 150 | 75 |
| Prusa XL | 80 | 200 | 100 |

### FDM — Bambu Lab

| Printer | Speed (mm/s) | Power (W) | Rate (₽/h) |
|---------|-------------|-----------|------------|
| Bambu Lab A1 Mini | 100 | 200 | 65 |
| Bambu Lab A1 | 100 | 250 | 75 |
| Bambu Lab P1P | 150 | 300 | 95 |
| Bambu Lab P1S | 150 | 320 | 110 |
| Bambu Lab X1C | 150 | 350 | 120 |
| Bambu Lab X1E | 150 | 400 | 140 |

### FDM — Voron

| Printer | Speed (mm/s) | Power (W) | Rate (₽/h) |
|---------|-------------|-----------|------------|
| Voron 0.2 | 100 | 120 | 60 |
| Voron Trident | 150 | 350 | 95 |
| Voron 2.4 | 150 | 400 | 100 |

### FDM — Прочие

| Printer | Speed (mm/s) | Power (W) | Rate (₽/h) |
|---------|-------------|-----------|------------|
| Artillery Genius Pro | 80 | 180 | 45 |
| Artillery Sidewinder X3 Pro | 150 | 350 | 70 |
| AnkerMake M5C | 167 | 300 | 80 |
| AnkerMake M7 | 167 | 350 | 95 |
| FlashForge Adventurer 5M | 167 | 300 | 75 |
| FlashForge Creator 3 Pro | 80 | 800 | 120 |
| Qidi X-Max 3 | 200 | 350 | 90 |
| Qidi Tech X-CF Pro | 100 | 400 | 110 |
| RatRig V-Core 4 | 200 | 500 | 115 |
| Стандартный FDM | 60 | 150 | 45 |

### SLA / MSLA / DLP — Фотополимерные

| Printer | Speed (mm/s) | Power (W) | Rate (₽/h) |
|---------|-------------|-----------|------------|
| SparkMaker Ultra | 20 | 60 | 70 |
| Anycubic Photon Mono X2 | 25 | 80 | 85 |
| Elegoo Mars 4 Ultra | 30 | 80 | 90 |
| Anycubic Photon M7 Pro | 35 | 100 | 100 |
| Phrozen Sonic Mega 8K S | 30 | 130 | 130 |
| Elegoo Saturn 4 Ultra | 30 | 120 | 120 |
| Formlabs Form 3 | 20 | 85 | 300 |
| Formlabs Form 3L | 20 | 120 | 450 |
| Formlabs Form 4 | 40 | 100 | 350 |
| Стандартный MSLA | 25 | 90 | 90 |

### Промышленные / Профессиональные

| Printer | Speed (mm/s) | Power (W) | Rate (₽/h) |
|---------|-------------|-----------|------------|
| Ultimaker S5 | 60 | 300 | 320 |
| Ultimaker S7 | 70 | 350 | 400 |
| MakerBot Method X | 75 | 250 | 350 |
| Markforged Mark Two | 40 | 200 | 600 |
| Stratasys F170 | 30 | 1 100 | 800 |
| HP Jet Fusion 5200 | 10 | 3 000 | 2 500 |

---

## Project Structure

```
stl-analyzer/
├── src/
│   ├── index.js                      # CLI entry point (commander)
│   ├── demo.js                       # Demo runner
│   ├── analyzers/
│   │   ├── volumeAnalyzer.js         # Volume, weight, bbox via node-stl
│   │   ├── integrityAnalyzer.js      # Manifold/watertight mesh checker
│   │   └── costEstimator.js          # Print cost calculation
│   ├── slicer/
│   │   └── slicerEngine.js           # Layer slicer + support generator
│   └── utils/
│       ├── stlParser.js              # Binary & ASCII STL parser/writer
│       ├── reporter.js               # Colour terminal reporter
│       └── generateSampleStl.js      # Procedural STL shape generator
├── samples/                          # Generated sample STL files
├── output/                           # Analysis output files
│   └── demo/                         # Demo run output
├── package.json
└── README.md
```

---

## Output Files

For each analysis run, the following files are written to the output directory:

| File | Description |
|------|-------------|
| `<model>_<timestamp>_report.json` | Full machine-readable report with all analysis data |
| `<model>_<timestamp>_with_supports.stl` | Binary STL: original model merged with support structures |
| `<model>_<timestamp>_supports_only.stl` | Binary STL: support structures only (for reference/inspection) |

### JSON Report Structure

```json
{
  "meta": { "generatedAt", "analyzer", "inputFile", "triangleCount" },
  "settings": { "material", "printer", "layerHeight", "nozzleDiameter", "infillPercent", ... },
  "volume": {
    "volumeCm3", "volumeMm3", "weightGrams", "areaMm2",
    "boundingBox": { "x", "y", "z" },
    "centerOfMass": { "x", "y", "z" },
    "fillRatio"
  },
  "integrity": {
    "isWatertight", "verdict", "errors", "warnings",
    "stats": { "triangleCount", "uniqueVertexCount", "edgeCount",
               "boundaryEdges", "nonManifoldEdges", "degenerateTriangles",
               "eulerCharacteristic", "shellCount", ... }
  },
  "slicer": {
    "layerCount", "modelHeight", "supportPillarCount",
    "totalFilamentMm3", "totalSupportMm3", "totalMaterialMm3",
    "supportPillars": [ { "baseX", "baseY", "topZ", "bottomZ", "radius" } ],
    "layers": [ { "layerIndex", "zBottom", "zTop", "contourCount",
                  "areaMm2", "filamentMm3", "hasSupportAt" } ]
  },
  "cost": {
    "totalCost", "totalFormatted",
    "filament": { "totalWeightGrams", "totalLengthM", "totalVolumeMm3", ... },
    "time": { "printTimeFormatted", "printTimeSec", "energyKwh" },
    "breakdown": { "materialCost", "machineCost", "electricityCost", "laborCost", "subtotal" },
    "metrics": { "costPerGram", "costPerCm3", "costPerLayer", "materialPercent", ... }
  }
}
```

---

## Examples

### Only check volume and integrity (skip slicer and cost)

```bash
node src/index.js analyze model.stl --only volume,integrity
```

### Price quote with 30% margin for a PETG model

```bash
node src/index.js analyze model.stl \
  --material PETG \
  --price-per-kg 2000 \
  --operator-rate 500 \
  --profit-margin 30
```

### High-quality print on Bambu Lab X1C

```bash
node src/index.js analyze model.stl \
  --layer-height 0.1 \
  --infill 40 \
  --shells 4 \
  --printer "Bambu Lab X1C"
```

### Draft / fast print

```bash
node src/index.js analyze model.stl \
  --layer-height 0.3 \
  --infill 15 \
  --shells 2
```

### Engineering part in Nylon CF on Voron 2.4

```bash
node src/index.js analyze model.stl \
  --material "Nylon CF" \
  --printer "Voron 2.4" \
  --layer-height 0.15 \
  --infill 50 \
  --shells 4 \
  --profit-margin 25
```

### Resin print on Elegoo Saturn 4 Ultra

```bash
node src/index.js analyze model.stl \
  --material "Resin Tough" \
  --printer "Elegoo Saturn 4 Ultra" \
  --layer-height 0.05 \
  --infill 100 \
  --shells 2
```

---

## Limitations & Notes

- **Slicer accuracy**: The slicer is a geometric engine — it does not generate G-code. Print time and filament estimates are approximations comparable to a first-pass slicer estimate (±10–20%). For production use, cross-validate with Cura/PrusaSlicer/Bambu Studio.
- **Support style**: Supports are generated as vertical cylindrical pillars (FDM-style). Tree supports, raft, and brim are not modelled.
- **Resin printing**: When using resin materials and SLA/MSLA printers, set `--infill 100` and `--shells 2` since resin parts are typically solid.
- **Non-watertight models**: Volume calculation will still run on non-manifold meshes but may give incorrect results. Repair the model first with Meshmixer/PrusaSlicer/Netfabb for accurate results.
- **Large files**: Models with >500k triangles may take 10–30 seconds for the integrity check and slicer step. The slicer pre-buckets triangles by Z range to avoid O(n²) complexity.
- **ASCII STL**: Both binary and ASCII STL formats are supported. Binary is preferred for performance.

---

## License

MIT