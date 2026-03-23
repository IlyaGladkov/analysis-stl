"use strict";

const path = require("path");
const fs = require("fs");
const { program } = require("commander");
const chalk = require("chalk");

const {
  parseSTL,
  writeBinarySTL,
  getBoundingBox,
} = require("./utils/stlParser");
const {
  analyzeVolume,
  getMaterialPresets,
} = require("./analyzers/volumeAnalyzer");
const { analyzeIntegrity } = require("./analyzers/integrityAnalyzer");
const { slice, mergeWithSupports } = require("./slicer/slicerEngine");
const {
  estimateCost,
  getMaterialPresets: getCostMaterials,
  getPrinterPresets,
} = require("./analyzers/costEstimator");
const reporter = require("./utils/reporter");

// ─── CLI определение ──────────────────────────────────────────────────────────

program
  .name("stl-analyzer")
  .description(
    chalk.bold.cyan("STL Анализатор") +
      " — Объём · Целостность · Слайсер · Расчёт стоимости",
  )
  .version("1.0.0");

program
  .command("analyze <file>")
  .alias("a")
  .description("Запустить полный анализ STL-файла")
  .option(
    "-m, --material <name>",
    "Материал: PLA|ABS|PETG|TPU|ASA|Nylon|Resin",
    "PLA",
  )
  .option(
    "-p, --printer <name>",
    "Пресет принтера (см. list-printers)",
    "Стандартный FDM",
  )
  .option("-l, --layer-height <mm>", "Высота слоя в мм", parseFloat, 0.2)
  .option("-n, --nozzle <mm>", "Диаметр сопла в мм", parseFloat, 0.4)
  .option("-i, --infill <pct>", "Заполнение 0–100 (%)", parseFloat, 20)
  .option("-s, --shells <n>", "Количество периметров (оболочек)", parseInt, 3)
  .option(
    "-a, --overhang-angle <deg>",
    "Порог нависания для поддержек (градусы)",
    parseFloat,
    45,
  )
  .option("-k, --price-per-kg <rub>", "Цена материала за кг (₽)", parseFloat)
  .option(
    "-e, --electricity <rub/kwh>",
    "Цена электроэнергии за кВт·ч (₽)",
    parseFloat,
    6,
  )
  .option(
    "-r, --machine-rate <rub/h>",
    "Стоимость машино-часа — амортизация (₽/ч)",
    parseFloat,
  )
  .option("--operator-rate <rub/h>", "Ставка оператора (₽/ч)", parseFloat, 0)
  .option("--profit-margin <pct>", "Процент наценки", parseFloat, 0)
  .option(
    "--filament-diameter <mm>",
    "Диаметр прутка катушки (мм)",
    parseFloat,
    1.75,
  )
  .option(
    "--waste-factor <multiplier>",
    "Коэффициент отходов, напр. 1.05",
    parseFloat,
    1.05,
  )
  .option("-o, --output <dir>", "Директория для выходных файлов", "./output")
  .option("--no-support-stl", "Не записывать STL-файл поддержек")
  .option(
    "--only <steps>",
    "Выполнить только указанные шаги: volume,integrity,slicer,cost",
  )
  .action(runAnalysis);

program
  .command("list-materials")
  .description("Показать доступные пресеты материалов")
  .action(() => {
    reporter.sectionHeader("ПРЕСЕТЫ МАТЕРИАЛОВ", "🧪");
    const Table = require("cli-table3");
    const t = new Table({
      head: ["Название", "Плотность (г/см³)", "Цена/кг (₽)"],
      style: { head: ["cyan"] },
    });
    for (const m of getCostMaterials()) {
      t.push([chalk.bold(m.name), m.density, `${m.pricePerKg} ₽`]);
    }
    console.log(t.toString());
  });

program
  .command("list-printers")
  .description("Показать доступные пресеты принтеров")
  .action(() => {
    reporter.sectionHeader("ПРЕСЕТЫ ПРИНТЕРОВ", "🖨️");
    const Table = require("cli-table3");
    const t = new Table({
      head: ["Название", "Скорость (мм/с)", "Мощность (Вт)", "Ставка (₽/ч)"],
      style: { head: ["cyan"] },
    });
    for (const p of getPrinterPresets()) {
      t.push([
        chalk.bold(p.name),
        p.printSpeedMmS,
        p.powerWatts,
        `${p.pricePerHour} ₽`,
      ]);
    }
    console.log(t.toString());
  });

program.parse(process.argv);

// Показать помощь если команда не передана
if (!process.argv.slice(2).length) {
  printBanner();
  program.help();
}

// ─── Главная функция анализа ──────────────────────────────────────────────────

async function runAnalysis(filePath, opts) {
  printBanner();

  const absFile = path.resolve(filePath);

  // ── Проверка входного файла ────────────────────────────────────────────────
  if (!fs.existsSync(absFile)) {
    console.error(chalk.red(`\n  ✘  Файл не найден: ${absFile}\n`));
    process.exit(1);
  }

  const ext = path.extname(absFile).toLowerCase();
  if (ext !== ".stl") {
    console.error(chalk.red(`\n  ✘  Ожидается файл .stl, получен: ${ext}\n`));
    process.exit(1);
  }

  // ── Определить шаги для выполнения ────────────────────────────────────────
  const onlySteps = opts.only
    ? new Set(opts.only.split(",").map((s) => s.trim().toLowerCase()))
    : null;

  const shouldRun = (step) => !onlySteps || onlySteps.has(step);

  // ── Выходная директория ────────────────────────────────────────────────────
  const outputDir = path.resolve(opts.output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const baseName = path.basename(absFile, ".stl");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPrefix = path.join(outputDir, `${baseName}_${timestamp}`);

  console.log(chalk.dim(`\n  Файл      : ${absFile}`));
  console.log(chalk.dim(`  Вывод     : ${outputDir}`));
  console.log(
    chalk.dim(`  Материал  : ${opts.material}  |  Принтер: ${opts.printer}`),
  );
  console.log(
    chalk.dim(
      `  Слой      : ${opts.layerHeight}мм  |  Сопло: ${opts.nozzle}мм  |  Заполнение: ${opts.infill}%`,
    ),
  );

  const outputFiles = [];

  // ════════════════════════════════════════════════════════════════════════════
  // ШАГ 0 — Разбор STL
  // ════════════════════════════════════════════════════════════════════════════

  reporter.step("Разбор STL-файла");
  let triangles;
  try {
    triangles = parseSTL(absFile);
    reporter.stepDone(
      `${triangles.length.toLocaleString("ru-RU")} треугольников`,
    );
  } catch (e) {
    reporter.stepFail(e.message);
    process.exit(1);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ШАГ 1 — Объём и физические свойства
  // ════════════════════════════════════════════════════════════════════════════

  let volumeResult = null;

  if (shouldRun("volume")) {
    reporter.step("Расчёт объёма и физических свойств");
    try {
      volumeResult = analyzeVolume(absFile, {
        material: opts.material,
        density: undefined,
      });
      reporter.stepDone(
        `${volumeResult.volumeCm3} см³  |  ${volumeResult.weightGrams} г`,
      );
    } catch (e) {
      reporter.stepFail(e.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ШАГ 2 — Целостность меша
  // ════════════════════════════════════════════════════════════════════════════

  let integrityResult = null;

  if (shouldRun("integrity")) {
    reporter.step("Анализ целостности меша");
    try {
      integrityResult = analyzeIntegrity(triangles);
      const verdict = integrityResult.isWatertight
        ? chalk.green("ГЕРМЕТИЧНЫЙ")
        : chalk.red("НЕ ГЕРМЕТИЧНЫЙ");
      reporter.stepDone(verdict);
    } catch (e) {
      reporter.stepFail(e.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ШАГ 3 — Слайсинг и определение поддержек
  // ════════════════════════════════════════════════════════════════════════════

  let slicerResult = null;

  if (shouldRun("slicer")) {
    reporter.step("Нарезка на слои и определение поддержек");
    try {
      slicerResult = slice(triangles, {
        layerHeight: opts.layerHeight,
        overhangAngle: opts.overhangAngle,
        nozzleDiameter: opts.nozzle,
        infillDensity: opts.infill / 100,
        shellCount: opts.shells,
        supportRadius: opts.nozzle,
      });

      const supportInfo =
        slicerResult.supportPillarCount > 0
          ? chalk.yellow(
              `${slicerResult.supportPillarCount} столбиков поддержки`,
            )
          : chalk.green("поддержки не нужны");

      reporter.stepDone(`${slicerResult.layerCount} слоёв  |  ${supportInfo}`);

      // ── Записать STL с поддержками ─────────────────────────────────────────
      if (opts.supportStl && slicerResult.supportPillarCount > 0) {
        reporter.step("Запись STL модели с поддержками");
        try {
          const mergedTriangles = mergeWithSupports(triangles, slicerResult);
          const supportStlPath = `${outPrefix}_with_supports.stl`;
          writeBinarySTL(mergedTriangles, supportStlPath);
          const sizeKb = Math.round(fs.statSync(supportStlPath).size / 1024);
          outputFiles.push({
            label: "Модель + поддержки (STL)",
            path: supportStlPath,
            sizeKb,
          });
          reporter.stepDone(
            `${mergedTriangles.length.toLocaleString("ru-RU")} треугольников`,
          );
        } catch (e) {
          reporter.stepFail(e.message);
        }
      }

      // ── Записать только поддержки ──────────────────────────────────────────
      if (opts.supportStl && slicerResult.supportTriangles.length > 0) {
        reporter.step("Запись STL только поддержек");
        try {
          const supportOnlyPath = `${outPrefix}_supports_only.stl`;
          writeBinarySTL(slicerResult.supportTriangles, supportOnlyPath);
          const sizeKb = Math.round(fs.statSync(supportOnlyPath).size / 1024);
          outputFiles.push({
            label: "Только поддержки (STL)",
            path: supportOnlyPath,
            sizeKb,
          });
          reporter.stepDone(
            `${slicerResult.supportTriangles.length.toLocaleString("ru-RU")} треугольников`,
          );
        } catch (e) {
          reporter.stepFail(e.message);
        }
      }
    } catch (e) {
      reporter.stepFail(e.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ШАГ 4 — Расчёт стоимости
  // ════════════════════════════════════════════════════════════════════════════

  let costResult = null;

  if (shouldRun("cost") && slicerResult) {
    reporter.step("Расчёт стоимости печати");
    try {
      const costOpts = {
        material: opts.material,
        printer: opts.printer,
        filamentDiameter: opts.filamentDiameter,
        wasteFactor: opts.wasteFactor,
        electricityPricePerKwh: opts.electricity,
        operatorHourlyRate: opts.operatorRate,
        profitMarginPercent: opts.profitMargin,
      };
      if (opts.pricePerKg !== undefined)
        costOpts.materialPricePerKg = opts.pricePerKg;
      if (opts.machineRate !== undefined)
        costOpts.machineHourRate = opts.machineRate;

      costResult = estimateCost(slicerResult, costOpts);
      reporter.stepDone(chalk.green(costResult.totalCostFormatted));
    } catch (e) {
      reporter.stepFail(e.message);
    }
  } else if (shouldRun("cost") && !slicerResult) {
    console.log(
      chalk.yellow(
        "\n  ⚠  Расчёт стоимости требует шага слайсера. Пропускаем.",
      ),
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ШАГ 5 — Запись JSON-отчёта
  // ════════════════════════════════════════════════════════════════════════════

  reporter.step("Запись JSON-отчёта");
  try {
    const report = buildJsonReport({
      file: absFile,
      opts,
      triangleCount: triangles.length,
      volumeResult,
      integrityResult,
      slicerResult,
      costResult,
      outputFiles,
    });

    const jsonPath = `${outPrefix}_report.json`;
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
    const sizeKb = Math.round(fs.statSync(jsonPath).size / 1024);
    outputFiles.push({ label: "JSON-отчёт", path: jsonPath, sizeKb });
    reporter.stepDone(jsonPath);
  } catch (e) {
    reporter.stepFail(e.message);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Вывод отчётов
  // ════════════════════════════════════════════════════════════════════════════

  if (volumeResult) reporter.printVolumeReport(volumeResult);
  if (integrityResult) reporter.printIntegrityReport(integrityResult);
  if (slicerResult) reporter.printSlicerReport(slicerResult);
  if (costResult) reporter.printCostReport(costResult);

  if (outputFiles.length > 0) {
    reporter.printOutputSummary(outputFiles);
  }

  reporter.printFinalSummary({
    volumeResult,
    integrityResult,
    slicerResult,
    costResult,
  });
}

// ─── Построитель JSON-отчёта ──────────────────────────────────────────────────

function buildJsonReport({
  file,
  opts,
  triangleCount,
  volumeResult,
  integrityResult,
  slicerResult,
  costResult,
  outputFiles,
}) {
  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      analyzer: "stl-analyzer v1.0.0",
      inputFile: file,
      triangleCount,
    },
    settings: {
      material: opts.material,
      printer: opts.printer,
      layerHeight: opts.layerHeight,
      nozzleDiameter: opts.nozzle,
      infillPercent: opts.infill,
      shellCount: opts.shells,
      overhangAngle: opts.overhangAngle,
    },
  };

  if (volumeResult) {
    report.volume = {
      volumeCm3: volumeResult.volumeCm3,
      volumeMm3: volumeResult.volumeMm3,
      weightGrams: volumeResult.weightGrams,
      areaMm2: volumeResult.areaMm2,
      boundingBox: volumeResult.boundingBox,
      centerOfMass: volumeResult.centerOfMass,
      fillRatio: volumeResult.fillRatio,
      material: volumeResult.material,
      density: volumeResult.density,
    };
  }

  if (integrityResult) {
    report.integrity = {
      isWatertight: integrityResult.isWatertight,
      verdict: integrityResult.verdict,
      errors: integrityResult.errors,
      warnings: integrityResult.warnings,
      stats: integrityResult.stats,
    };
  }

  if (slicerResult) {
    const layers = slicerResult.layers.map((l) => ({
      layerIndex: l.layerIndex,
      zBottom: l.zBottom,
      zTop: l.zTop,
      contourCount: l.contourCount,
      areaMm2: l.areaMm2,
      filamentMm3: l.filamentMm3,
      hasSupportAt: l.hasSupportAt,
    }));

    report.slicer = {
      settings: slicerResult.settings,
      modelHeight: slicerResult.modelHeight,
      layerCount: slicerResult.layerCount,
      overhangTriangleCount: slicerResult.overhangTriangleCount,
      supportPillarCount: slicerResult.supportPillarCount,
      supportPillars: slicerResult.supportPillars,
      totalFilamentMm3: slicerResult.totalFilamentMm3,
      totalSupportMm3: slicerResult.totalSupportMm3,
      totalMaterialMm3: slicerResult.totalMaterialMm3,
      layerWithMaxArea: slicerResult.layerWithMaxArea,
      maxLayerAreaMm2: slicerResult.maxLayerAreaMm2,
      layers,
    };
  }

  if (costResult) {
    report.cost = {
      currency: costResult.currency,
      inputs: costResult.inputs,
      filament: costResult.filament,
      time: costResult.time,
      breakdown: costResult.breakdown,
      metrics: costResult.metrics,
      totalCost: costResult.totalCost,
      totalFormatted: costResult.totalCostFormatted,
    };
  }

  report.outputFiles = outputFiles.map((f) => ({
    label: f.label,
    path: f.path,
  }));

  return report;
}

// ─── Баннер ───────────────────────────────────────────────────────────────────

function printBanner() {
  console.log("");
  console.log(
    chalk.bold.cyan("  ╔══════════════════════════════════════════════╗"),
  );
  console.log(
    chalk.bold.cyan("  ║") +
      chalk.bold.white("        STL АНАЛИЗАТОР  —  v1.0.0             ") +
      chalk.bold.cyan("║"),
  );
  console.log(
    chalk.bold.cyan("  ║") +
      chalk.dim("  Объём · Целостность · Слайсер · Цена        ") +
      chalk.bold.cyan("║"),
  );
  console.log(
    chalk.bold.cyan("  ╚══════════════════════════════════════════════╝"),
  );
  console.log("");
}
