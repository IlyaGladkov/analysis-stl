/**
 * Cost Calculator Example
 * 
 * Demonstrates:
 * - Complete cost estimation workflow
 * - Using material and printer presets
 * - Customizing cost parameters
 * - Generating cost reports
 */

const {
  parseSTL,
  analyzeVolume,
  analyzeIntegrity,
  slice,
  estimateCost,
  getCostMaterialPresets,
  getPrinterPresets,
} = require('../lib/index.js');

const fs = require('fs');
const path = require('path');

async function calculatePrintCost() {
  const modelPath = process.argv[2] || 'samples/sphere.stl';

  if (!fs.existsSync(modelPath)) {
    console.error(`❌ File not found: ${modelPath}`);
    process.exit(1);
  }

  console.log(`\n💰 Print Cost Calculator\n`);
  console.log(`📄 Model: ${path.basename(modelPath)}\n`);

  try {
    // Parse and validate model
    const triangles = parseSTL(modelPath);
    const integrity = analyzeIntegrity(triangles);

    if (!integrity.isWatertight) {
      console.warn('⚠️  Warning: Model is not watertight!');
      console.warn('   Volume and cost estimates may be inaccurate.\n');
    }

    // Slice model
    const slicerResult = slice(triangles, {
      layerHeight: 0.2,
      overhangAngle: 45,
      nozzleDiameter: 0.4,
      infillDensity: 0.2,
      shellCount: 3,
    });

    // Available materials and printers
    const materials = getCostMaterialPresets();
    const printers = getPrinterPresets();

    // Define cost scenarios
    const scenarios = [
      {
        name: 'Budget PLA (Ender 3)',
        material: 'PLA',
        printer: 'Ender 3',
        materialPricePerKg: 1800,
        electricityPricePerKwh: 6.5,
        machineHourRate: 30,
        profitMarginPercent: 10,
      },
      {
        name: 'Professional PETG (Prusa MK4)',
        material: 'PETG',
        printer: 'Prusa MK4',
        materialPricePerKg: 2000,
        electricityPricePerKwh: 6.5,
        machineHourRate: 75,
        profitMarginPercent: 25,
      },
      {
        name: 'Premium Carbon Fiber (Bambu Lab X1C)',
        material: 'Nylon CF',
        printer: 'Bambu Lab X1C',
        materialPricePerKg: 7500,
        electricityPricePerKwh: 6.5,
        machineHourRate: 120,
        profitMarginPercent: 35,
      },
    ];

    console.log('📊 Cost Estimates:\n');
    console.log('─'.repeat(70));

    const results = [];

    for (const scenario of scenarios) {
      const cost = estimateCost(slicerResult, scenario);

      console.log(`\n🔹 ${scenario.name}`);
      console.log(`   Material: ${scenario.material}`);
      console.log(`   Printer: ${scenario.printer}`);
      console.log(`   Profit margin: ${scenario.profitMarginPercent}%`);
      console.log(`─`.repeat(70));
      console.log(`   💵 Total Cost: ${cost.totalCostFormatted}`);
      console.log(`   📦 Material cost: ${cost.breakdown.materialCost.toFixed(2)}₽ ` +
        `(${cost.metrics.materialPercent?.toFixed(1)}%)`);
      console.log(`   🏭 Machine cost: ${cost.breakdown.machineCost.toFixed(2)}₽`);
      console.log(`   ⚡ Electricity: ${cost.breakdown.electricityCost.toFixed(2)}₽`);
      console.log(`   ⏱️  Print time: ${cost.time.printTimeFormatted}`);
      console.log(`   📊 Cost per gram: ${cost.metrics.costPerGram?.toFixed(2)}₽/g`);

      results.push({
        scenario: scenario.name,
        material: scenario.material,
        printer: scenario.printer,
        totalCost: cost.totalCost,
        totalFormatted: cost.totalCostFormatted,
        breakdown: cost.breakdown,
        time: cost.time,
        metrics: cost.metrics,
      });
    }

    console.log(`\n${'─'.repeat(70)}\n`);

    // Find cheapest and most expensive
    const costs = results.map(r => r.totalCost);
    const minIdx = costs.indexOf(Math.min(...costs));
    const maxIdx = costs.indexOf(Math.max(...costs));

    console.log(`💚 Cheapest: ${results[minIdx].scenario} at ${results[minIdx].totalFormatted}`);
    console.log(`💔 Most expensive: ${results[maxIdx].scenario} at ${results[maxIdx].totalFormatted}`);
    console.log();

    // Save detailed report
    const reportPath = modelPath.replace('.stl', '_cost_report.json');
    const report = {
      file: path.basename(modelPath),
      timestamp: new Date().toISOString(),
      model: {
        triangles: triangles.length,
        volume: parseFloat(analyzeVolume(modelPath).volumeCm3.toFixed(2)),
      },
      slicing: {
        layers: slicerResult.layerCount,
        supportPillars: slicerResult.supportPillarCount,
        totalFilamentMm3: slicerResult.totalFilamentMm3,
      },
      costEstimates: results,
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📋 Detailed report saved to: ${path.basename(reportPath)}\n`);

  } catch (error) {
    console.error('❌ Error during cost calculation:');
    console.error(error.message);
    process.exit(1);
  }
}

calculatePrintCost();
