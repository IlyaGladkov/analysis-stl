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
  --price-per-kg 24 \
  --electricity 0.12 \
  --machine-rate 1.20 \
  --operator-rate 15 \
  --profit-margin 20 \
  --output ./output
```

---

## CLI Reference

### `analyze <file>` command

```
node src/index.js analyze <file> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-m, --material <name>` | `PLA` | Material: `PLA`, `ABS`, `PETG`, `TPU`, `ASA`, `Nylon`, `Resin` |
| `-p, --printer <name>` | `generic FDM` | Printer preset (see `list-printers`) |
| `-l, --layer-height <mm>` | `0.2` | Layer height in mm |
| `-n, --nozzle <mm>` | `0.4` | Nozzle diameter in mm |
| `-i, --infill <pct>` | `20` | Infill percentage (0–100) |
| `-s, --shells <n>` | `3` | Number of perimeter shell walls |
| `-a, --overhang-angle <deg>` | `45` | Overhang support threshold in degrees |
| `-k, --price-per-kg <usd>` | preset | Material price per kg (USD) |
| `-e, --electricity <usd/kwh>` | `0.12` | Electricity price per kWh |
| `-r, --machine-rate <usd/h>` | preset | Machine depreciation cost per hour |
| `--operator-rate <usd/h>` | `0` | Operator hourly labor rate |
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

| Material | Density (g/cm³) | Default Price/kg |
|----------|-----------------|------------------|
| PLA | 1.24 | $20.00 |
| ABS | 1.04 | $22.00 |
| PETG | 1.27 | $24.00 |
| TPU | 1.21 | $35.00 |
| ASA | 1.07 | $28.00 |
| Nylon | 1.14 | $45.00 |
| Resin | 1.10 | $50.00 |

---

## Printer Presets

| Printer | Speed (mm/s) | Power (W) | Rate ($/h) |
|---------|-------------|-----------|-----------|
| Ender 3 | 50 | 120 | $0.50 |
| Prusa MK4 | 80 | 150 | $1.20 |
| Bambu Lab X1C | 150 | 350 | $2.00 |
| Creality K1 Max | 120 | 300 | $1.50 |
| Formlabs Form 3 | 20 | 85 | $5.00 |
| generic FDM | 60 | 150 | $0.75 |

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
  --price-per-kg 26 \
  --operator-rate 20 \
  --profit-margin 30
```

### High-quality print settings

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

---

## Limitations & Notes

- **Slicer accuracy**: The slicer is a geometric engine — it does not generate G-code. Print time and filament estimates are approximations comparable to a first-pass slicer estimate (±10–20%). For production use, cross-validate with Cura/PrusaSlicer.
- **Support style**: Supports are generated as vertical cylindrical pillars (FDM-style). Tree supports, raft, and brim are not modelled.
- **Non-watertight models**: Volume calculation will still run on non-manifold meshes but may give incorrect results. Repair the model first with Meshmixer/PrusaSlicer/Netfabb for accurate results.
- **Large files**: Models with >500k triangles may take 10–30 seconds for the integrity check and slicer step. The slicer pre-buckets triangles by Z range to avoid O(n²) complexity.
- **ASCII STL**: Both binary and ASCII STL formats are supported. Binary is preferred for performance.

---

## License

MIT