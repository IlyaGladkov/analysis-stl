"use strict";

/**
 * Демо-скрипт
 *
 * 1. Генерирует тестовые STL-файлы (куб, сфера, цилиндр, тор, тест нависаний)
 * 2. Запускает полный анализ каждой модели: объём · целостность · слайсер · стоимость
 * 3. Выводит цветной отчёт в терминал
 * 4. Записывает JSON-отчёты и STL-файлы поддержек в ./output/demo/
 */

const path = require("path");
const fs = require("fs");
const chalk = require("chalk");

const { generateAllSamples } = require("./utils/generateSampleStl");
const { parseSTL, writeBinarySTL } = require("./utils/stlParser");
const { analyzeVolume } = require("./analyzers/volumeAnalyzer");
const { analyzeIntegrity } = require("./analyzers/integrityAnalyzer");
const { slice, mergeWithSupports } = require("./slicer/slicerEngine");
const { estimateCost } = require("./analyzers/costEstimator");
const reporter = require("./utils/reporter");

// ─── Конфигурация ─────────────────────────────────────────────────────────────

const DEMO_DIR = path.resolve(__dirname, "..", "output", "demo");
const SAMPLE_DIR = path.resolve(__dirname, "..", "samples");

const SLICER_OPTS = {
  layerHeight: 0.2,
  overhangAngle: 45,
  nozzleDiameter: 0.4,
  infillDensity: 0.2,
  shellCount: 3,
  supportRadius: 0.4,
};

const COST_OPTS = {
  material: "PLA",
  printer: "Prusa MK4",
  filamentDiameter: 1.75,
  wasteFactor: 1.05,
  electricityPricePerKwh: 6, // ₽/кВт·ч
  operatorHourlyRate: 0,
  profitMarginPercent: 0,
};

// ─── Вспомогательные функции ──────────────────────────────────────────────────

function ensureDirs() {
  for (const d of [DEMO_DIR, SAMPLE_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function modelBanner(name, filePath) {
  const line = "═".repeat(64);
  console.log("\n" + chalk.bold.magenta(line));
  console.log(
    chalk.bold.white("  МОДЕЛЬ : ") +
      chalk.bold.yellow(name.toUpperCase()) +
      chalk.dim(`  ←  ${path.basename(filePath)}`),
  );
  console.log(chalk.bold.magenta(line) + "\n");
}

function tick(msg) {
  process.stdout.write(chalk.cyan("  ⟳  ") + msg + " … ");
  return (extra) => {
    process.stdout.write(
      chalk.green("готово") + (extra ? chalk.dim("  " + extra) : "") + "\n",
    );
  };
}

function cross(msg) {
  process.stdout.write(chalk.red("ОШИБКА") + "\n");
  console.error(chalk.red(`  ✘  ${msg}`));
}

// ─── Анализ одной модели ──────────────────────────────────────────────────────

function analyzeModel(stlPath, modelName) {
  modelBanner(modelName, stlPath);

  const results = {};

  // ── Разбор STL ────────────────────────────────────────────────────────────
  let triangles;
  {
    const done = tick("Разбор STL");
    try {
      triangles = parseSTL(stlPath);
      done(`${triangles.length.toLocaleString("ru-RU")} треугольников`);
    } catch (e) {
      cross(e.message);
      return null;
    }
  }

  // ── Объём ─────────────────────────────────────────────────────────────────
  {
    const done = tick("Объём и физические свойства");
    try {
      results.volume = analyzeVolume(stlPath, { material: COST_OPTS.material });
      done(
        `${results.volume.volumeCm3} см³  |  ${results.volume.weightGrams} г`,
      );
    } catch (e) {
      cross(e.message);
    }
  }

  // ── Целостность ───────────────────────────────────────────────────────────
  {
    const done = tick("Целостность меша");
    try {
      results.integrity = analyzeIntegrity(triangles);
      const verdict = results.integrity.isWatertight
        ? chalk.green("ГЕРМЕТИЧНЫЙ")
        : chalk.red("НЕ ГЕРМЕТИЧНЫЙ");
      done(verdict);
    } catch (e) {
      cross(e.message);
    }
  }

  // ── Слайсер ───────────────────────────────────────────────────────────────
  {
    const done = tick("Нарезка на слои и определение поддержек");
    try {
      results.slicer = slice(triangles, SLICER_OPTS);
      const sup = results.slicer.supportPillarCount;
      const supStr =
        sup > 0
          ? chalk.yellow(`${sup} столбиков поддержки`)
          : chalk.green("поддержки не нужны");
      done(`${results.slicer.layerCount} слоёв  |  ${supStr}`);
    } catch (e) {
      cross(e.message);
      results.slicer = null;
    }
  }

  // ── Стоимость ─────────────────────────────────────────────────────────────
  if (results.slicer) {
    const done = tick("Расчёт стоимости");
    try {
      results.cost = estimateCost(results.slicer, COST_OPTS);
      done(chalk.green(results.cost.totalCostFormatted));
    } catch (e) {
      cross(e.message);
    }
  }

  // ── Запись STL с поддержками ──────────────────────────────────────────────
  if (results.slicer && results.slicer.supportPillarCount > 0) {
    const done = tick("Запись STL модели с поддержками");
    try {
      const merged = mergeWithSupports(triangles, results.slicer);
      const outPath = path.join(DEMO_DIR, `${modelName}_with_supports.stl`);
      writeBinarySTL(merged, outPath);
      results.supportStlPath = outPath;

      const supOnlyPath = path.join(DEMO_DIR, `${modelName}_supports_only.stl`);
      writeBinarySTL(results.slicer.supportTriangles, supOnlyPath);
      results.supportsOnlyStlPath = supOnlyPath;

      done(
        `${merged.length.toLocaleString("ru-RU")} треугольников  →  ${path.basename(outPath)}`,
      );
    } catch (e) {
      cross(e.message);
    }
  }

  // ── Запись JSON-отчёта ────────────────────────────────────────────────────
  {
    const done = tick("Запись JSON-отчёта");
    try {
      const jsonReport = buildJsonReport(
        modelName,
        stlPath,
        triangles.length,
        results,
      );
      const jsonPath = path.join(DEMO_DIR, `${modelName}_report.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), "utf8");
      done(path.basename(jsonPath));
    } catch (e) {
      cross(e.message);
    }
  }

  // ── Вывод полных отчётов ──────────────────────────────────────────────────
  if (results.volume) reporter.printVolumeReport(results.volume);
  if (results.integrity) reporter.printIntegrityReport(results.integrity);
  if (results.slicer) reporter.printSlicerReport(results.slicer);
  if (results.cost) reporter.printCostReport(results.cost);

  return results;
}

// ─── Построитель JSON-отчёта ──────────────────────────────────────────────────

function buildJsonReport(name, filePath, triangleCount, results) {
  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      analyzer: "stl-analyzer v1.0.0",
      modelName: name,
      inputFile: filePath,
      triangleCount,
    },
    settings: {
      slicerOptions: SLICER_OPTS,
      costOptions: COST_OPTS,
    },
  };

  if (results.volume) {
    report.volume = {
      volumeCm3: results.volume.volumeCm3,
      volumeMm3: results.volume.volumeMm3,
      weightGrams: results.volume.weightGrams,
      areaMm2: results.volume.areaMm2,
      boundingBox: results.volume.boundingBox,
      centerOfMass: results.volume.centerOfMass,
      fillRatio: results.volume.fillRatio,
      material: results.volume.material,
      density: results.volume.density,
    };
  }

  if (results.integrity) {
    report.integrity = {
      isWatertight: results.integrity.isWatertight,
      verdict: results.integrity.verdict,
      errors: results.integrity.errors,
      warnings: results.integrity.warnings,
      stats: results.integrity.stats,
    };
  }

  if (results.slicer) {
    const s = results.slicer;
    report.slicer = {
      settings: s.settings,
      modelHeight: s.modelHeight,
      layerCount: s.layerCount,
      overhangTriangleCount: s.overhangTriangleCount,
      supportPillarCount: s.supportPillarCount,
      supportPillars: s.supportPillars,
      totalFilamentMm3: s.totalFilamentMm3,
      totalSupportMm3: s.totalSupportMm3,
      totalMaterialMm3: s.totalMaterialMm3,
      layerWithMaxArea: s.layerWithMaxArea,
      maxLayerAreaMm2: s.maxLayerAreaMm2,
      layers: s.layers.map((l) => ({
        layerIndex: l.layerIndex,
        zBottom: l.zBottom,
        zTop: l.zTop,
        contourCount: l.contourCount,
        areaMm2: l.areaMm2,
        filamentMm3: l.filamentMm3,
        hasSupportAt: l.hasSupportAt,
      })),
    };
  }

  if (results.cost) {
    const c = results.cost;
    report.cost = {
      currency: c.currency,
      inputs: c.inputs,
      filament: c.filament,
      time: c.time,
      breakdown: c.breakdown,
      metrics: c.metrics,
      totalCost: c.totalCost,
      totalFormatted: c.totalCostFormatted,
    };
  }

  return report;
}

// ─── Сводная таблица всех моделей ────────────────────────────────────────────

function printComparisonTable(allResults) {
  const line = "═".repeat(64);
  console.log("\n" + chalk.bold.cyan(line));
  console.log(chalk.bold.white("  ДЕМО ЗАВЕРШЕНО — СРАВНЕНИЕ ВСЕХ МОДЕЛЕЙ"));
  console.log(chalk.bold.cyan(line) + "\n");

  const Table = require("cli-table3");
  const t = new Table({
    head: [
      chalk.dim("Модель"),
      chalk.dim("Объём (см³)"),
      chalk.dim("Масса (г)"),
      chalk.dim("Герметич."),
      chalk.dim("Слоёв"),
      chalk.dim("Поддержки"),
      chalk.dim("Филамент (г)"),
      chalk.dim("Время"),
      chalk.dim("Стоимость"),
    ],
    style: { head: [], border: ["dim"] },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
    colWidths: [14, 12, 11, 12, 8, 11, 14, 12, 14],
  });

  for (const { name, results } of allResults) {
    if (!results) {
      t.push([chalk.red(name), ...Array(8).fill(chalk.dim("—"))]);
      continue;
    }

    const vol = results.volume
      ? results.volume.volumeCm3.toString()
      : chalk.dim("—");
    const wgt = results.volume
      ? results.volume.weightGrams.toString()
      : chalk.dim("—");

    const wt = results.integrity
      ? results.integrity.isWatertight
        ? chalk.green("✔ да")
        : chalk.red("✘ нет")
      : chalk.dim("—");

    const layers = results.slicer
      ? results.slicer.layerCount.toString()
      : chalk.dim("—");

    const sup = results.slicer
      ? results.slicer.supportPillarCount > 0
        ? chalk.yellow(results.slicer.supportPillarCount.toString())
        : chalk.green("нет")
      : chalk.dim("—");

    const fil = results.cost
      ? results.cost.filament.totalWeightGrams.toString()
      : chalk.dim("—");
    const time = results.cost
      ? results.cost.time.printTimeFormatted
      : chalk.dim("—");
    const cost = results.cost
      ? chalk.green(results.cost.totalCostFormatted)
      : chalk.dim("—");

    t.push([chalk.bold(name), vol, wgt, wt, layers, sup, fil, time, cost]);
  }

  console.log(t.toString());
  console.log(chalk.dim(`\n  Выходные файлы записаны в: ${DEMO_DIR}\n`));
}

// ─── Точка входа ─────────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log(
    chalk.bold.cyan("  ╔══════════════════════════════════════════════╗"),
  );
  console.log(
    chalk.bold.cyan("  ║") +
      chalk.bold.white("   STL АНАЛИЗАТОР — ДЕМО-РЕЖИМ  v1.0.0        ") +
      chalk.bold.cyan("║"),
  );
  console.log(
    chalk.bold.cyan("  ║") +
      chalk.dim("  Объём · Целостность · Слайсер · Стоимость   ") +
      chalk.bold.cyan("║"),
  );
  console.log(
    chalk.bold.cyan("  ╚══════════════════════════════════════════════╝"),
  );
  console.log("");
  console.log(chalk.dim(`  Папка образцов  : ${SAMPLE_DIR}`));
  console.log(chalk.dim(`  Папка вывода    : ${DEMO_DIR}`));

  ensureDirs();

  // ── 1. Генерация тестовых STL-файлов ──────────────────────────────────────
  reporter.sectionHeader("ГЕНЕРАЦИЯ ТЕСТОВЫХ STL-ФАЙЛОВ", "🗂️");

  let samplePaths;
  {
    const done = tick(
      "Генерация куба / сферы / цилиндра / тора / теста нависаний",
    );
    try {
      samplePaths = generateAllSamples(SAMPLE_DIR);
      done(`${samplePaths.length} файлов`);
      for (const p of samplePaths) {
        const kb = Math.round(fs.statSync(p).size / 1024);
        console.log(
          `    ${chalk.green("✔")}  ${chalk.cyan(path.basename(p))}  ${chalk.dim(kb + " КБ")}`,
        );
      }
    } catch (e) {
      process.stdout.write(chalk.red("ОШИБКА") + "\n");
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  }

  // ── 2. Анализ каждого образца ──────────────────────────────────────────────
  const MODELS = [
    { name: "куб", file: samplePaths.find((p) => p.includes("cube")) },
    { name: "сфера", file: samplePaths.find((p) => p.includes("sphere")) },
    {
      name: "цилиндр",
      file: samplePaths.find((p) => p.includes("cylinder")),
    },
    { name: "тор", file: samplePaths.find((p) => p.includes("torus")) },
    {
      name: "нависание",
      file: samplePaths.find((p) => p.includes("overhang")),
    },
  ];

  const allResults = [];

  for (const { name, file } of MODELS) {
    if (!file || !fs.existsSync(file)) {
      console.warn(
        chalk.yellow(`  ⚠  Образец не найден для "${name}" — пропускаем`),
      );
      allResults.push({ name, results: null });
      continue;
    }

    try {
      const results = analyzeModel(file, name);
      allResults.push({ name, results });
    } catch (e) {
      console.error(
        chalk.red(
          `\n  ✘  Неожиданная ошибка при анализе "${name}": ${e.message}`,
        ),
      );
      allResults.push({ name, results: null });
    }
  }

  // ── 3. Сводная таблица ────────────────────────────────────────────────────
  printComparisonTable(allResults);
}

main().catch((err) => {
  console.error(chalk.red("\n  Критическая ошибка: " + err.message));
  console.error(err.stack);
  process.exit(1);
});
