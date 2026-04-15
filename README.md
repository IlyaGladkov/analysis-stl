# STL Analyzer

> **Volume · Integrity · Slicer · Cost Estimation**

A comprehensive Node.js library for analyzing STL (Stereolithography) 3D model files. It calculates physical properties, checks mesh integrity, performs layer-by-layer slicing, detects overhangs requiring support structures, and estimates print cost based on real slicer calculations — not just bounding box volume.

**Use it as:**
- 📦 **Library** in your Node.js/Electron projects
- 🖥️ **CLI tool** for analyzing STL files from the command line
- 🔧 **Toolkit** for building 3D printing automation workflows

---

## Features

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Volume Analysis** | Calculates exact model volume (cm³/mm³/in³), weight, surface area, bounding box, center of mass, and fill ratio |
| 2 | **Mesh Integrity** | Detects open holes, non-manifold geometry, degenerate triangles, flipped normals, Euler characteristic, and shell count |
| 3 | **Layer Slicer** | Performs real triangle–plane intersection slicing, chains segments into closed contours, computes per-layer area and filament usage |
| 4 | **Support Detection** | Identifies overhang triangles, generates support pillar geometry, and exports support STL files |
| 5 | **Cost Estimation** | Estimates material, machine time, electricity, and labor costs — based on actual slicer data |
| 6 | **JSON Reports** | Writes complete machine-readable JSON report for every analysis |
| 7 | **STL Output** | Exports model+supports and supports-only binary STL files |

---

## Installation

### As an npm package

```bash
npm install stl-analyzer
```

### Global CLI tool

```bash
npm install -g stl-analyzer
stl-analyzer analyze model.stl
```

### Development setup

```bash
git clone https://github.com/yourusername/stl-analyzer.git
cd stl-analyzer
npm install
npm run demo
```

---

## Quick Start

### Library Usage

```javascript
const {
  analyzeVolume,
  analyzeIntegrity,
  slice,
  estimateCost,
  parseSTL,
  writeBinarySTL,
} = require('stl-analyzer');

// Analyze volume
const volumeResult = analyzeVolume('model.stl', { material: 'PLA' });
console.log(`Volume: ${volumeResult.volumeCm3} cm³`);
console.log(`Weight: ${volumeResult.weightGrams} g`);

// Check mesh integrity
const triangles = parseSTL('model.stl');
const integrityResult = analyzeIntegrity(triangles);
console.log(`Watertight: ${integrityResult.isWatertight}`);

// Slice and detect supports
const slicerResult = slice(triangles, {
  layerHeight: 0.2,
  overhangAngle: 45,
  nozzleDiameter: 0.4,
  infillDensity: 0.2,
  shellCount: 3,
});
console.log(`Layers: ${slicerResult.layerCount}`);
console.log(`Supports needed: ${slicerResult.supportPillarCount}`);

// Estimate cost
const costResult = estimateCost(slicerResult, {
  material: 'PLA',
  printer: 'Prusa MK4',
  materialPricePerKg: 1800,
  electricityPricePerKwh: 6.5,
});
console.log(`Total cost: ${costResult.totalCostFormatted}`);
```

### CLI Usage

```bash
# Basic analysis
stl-analyzer analyze model.stl

# With options
stl-analyzer analyze model.stl \
  --material PETG \
  --layer-height 0.15 \
  --infill 25 \
  --output ./results

# List materials and printers
stl-analyzer list-materials
stl-analyzer list-printers
```

---

## API Reference

### Volume Analysis

#### `analyzeVolume(filePath, options)`

Analyze volume and physical properties.

```javascript
const result = analyzeVolume('model.stl', {
  material: 'PLA',           // Material name (default: 'PLA')
  density: 1.24             // Override density (g/cm³)
});

// Returns:
{
  volumeCm3,               // Volume in cubic centimeters
  volumeMm3,               // Volume in cubic millimeters  
  weightGrams,             // Weight in grams
  areaMm2,                 // Surface area in mm²
  boundingBox: {x, y, z},  // Bounding box dimensions
  centerOfMass: {x, y, z}, // Center of mass
  fillRatio,               // Fill ratio of bounding box
  material,                // Material name
  density                  // Density in g/cm³
}
```

### Mesh Integrity

#### `analyzeIntegrity(triangles)`

Check mesh integrity and manifoldness.

```javascript
const triangles = parseSTL('model.stl');
const result = analyzeIntegrity(triangles);

// Returns:
{
  isWatertight,          // Boolean: is mesh closed?
  verdict,               // String: summary
  errors: [],            // Array of critical issues
  warnings: [],          // Array of warnings
  stats: {
    triangleCount,
    boundaryEdges,       // Holes
    nonManifoldEdges,    // Non-manifold edges
    degenerateTriangles,
    eulerCharacteristic,
    shellCount           // Disconnected bodies
  }
}
```

### Slicing & Support Detection

#### `slice(triangles, options)`

Slice model into layers and detect supports.

```javascript
const result = slice(triangles, {
  layerHeight: 0.2,           // Layer height in mm
  overhangAngle: 45,          // Overhang threshold (degrees)
  nozzleDiameter: 0.4,        // Nozzle diameter in mm
  infillDensity: 0.2,         // Infill ratio (0-1)
  shellCount: 3,              // Shell wall count
  supportType: 'linear',      // 'linear', 'grid', or 'tree'
  airGap: 0.2,                // Gap between model and supports (mm)
  supportSpacing: 1.5         // Support point spacing (mm)
});

// Returns:
{
  layerCount,                // Number of layers
  modelHeight,               // Model Z height (mm)
  supportPillarCount,        // Number of support pillars
  supportTriangles: [],      // Support geometry
  supportPillars: [],        // Support pillar data
  totalFilamentMm3,          // Estimated filament volume
  totalSupportMm3,           // Support volume
  layers: [
    {
      layerIndex,
      zBottom, zTop,         // Layer Z range
      contourCount,          // Contours in layer
      areaMm2,               // Cross-sectional area
      filamentMm3            // Estimated filament
    }
  ]
}
```

### Cost Estimation

#### `estimateCost(slicerResult, options)`

Estimate print cost.

```javascript
const result = estimateCost(slicerResult, {
  material: 'PLA',                  // Material preset or custom
  printer: 'Prusa MK4',             // Printer preset
  materialPricePerKg: 1800,         // Price per kg (₽)
  electricityPricePerKwh: 6.5,      // Electricity rate (₽/kWh)
  machineHourRate: 75,              // Machine cost (₽/h)
  operatorHourlyRate: 0,            // Labor rate (₽/h)
  profitMarginPercent: 0            // Markup percentage
});

// Returns:
{
  totalCost,                // Total cost (₽)
  totalCostFormatted,       // Formatted string
  filament: {
    totalWeightGrams,
    totalVolumeMm3,
    totalCost
  },
  time: {
    printTimeSec,
    printTimeFormatted,
    energyKwh
  },
  breakdown: {
    materialCost,
    machineCost,
    electricityCost,
    laborCost,
    subtotal,
    profitMargin,
    total
  },
  metrics: {
    costPerGram,
    costPerCm3,
    costPerLayer
  }
}
```

### STL Utilities

#### `parseSTL(filePath)`

Parse STL file into triangles.

```javascript
const triangles = parseSTL('model.stl');
// Returns array of {v1, v2, v3, normal} objects
```

#### `writeBinarySTL(triangles, outputPath)`

Write triangles to STL file.

```javascript
writeBinarySTL(slicerResult.supportTriangles, 'supports.stl');
```

#### `getBoundingBox(triangles)`

Get bounding box of geometry.

```javascript
const bbox = getBoundingBox(triangles);
// Returns {min: {x, y, z}, max: {x, y, z}}
```

### Presets

#### `getVolumeMaterialPresets()`

Get materials for volume calculation.

```javascript
const materials = getVolumeMaterialPresets();
// Returns [{name, density, label}, ...]
```

#### `getCostMaterialPresets()`

Get materials for cost estimation.

```javascript
const materials = getCostMaterialPresets();
// Returns [{name, density, pricePerKg, label}, ...]
```

#### `getPrinterPresets()`

Get printer specifications.

```javascript
const printers = getPrinterPresets();
// Returns [{name, printSpeedMmS, powerWatts, pricePerHour}, ...]
```

---

## CLI Commands

### `analyze <file>`

Analyze an STL file.

```bash
stl-analyzer analyze model.stl [options]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `-m, --material <name>` | `PLA` | Material: PLA\|ABS\|PETG\|TPU\|Nylon\|Resin |
| `-p, --printer <name>` | `Стандартный FDM` | Printer preset |
| `-l, --layer-height <mm>` | `0.2` | Layer height in mm |
| `-n, --nozzle <mm>` | `0.4` | Nozzle diameter |
| `-i, --infill <pct>` | `20` | Infill percentage (0-100) |
| `-s, --shells <n>` | `3` | Number of perimeter walls |
| `-a, --overhang-angle <deg>` | `45` | Overhang threshold (degrees) |
| `-k, --price-per-kg <₽>` | preset | Material price per kg |
| `-e, --electricity <₽/kwh>` | `6.5` | Electricity price per kWh |
| `-r, --machine-rate <₽/h>` | preset | Machine cost per hour |
| `--operator-rate <₽/h>` | `0` | Labor rate per hour |
| `--profit-margin <pct>` | `0` | Profit markup |
| `-o, --output <dir>` | `./output` | Output directory |
| `--no-support-stl` | — | Skip writing support STL |
| `--only <steps>` | all | Run specific steps: volume,integrity,slicer,cost |

### `list-materials`

Show available material presets.

```bash
stl-analyzer list-materials
```

### `list-printers`

Show available printer presets.

```bash
stl-analyzer list-printers
```

---

## Project Structure

```
stl-analyzer/
├── bin/
│   └── cli.js                    # CLI entry point
├── lib/
│   └── index.js                  # Main library export
├── src/
│   ├── analyzers/
│   │   ├── volumeAnalyzer.js
│   │   ├── integrityAnalyzer.js
│   │   └── costEstimator.js
│   ├── slicer/
│   │   └── slicerEngine.js
│   └── utils/
│       ├── stlParser.js
│       ├── reporter.js
│       └── generateSampleStl.js
├── package.json
└── README.md
```

---

## Examples

### Complete Analysis Example

```javascript
const {
  parseSTL,
  analyzeVolume,
  analyzeIntegrity,
  slice,
  estimateCost,
  writeBottomSTL,
  reporter,
} = require('stl-analyzer');
const fs = require('fs');

async function analyzeModel() {
  const modelPath = 'parts/bracket.stl';
  
  // Parse triangles
  const triangles = parseSTL(modelPath);
  console.log(`Loaded ${triangles.length} triangles`);

  // Volume analysis
  const volume = analyzeVolume(modelPath, { material: 'PETG' });
  console.log(`\nVolume: ${volume.volumeCm3.toFixed(2)} cm³`);
  console.log(`Weight: ${volume.weightGrams.toFixed(2)} g`);

  // Integrity check
  const integrity = analyzeIntegrity(triangles);
  if (!integrity.isWatertight) {
    console.warn('⚠️  Mesh is not watertight!');
    console.warn(integrity.errors.join('\n'));
    return;
  }

  // Slicing
  const slicing = slice(triangles, {
    layerHeight: 0.15,
    overhangAngle: 45,
    nozzleDiameter: 0.4,
    infillDensity: 0.25,
    shellCount: 4,
  });
  console.log(`\nLayers: ${slicing.layerCount}`);
  console.log(`Support pillars: ${slicing.supportPillarCount}`);

  // Cost calculation
  const cost = estimateCost(slicing, {
    material: 'PETG',
    printer: 'Bambu Lab X1C',
    materialPricePerKg: 2000,
    electricityPricePerKwh: 6.5,
    machineHourRate: 100,
    profitMarginPercent: 25,
  });
  
  console.log(`\n💰 Estimated cost: ${cost.totalCostFormatted}`);
  console.log(`  Material: ${cost.breakdown.materialCost}₽`);
  console.log(`  Machine: ${cost.breakdown.machineCost}₽`);
  console.log(`  Electric: ${cost.breakdown.electricityCost}₽`);
  console.log(`  Print time: ${cost.time.printTimeFormatted}`);

  // Export supports if needed
  if (slicing.supportTriangles.length > 0) {
    writeBinarySTL(
      slicing.supportTriangles,
      'parts/bracket_supports.stl'
    );
    console.log('\n📄 Supports exported to bracket_supports.stl');
  }

  // Save full report
  const report = {
    file: modelPath,
    timestamp: new Date().toISOString(),
    volume,
    integrity,
    slicing,
    cost,
  };
  fs.writeFileSync(
    'parts/bracket_report.json',
    JSON.stringify(report, null, 2)
  );
  console.log('📋 Full report saved to bracket_report.json');
}

analyzeModel().catch(console.error);
```

### Integration with UI

```javascript
// Electron/React example
import { analyzeVolume, estimateCost, slice } from 'stl-analyzer';

function ModelPriceCalculator({ modelPath }) {
  const [price, setPrice] = useState(null);
  const [loading, setLoading] = useState(false);

  const calculatePrice = async () => {
    setLoading(true);
    try {
      const volume = analyzeVolume(modelPath, { material: 'PLA' });
      const triangles = parseSTL(modelPath);
      const slicing = slice(triangles, { layerHeight: 0.2 });
      const cost = estimateCost(slicing, {
        material: 'PLA',
        materialPricePerKg: 1800,
        electricityPricePerKwh: 6.5,
      });
      setPrice(cost);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={calculatePrice} disabled={loading}>
        Calculate Price
      </button>
      {price && (
        <div>
          <p>Total: {price.totalCostFormatted}</p>
          <p>Print time: {price.time.printTimeFormatted}</p>
          <p>Weight: {price.filament.totalWeightGrams}g</p>
        </div>
      )}
    </div>
  );
}
```

---

## Limitations & Notes

- **Slicer accuracy**: ±10-20% variance from production slicers. For production use, validate with Cura/PrusaSlicer.
- **Support style**: Cylindrical pillars (FDM-style). Tree supports and rafts not included.
- **Resin printing**: Set `infill: 100` and `shells: 2` for SLA/MSLA materials.
- **Non-manifold models**: Will still analyze but may produce inaccurate results. Repair with Meshmixer first.
- **Large files**: Models with 500k+ triangles may take 10-30s for integrity check.

---

## License

MIT — See LICENSE file

---

## Contributing

Contributions welcome! Please open issues and pull requests.

For node modules that require modification (like node-stl for better volume calc), see the [Contributing Guidelines](./CONTRIBUTING.md).

---

## Support

- 📖 [Full Documentation](./docs/)
- 🐛 [Report Issues](https://github.com/yourusername/stl-analyzer/issues)
- 💬 [Discussions](https://github.com/yourusername/stl-analyzer/discussions)
