"use strict";

const chalk = require("chalk");
const Table = require("cli-table3");

// ─── Цветовые хелперы ─────────────────────────────────────────────────────────

const ok = (s) => chalk.green(s);
const warn = (s) => chalk.yellow(s);
const err = (s) => chalk.red(s);
const info = (s) => chalk.cyan(s);
const bold = (s) => chalk.bold(s);
const dim = (s) => chalk.dim(s);

// ─── Заголовок секции ─────────────────────────────────────────────────────────

function sectionHeader(title, emoji = "") {
  const line = "─".repeat(60);
  console.log("");
  console.log(chalk.bold.cyan(`${line}`));
  console.log(chalk.bold.white(` ${emoji}  ${title}`));
  console.log(chalk.bold.cyan(`${line}`));
}

// ─── Таблица ключ/значение ────────────────────────────────────────────────────

function kvTable(rows) {
  const t = new Table({
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
    colWidths: [36, 36],
  });

  for (const [label, value] of rows) {
    t.push([dim(label), value]);
  }

  console.log(t.toString());
}

// ─── Отчёт по объёму ──────────────────────────────────────────────────────────

function printVolumeReport(result) {
  sectionHeader("ОБЪЁМ И ФИЗИЧЕСКИЕ СВОЙСТВА", "📐");

  kvTable([
    ["Материал", bold(result.material)],
    ["Плотность", `${result.density} г/см³`],
    ["Объём", bold(`${result.volumeCm3} см³  (${result.volumeMm3} мм³)`)],
    ["Объём (дюймы)", `${result.volumeIn3} куб. дюйм`],
    ["Площадь поверхности", `${result.areaMm2} мм²  (${result.areaCm2} см²)`],
    ["Масса", bold(`${result.weightGrams} г  (${result.weightKg} кг)`)],
    [
      "Габариты (Ш × Г × В)",
      bold(
        `${result.boundingBox.x} × ${result.boundingBox.y} × ${result.boundingBox.z} мм`,
      ),
    ],
    ["Объём габаритного ящика", `${result.bboxVolumeMm3} мм³`],
    ["Коэффициент заполнения", fillBar(result.fillRatio)],
    [
      "Центр масс",
      `X=${result.centerOfMass.x}  Y=${result.centerOfMass.y}  Z=${result.centerOfMass.z} мм`,
    ],
  ]);
}

function fillBar(pct) {
  const clamped = Math.min(100, Math.max(0, pct));
  const filled = Math.round(clamped / 5);
  const empty = 20 - filled;
  const bar = ok("█".repeat(filled)) + dim("░".repeat(empty));
  return `${bar}  ${bold(clamped.toFixed(1) + "%")}`;
}

// ─── Отчёт по целостности меша ────────────────────────────────────────────────

function printIntegrityReport(result) {
  sectionHeader("АНАЛИЗ ЦЕЛОСТНОСТИ МЕША", "🔍");

  if (result.isWatertight) {
    console.log(
      "  " +
        chalk.bgGreen.black.bold(
          "  ✔  ГЕРМЕТИЧНЫЙ — Меш корректен и готов к печати  ",
        ),
    );
  } else {
    console.log(
      "  " +
        chalk.bgRed.white.bold(
          "  ✘  НЕ ГЕРМЕТИЧНЫЙ — Требуется ремонт перед печатью  ",
        ),
    );
  }
  console.log("");

  const s = result.stats;

  kvTable([
    ["Треугольников", bold(s.triangleCount.toLocaleString("ru-RU"))],
    ["Уникальных вершин", s.uniqueVertexCount.toLocaleString("ru-RU")],
    ["Рёбер", s.edgeCount.toLocaleString("ru-RU")],
    [
      "Граничных рёбер (дыры)",
      s.boundaryEdges > 0 ? err(s.boundaryEdges) : ok("0"),
    ],
    [
      "Не-многообразных рёбер",
      s.nonManifoldEdges > 0 ? err(s.nonManifoldEdges) : ok("0"),
    ],
    [
      "Вырожденных треугольников",
      s.degenerateTriangles > 0 ? warn(s.degenerateTriangles) : ok("0"),
    ],
    [
      "Дублирующихся треугольников",
      s.duplicateTriangles > 0 ? warn(s.duplicateTriangles) : ok("0"),
    ],
    [
      "Перевёрнутых нормалей",
      s.flippedNormals > 0 ? warn(s.flippedNormals) : ok("0"),
    ],
    ["Характеристика Эйлера χ", eulerLabel(s.eulerCharacteristic, s.eulerOk)],
    [
      "Отдельных оболочек / тел",
      s.shellCount > 1 ? warn(s.shellCount) : ok(s.shellCount),
    ],
  ]);

  if (result.errors && result.errors.length > 0) {
    console.log("");
    console.log(bold(err("  ОШИБКИ:")));
    for (const e of result.errors) {
      console.log("    " + err("✘") + "  " + e);
    }
  }

  if (result.warnings && result.warnings.length > 0) {
    console.log("");
    console.log(bold(warn("  ПРЕДУПРЕЖДЕНИЯ:")));
    for (const w of result.warnings) {
      console.log("    " + warn("⚠") + "  " + w);
    }
  }
}

function eulerLabel(chi, ok_) {
  if (chi === null || chi === undefined) return dim("Н/Д");
  const label = `χ = ${chi}`;
  return ok_
    ? ok(label + "  (замкнутая поверхность — корректно)")
    : warn(label + "  (ожидается 2)");
}

// ─── Отчёт слайсера ───────────────────────────────────────────────────────────

function printSlicerReport(result) {
  sectionHeader("СЛАЙСИНГ И АНАЛИЗ ПОДДЕРЖЕК", "🔪");

  const s = result.settings;

  console.log(bold(info("  Параметры нарезки")));
  kvTable([
    ["Высота слоя", `${s.layerHeight} мм`],
    ["Диаметр сопла", `${s.nozzleDiameter} мм`],
    ["Плотность заполнения", `${(s.infillDensity * 100).toFixed(0)}%`],
    ["Количество периметров", `${s.shellCount}`],
    ["Порог нависания", `${s.overhangAngle}°`],
    ["Z стола печати", `${s.buildPlateZ} мм`],
  ]);

  console.log("");
  console.log(bold(info("  Статистика модели и слоёв")));
  kvTable([
    ["Диапазон Z модели", `${result.modelMinZ} мм  →  ${result.modelMaxZ} мм`],
    ["Высота модели", `${result.modelHeight} мм`],
    ["Всего слоёв", bold(result.layerCount.toLocaleString("ru-RU"))],
    [
      "Слой с наибольшей площадью",
      `Слой №${result.layerWithMaxArea}  (${result.maxLayerAreaMm2} мм²)`,
    ],
  ]);

  console.log("");
  console.log(bold(info("  Расход материала (оценка слайсера)")));
  kvTable([
    ["Объём филамента модели", `${result.totalFilamentMm3} мм³`],
    ["Объём поддержек", `${result.totalSupportMm3} мм³`],
    ["Итого материала", bold(`${result.totalMaterialMm3} мм³`)],
  ]);

  console.log("");
  console.log(bold(info("  Поддерживающие структуры")));
  if (result.supportPillarCount === 0) {
    console.log("  " + ok("✔  Поддержки не требуются."));
  } else {
    kvTable([
      [
        "Треугольников нависания",
        warn(result.overhangTriangleCount.toLocaleString("ru-RU")),
      ],
      [
        "Столбиков поддержки",
        warn(result.supportPillarCount.toLocaleString("ru-RU")),
      ],
      [
        "Треугольников поддержек (STL)",
        warn(result.supportTriangles.length.toLocaleString("ru-RU")),
      ],
    ]);
  }

  console.log("");
  console.log(bold(info("  Предпросмотр слоёв")));
  printLayerTable(result.layers);
}

function printLayerTable(layers) {
  const t = new Table({
    head: [
      dim("№"),
      dim("Z низ"),
      dim("Z верх"),
      dim("Контуры"),
      dim("Пл. мм²"),
      dim("Фил. мм³"),
      dim("Опора"),
    ],
    style: { head: [], border: ["dim"] },
    colWidths: [7, 12, 12, 11, 13, 13, 10],
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
  });

  const total = layers.length;
  const SHOW_HEAD = 10;
  const SHOW_TAIL = 5;

  const indices = new Set();
  for (let i = 0; i < Math.min(SHOW_HEAD, total); i++) indices.add(i);
  for (let i = Math.max(0, total - SHOW_TAIL); i < total; i++) indices.add(i);

  let prevIdx = -1;
  for (const i of [...indices].sort((a, b) => a - b)) {
    if (prevIdx !== -1 && i !== prevIdx + 1) {
      t.push([
        {
          colSpan: 7,
          content: dim(`  … скрыто ${i - prevIdx - 1} слоёв …`),
          hAlign: "center",
        },
      ]);
    }
    const l = layers[i];
    t.push([
      l.layerIndex,
      l.zBottom.toFixed(3),
      l.zTop.toFixed(3),
      l.contourCount,
      l.areaMm2.toFixed(2),
      l.filamentMm3.toFixed(3),
      l.hasSupportAt ? warn("●") : ok("○"),
    ]);
    prevIdx = i;
  }

  console.log(t.toString());
  console.log(dim(`  ● = поддержка на данном слое   ○ = поддержка не нужна`));
}

// ─── Отчёт по стоимости ───────────────────────────────────────────────────────

function printCostReport(result) {
  sectionHeader("РАСЧЁТ СТОИМОСТИ", "💰");

  const priceStr = result.totalCostFormatted;
  const banner = ` Итоговая стоимость: ${priceStr} `;
  const pad = "─".repeat(banner.length + 2);
  console.log("  " + chalk.bold.green(pad));
  console.log("  " + chalk.bgGreen.black.bold(" " + banner + " "));
  console.log("  " + chalk.bold.green(pad));
  console.log("");

  console.log(bold(info("  Конфигурация")));
  const inp = result.inputs;
  const cur = result.currency;
  kvTable([
    ["Материал", `${inp.material}  @ ${inp.pricePerKg} ${cur}/кг`],
    ["Плотность", `${inp.density} г/см³`],
    ["Диаметр филамента", `${inp.filamentDiameter} мм`],
    ["Коэф. отходов", `×${inp.wasteFactor}`],
    ["Принтер", inp.printer],
    ["Скорость печати", `${inp.printSpeedMmS} мм/с`],
    ["Потребляемая мощность", `${inp.powerWatts} Вт`],
    ["Стоимость машино-часа", `${inp.machineHourRate} ${cur}/ч`],
    ["Цена электроэнергии", `${inp.electricityRate} ${cur}/кВт·ч`],
    [
      "Ставка оператора",
      inp.operatorRate > 0 ? `${inp.operatorRate} ${cur}/ч` : dim("не задана"),
    ],
    [
      "Наценка",
      inp.profitMarginPercent > 0 ? `${inp.profitMarginPercent}%` : dim("нет"),
    ],
  ]);

  console.log("");
  console.log(bold(info("  Расход филамента")));
  const f = result.filament;
  kvTable([
    [
      "Филамент модели",
      `${f.modelVolumeMm3} мм³  →  ${f.modelWeightGrams} г  (${f.modelLengthMm} мм)`,
    ],
    [
      "Филамент поддержек",
      `${f.supportVolumeMm3} мм³  →  ${f.supportWeightGrams} г  (${f.supportLengthMm} мм)`,
    ],
    ["Отходы", `${f.wasteVolumeMm3} мм³`],
    [
      "Итого",
      bold(
        `${f.totalVolumeMm3} мм³  →  ${f.totalWeightGrams} г  (${f.totalLengthM} м)`,
      ),
    ],
  ]);

  console.log("");
  console.log(bold(info("  Время печати")));
  const t = result.time;
  kvTable([
    ["Расчётное время печати", bold(t.printTimeFormatted)],
    ["Время (часы)", `${t.printTimeHour} ч`],
    ["Потребление энергии", `${t.energyKwh} кВт·ч`],
  ]);

  console.log("");
  console.log(bold(info("  Структура стоимости")));
  const b = result.breakdown;
  const m = result.metrics;

  const rows = [
    ["Материал", b.materialCost, m.materialPercent],
    ["Машина", b.machineCost, m.machinePercent],
    ["Электроэнергия", b.electricityCost, m.electricityPercent],
    ["Труд оператора", b.laborCost, m.laborPercent],
  ];

  const bt = new Table({
    head: [dim("Статья"), dim(`Сумма (${cur})`), dim("Доля"), dim("График")],
    style: { head: [], border: ["dim"] },
    colWidths: [18, 18, 10, 26],
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
  });

  const colours = [chalk.blue, chalk.magenta, chalk.yellow, chalk.cyan];
  rows.forEach(([label, cost, pct], idx) => {
    const barLen = Math.round(pct / 5);
    const bar =
      colours[idx]("█".repeat(Math.max(0, barLen))) +
      dim("░".repeat(Math.max(0, 20 - barLen)));
    bt.push([label, `${formatRub(cost)} ${cur}`, `${pct}%`, bar]);
  });

  bt.push([
    bold("─── Итого без наценки"),
    bold(`${formatRub(b.subtotal)} ${cur}`),
    "",
    "",
  ]);
  if (b.profitAmount > 0) {
    bt.push([
      chalk.green("+ Наценка"),
      chalk.green(`${formatRub(b.profitAmount)} ${cur}`),
      `${inp.profitMarginPercent}%`,
      "",
    ]);
  }
  bt.push([
    bold(chalk.green("ИТОГО")),
    bold(chalk.green(`${formatRub(b.totalCost)} ${cur}`)),
    "",
    "",
  ]);

  console.log(bt.toString());

  console.log("");
  console.log(bold(info("  Удельные показатели")));
  kvTable([
    ["Стоимость за грамм", `${formatRub(m.costPerGram)} ${cur}/г`],
    ["Стоимость за см³", `${formatRub(m.costPerCm3)} ${cur}/см³`],
    ["Стоимость за слой", `${formatRub(m.costPerLayer)} ${cur}/слой`],
  ]);
}

// ─── Сводка выходных файлов ───────────────────────────────────────────────────

function printOutputSummary(files) {
  sectionHeader("ВЫХОДНЫЕ ФАЙЛЫ", "💾");
  for (const { label, path: p, sizeKb } of files) {
    const sizeStr = sizeKb !== undefined ? dim(` (${sizeKb} КБ)`) : "";
    console.log(
      `  ${ok("✔")}  ${bold(label.padEnd(36))}  ${info(p)}${sizeStr}`,
    );
  }
}

// ─── Итоговый баннер ──────────────────────────────────────────────────────────

function printFinalSummary({
  volumeResult,
  integrityResult,
  slicerResult,
  costResult,
}) {
  const line = "═".repeat(62);
  console.log("");
  console.log(chalk.bold.cyan(line));
  console.log(chalk.bold.white("  АНАЛИЗ ЗАВЕРШЁН — ИТОГОВАЯ СВОДКА"));
  console.log(chalk.bold.cyan(line));

  const rows = [];

  if (volumeResult) {
    rows.push(["Объём", bold(`${volumeResult.volumeCm3} см³`)]);
    rows.push(["Масса", bold(`${volumeResult.weightGrams} г`)]);
  }

  if (integrityResult) {
    const iv = integrityResult.isWatertight
      ? ok("✔  Герметичный")
      : err("✘  Не герметичный");
    rows.push(["Целостность", iv]);
    rows.push(["Оболочек", integrityResult.stats.shellCount.toString()]);
  }

  if (slicerResult) {
    rows.push(["Слоёв", bold(slicerResult.layerCount.toString())]);
    rows.push([
      "Столбиков поддержки",
      slicerResult.supportPillarCount > 0
        ? warn(slicerResult.supportPillarCount.toString())
        : ok("0  (не нужны)"),
    ]);
    rows.push([
      "Материала итого",
      bold(`${slicerResult.totalMaterialMm3} мм³`),
    ]);
  }

  if (costResult) {
    rows.push(["Время печати", bold(costResult.time.printTimeFormatted)]);
    rows.push(["Филамент", bold(`${costResult.filament.totalWeightGrams} г`)]);
    rows.push([
      "Итоговая цена",
      bold(chalk.green(costResult.totalCostFormatted)),
    ]);
  }

  kvTable(rows);
  console.log("");
}

// ─── Прогресс-хелперы ─────────────────────────────────────────────────────────

function step(msg) {
  process.stdout.write(chalk.cyan("  ⟳  ") + msg + " … ");
}

function stepDone(extra = "") {
  process.stdout.write(ok("готово") + (extra ? dim(`  ${extra}`) : "") + "\n");
}

function stepFail(msg) {
  process.stdout.write(err("ОШИБКА") + "\n");
  console.error("  " + err("✘  " + msg));
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function formatRub(val) {
  return Number(val).toFixed(2);
}

// ─── Экспорт ─────────────────────────────────────────────────────────────────

module.exports = {
  sectionHeader,
  kvTable,
  printVolumeReport,
  printIntegrityReport,
  printSlicerReport,
  printCostReport,
  printOutputSummary,
  printFinalSummary,
  step,
  stepDone,
  stepFail,
  ok,
  warn,
  err,
  info,
  bold,
  dim,
  formatRub,
};
