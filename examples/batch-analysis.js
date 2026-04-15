/**
 * Batch Analysis Example
 * 
 * Demonstrates:
 * - Processing multiple STL files
 * - Aggregating results
 * - Generating batch reports
 * - Handling errors gracefully
 */

const {
  parseSTL,
  analyzeVolume,
  analyzeIntegrity,
  slice,
  estimateCost,
} = require('../lib/index.js');

const fs = require('fs');
const path = require('path');
const glob = require('glob');

async function batchAnalyze(globPattern = 'samples/*.stl') {
  console.log(`\n📦 Batch Analysis Tool\n`);
  console.log(`🔍 Looking for: ${globPattern}\n`);

  try {
    // Find all STL files matching pattern
    const files = glob.sync(globPattern);

    if (files.length === 0) {
      console.warn(`⚠️  No files found matching: ${globPattern}`);
      console.log(`   Try: node batch-analysis.js "samples/*.stl"`);
      process.exit(1);
    }

    console.log(`📄 Found ${files.length} file(s)\n`);
    console.log('─'.repeat(80));

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    // Analyze each file
    for (const filePath of files) {
      const fileName = path.basename(filePath);

      try {
        console.log(`\n📊 Analyzing: ${fileName}`);
        process.stdout.write('   ├─ Parsing... ');

        const triangles = parseSTL(filePath);
        console.log('✓');

        process.stdout.write('   ├─ Volume... ');
        const volume = analyzeVolume(filePath);
        console.log('✓');

        process.stdout.write('   ├─ Integrity... ');
        const integrity = analyzeIntegrity(triangles);
        console.log('✓');

        process.stdout.write('   ├─ Slicing... ');
        const slicing = slice(triangles, {
          layerHeight: 0.2,
          overhangAngle: 45,
          nozzleDiameter: 0.4,
          infillDensity: 0.2,
          shellCount: 3,
        });
        console.log('✓');

        process.stdout.write('   └─ Cost... ');
        const cost = estimateCost(slicing, {
          material: 'PLA',
          materialPricePerKg: 1800,
          electricityPricePerKwh: 6.5,
        });
        console.log('✓');

        // Store results
        const result = {
          file: fileName,
          path: filePath,
          status: 'success',
          volume: {
            cm3: volume.volumeCm3,
            grams: volume.weightGrams,
          },
          integrity: {
            isWatertight: integrity.isWatertight,
            shells: integrity.stats.shellCount,
            issues: integrity.errors.length,
          },
          slicing: {
            layers: slicing.layerCount,
            supports: slicing.supportPillarCount,
          },
          cost: {
            total: cost.totalCost,
            formatted: cost.totalCostFormatted,
          },
        };

        results.push(result);
        successCount++;

        // Print summary line
        console.log(`   ✅ ${volume.volumeCm3.toFixed(1)} cm³ · ` +
          `${slicing.layerCount} layers · ` +
          `${cost.totalCostFormatted}`);

      } catch (error) {
        console.log(`\n   ❌ Error: ${error.message}`);
        results.push({
          file: fileName,
          path: filePath,
          status: 'error',
          error: error.message,
        });
        errorCount++;
      }
    }

    console.log(`\n${'─'.repeat(80)}\n`);

    // Print summary table
    console.log(`📋 Summary:\n`);

    const successResults = results.filter(r => r.status === 'success');

    if (successResults.length > 0) {
      console.log(`✅ Successful: ${successCount}`);
      console.log(`❌ Failed: ${errorCount}\n`);

      // Sort by cost
      successResults.sort((a, b) => a.cost.total - b.cost.total);

      console.log('File'.padEnd(30) + 
        'Volume'.padEnd(12) + 
        'Layers'.padEnd(10) + 
        'Cost'.padEnd(12));
      console.log('─'.repeat(65));

      for (const result of successResults) {
        console.log(
          result.file.substring(0, 29).padEnd(30) +
          `${result.volume.cm3.toFixed(1)} cm³`.padEnd(12) +
          `${result.slicing.layers}`.padEnd(10) +
          result.cost.formatted
        );
      }

      // Statistics
      const totalVolume = successResults.reduce((sum, r) => sum + r.volume.cm3, 0);
      const totalCost = successResults.reduce((sum, r) => sum + r.cost.total, 0);
      const avgVolume = totalVolume / successResults.length;

      console.log('─'.repeat(65));
      console.log(
        'TOTAL'.padEnd(30) +
        `${totalVolume.toFixed(1)} cm³`.padEnd(12) +
        ''.padEnd(10) +
        `${totalCost.toFixed(2)}₽`
      );
      console.log(`Average volume: ${avgVolume.toFixed(2)} cm³\n`);
    } else {
      console.log('❌ All files failed to analyze');
    }

    // Save batch report
    const reportPath = 'batch_analysis_report.json';
    const report = {
      timestamp: new Date().toISOString(),
      pattern: globPattern,
      summary: {
        total: files.length,
        successful: successCount,
        failed: errorCount,
      },
      results: results,
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📊 Batch report saved to: ${reportPath}\n`);

  } catch (error) {
    console.error('❌ Fatal error:');
    console.error(error.message);
    process.exit(1);
  }
}

// Run with provided pattern or default
const pattern = process.argv[2] || 'samples/*.stl';
batchAnalyze(pattern);
