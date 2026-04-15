## Examples

This directory contains example scripts showing how to use `stl-analyzer` as a library.

### Running Examples

First, install the package:

```bash
npm install stl-analyzer
```

Or from the root directory:

```bash
npm install
```

Then run any example:

```bash
node examples/basic-analysis.js
node examples/cost-calculator.js samples/sphere.stl
```

---

## Examples

### 1. Basic Analysis (`basic-analysis.js`)

**What it shows:**
- How to parse STL files
- Calculate volume and physical properties
- Check mesh integrity
- Perform layer slicing
- Generate reports

**Usage:**

```bash
# Analyze a specific file
node examples/basic-analysis.js path/to/model.stl

# Analyze a sample file (from project)
node examples/basic-analysis.js samples/cube.stl
```

**Output:**
- Console report with volume, weight, mesh integrity, layer info
- JSON summary file

**Good for:**
- Learning the basic API
- Quick model validation
- Understanding mesh quality

---

### 2. Cost Calculator (`cost-calculator.js`)

**What it shows:**
- Complete cost estimation workflow
- Multiple material and printer scenarios
- Comparing costs across different setups
- Detailed cost breakdown

**Usage:**

```bash
# Calculate costs for a model
node examples/cost-calculator.js models/part.stl

# Use default sample
node examples/cost-calculator.js
```

**Output:**
- Console comparison of 3 cost scenarios:
  - Budget setup (Ender 3 + PLA)
  - Professional setup (Prusa MK4 + PETG) 
  - Premium setup (Bambu Lab + Carbon Fiber)
- JSON report with all cost data

**Good for:**
- Pricing 3D prints
- Comparing setups
- Understanding cost breakdown

---

### 3. Batch Analysis (`batch-analysis.js`)

**What it shows:**
- Processing multiple STL files
- Error handling and recovery
- Aggregating results
- Generating batch reports

**Usage:**

```bash
# Analyze all samples
node examples/batch-analysis.js "samples/*.stl"

# Analyze specific directory
node examples/batch-analysis.js "models/production/*.stl"

# Use default pattern
node examples/batch-analysis.js
```

**Output:**
- Console summary table with all results
- JSON batch report
- Error logging for failed files

**Good for:**
- Processing model libraries
- Quality control workflows
- Generating price lists for multiple parts

---

## Creating Your Own Examples

Here's a template for creating a custom analysis:

```javascript
const {
  parseSTL,
  analyzeVolume,
  analyzeIntegrity,
  slice,
  estimateCost,
} = require('stl-analyzer');

const modelPath = 'my-model.stl';
const triangles = parseSTL(modelPath);
const volume = analyzeVolume(modelPath);
const integrity = analyzeIntegrity(triangles);
const slicing = slice(triangles, { layerHeight: 0.2 });
const cost = estimateCost(slicing, { material: 'PLA' });

console.log(`Volume: ${volume.volumeCm3} cm³`);
console.log(`Cost: ${cost.totalCostFormatted}`);
```

---

## Common Tasks

### Get volume only

```javascript
const { analyzeVolume } = require('stl-analyzer');
const result = analyzeVolume('model.stl');
console.log(result.volumeCm3); // cm³
console.log(result.weightGrams); // grams
```

### Check if model is printable

```javascript
const { parseSTL, analyzeIntegrity } = require('stl-analyzer');
const triangles = parseSTL('model.stl');
const result = analyzeIntegrity(triangles);

if (result.isWatertight) {
  console.log('✓ Model is printable');
} else {
  console.log('✗ Model needs repair');
  console.log(result.errors);
}
```

### Estimate print time and material

```javascript
const { slice, estimateCost } = require('stl-analyzer');

const slicing = slice(triangles, {
  layerHeight: 0.2,
  infillDensity: 0.2,
});

const cost = estimateCost(slicing, {
  material: 'PLA',
});

console.log(`Time: ${cost.time.printTimeFormatted}`);
console.log(`Filament: ${cost.filament.totalWeightGrams}g`);
```

### Generate support structures

```javascript
const { slice, writeBinarySTL } = require('stl-analyzer');

const result = slice(triangles, {
  layerHeight: 0.2,
  overhangAngle: 45,
});

if (result.supportTriangles.length > 0) {
  writeBinarySTL(result.supportTriangles, 'supports.stl');
}
```

---

## Troubleshooting

### Module not found

Make sure you're in the correct directory and have installed dependencies:

```bash
npm install
```

If using locally, adjust the require path:

```javascript
// From root directory
const stlAnalyzer = require('./lib/index.js');

// From examples directory
const stlAnalyzer = require('../lib/index.js');
```

### File not found errors

Always check that the STL file exists before analyzing:

```javascript
const fs = require('fs');
if (!fs.existsSync('model.stl')) {
  console.error('File not found');
  process.exit(1);
}
```

### Memory issues with large files

For very large models (500k+ triangles):

```javascript
// May take 30+ seconds
console.time('analysis');
const result = analyzeModel('huge.stl');
console.timeEnd('analysis');
```

---

## Next Steps

- Read the [Main README](../README.md) for full API documentation
- Check the [CLI Reference](../README.md#cli-commands) for command-line usage
- Explore the [Source Code](../src/) to understand the implementation
