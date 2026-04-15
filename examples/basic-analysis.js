/**
 * Basic Analysis Example
 * 
 * Demonstrates:
 * - Parsing STL file
 * - Analyzing volume
 * - Checking mesh integrity
 * - Basic slicing
 * - Exporting report
 */

const {
  parseSTL,
  analyzeVolume,
  analyzeIntegrity,
  slice,
} = require('../lib/index.js');

const fs = require('fs');
const path = require('path');

async function basicAnalysis() {
  // Replace with your STL file path
  const modelPath = process.argv[2] || 'samples/cube.stl';

  if (!fs.existsSync(modelPath)) {
    console.error(`❌ File not found: ${modelPath}`);
    console.error(`\nUsage: node basic-analysis.js <path-to-file.stl>`);
    process.exit(1);
  }

  console.log(`\n📄 Analyzing: ${modelPath}\n`);

  try {
    // 1. Parse STL
    console.log('1️⃣  Parsing STL file...');
    const triangles = parseSTL(modelPath);
    console.log(`   ✓ Loaded ${triangles.length.toLocaleString()} triangles\n`);

    // 2. Analyze volume
    console.log('2️⃣  Analyzing volume and physical properties...');
    const volumeResult = analyzeVolume(modelPath, {
      material: 'PLA',
    });
    console.log(`   Volume: ${volumeResult.volumeCm3.toFixed(2)} cm³`);
    console.log(`   Weight: ${volumeResult.weightGrams.toFixed(2)} g`);
    console.log(`   Surface area: ${volumeResult.areaMm2.toFixed(0)} mm²`);
    console.log(`   Bounding box: ${volumeResult.boundingBox.x.toFixed(1)} × ` + 
      `${volumeResult.boundingBox.y.toFixed(1)} × ` +
      `${volumeResult.boundingBox.z.toFixed(1)} mm\n`);

    // 3. Check integrity
    console.log('3️⃣  Checking mesh integrity...');
    const integrityResult = analyzeIntegrity(triangles);
    console.log(`   Watertight: ${integrityResult.isWatertight ? '✓ Yes' : '✗ No'}`);
    console.log(`   Shells: ${integrityResult.stats.shellCount}`);
    console.log(`   Boundary edges (holes): ${integrityResult.stats.boundaryEdges}`);
    
    if (integrityResult.errors.length > 0) {
      console.log(`   ⚠️  Issues found:`);
      integrityResult.errors.forEach(err => console.log(`     - ${err}`));
    }
    console.log();

    // 4. Slice model
    console.log('4️⃣  Slicing into layers...');
    const slicerResult = slice(triangles, {
      layerHeight: 0.2,
      overhangAngle: 45,
      nozzleDiameter: 0.4,
      infillDensity: 0.2,
      shellCount: 3,
    });
    console.log(`   Layers: ${slicerResult.layerCount}`);
    console.log(`   Model height: ${slicerResult.modelHeight.toFixed(2)} mm`);
    console.log(`   Overhangs: ${slicerResult.overhangTriangleCount}`);
    console.log(`   Support pillars needed: ${slicerResult.supportPillarCount}\n`);

    // 5. Summary
    console.log('✅ Analysis complete!\n');

    // Save a summary
    const summary = {
      file: path.basename(modelPath),
      timestamp: new Date().toISOString(),
      volume: {
        cm3: volumeResult.volumeCm3,
        grams: volumeResult.weightGrams,
        areaMm2: volumeResult.areaMm2,
      },
      integrity: {
        isWatertight: integrityResult.isWatertight,
        shells: integrityResult.stats.shellCount,
      },
      slicing: {
        layers: slicerResult.layerCount,
        supportPillars: slicerResult.supportPillarCount,
      },
    };

    const reportPath = modelPath.replace('.stl', '_summary.json');
    fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    console.log(`📋 Summary saved to: ${reportPath}\n`);

  } catch (error) {
    console.error('❌ Error during analysis:');
    console.error(error.message);
    process.exit(1);
  }
}

basicAnalysis();
