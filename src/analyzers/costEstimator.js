"use strict";

/**
 * Оценщик стоимости печати
 *
 * Рассчитывает стоимость 3D-печати на основе данных слайсера:
 *  - Стоимость материала (по реальному расходу мм³ из слайсера)
 *  - Стоимость поддержек
 *  - Стоимость машинного времени (амортизация, обслуживание)
 *  - Стоимость электроэнергии
 *  - Стоимость труда оператора (опционально)
 *
 * Все цены в рублях (₽).
 */

// ─── Пресеты материалов ───────────────────────────────────────────────────────
// pricePerKg : цена за кг в рублях
// density    : плотность в г/см³

const MATERIAL_PRESETS = {
  PLA: { pricePerKg: 1800, density: 1.24, label: "PLA (стандартный)" },
  ABS: { pricePerKg: 1600, density: 1.04, label: "ABS (стандартный)" },
  PETG: { pricePerKg: 2000, density: 1.27, label: "PETG (стандартный)" },
  TPU: { pricePerKg: 3200, density: 1.21, label: "TPU (гибкий)" },
  ASA: { pricePerKg: 2400, density: 1.07, label: "ASA (УФ-стойкий)" },
  Nylon: { pricePerKg: 4000, density: 1.14, label: "Нейлон" },
  Resin: { pricePerKg: 4500, density: 1.1, label: "Фотополимер (смола)" },
};

// ─── Пресеты принтеров ────────────────────────────────────────────────────────
// printSpeedMmS  : средняя скорость печати мм/с (с учётом разгонов и перемещений)
// powerWatts     : средняя потребляемая мощность Вт
// pricePerHour   : стоимость амортизации + обслуживания ₽/ч

const PRINTER_PRESETS = {
  // ── FDM-принтеры ──────────────────────────────────────────────────────────
  "Ender 3": { printSpeedMmS: 50, powerWatts: 120, pricePerHour: 30 },
  "Ender 3 V3 SE": { printSpeedMmS: 80, powerWatts: 150, pricePerHour: 40 },
  "Ender 3 S1 Pro": { printSpeedMmS: 60, powerWatts: 200, pricePerHour: 45 },
  "Creality K1": { printSpeedMmS: 200, powerWatts: 350, pricePerHour: 85 },
  "Creality K1 Max": { printSpeedMmS: 120, powerWatts: 300, pricePerHour: 90 },
  "Creality K2 Plus": {
    printSpeedMmS: 300,
    powerWatts: 500,
    pricePerHour: 130,
  },
  "Prusa MK3S+": { printSpeedMmS: 60, powerWatts: 120, pricePerHour: 60 },
  "Prusa MK4": { printSpeedMmS: 80, powerWatts: 150, pricePerHour: 75 },
  "Prusa XL": { printSpeedMmS: 80, powerWatts: 200, pricePerHour: 100 },
  "Prusa MINI+": { printSpeedMmS: 60, powerWatts: 90, pricePerHour: 50 },
  "Bambu Lab X1C": { printSpeedMmS: 150, powerWatts: 350, pricePerHour: 120 },
  "Bambu Lab X1E": { printSpeedMmS: 150, powerWatts: 400, pricePerHour: 140 },
  "Bambu Lab P1S": { printSpeedMmS: 150, powerWatts: 320, pricePerHour: 110 },
  "Bambu Lab P1P": { printSpeedMmS: 150, powerWatts: 300, pricePerHour: 95 },
  "Bambu Lab A1": { printSpeedMmS: 100, powerWatts: 250, pricePerHour: 75 },
  "Bambu Lab A1 Mini": {
    printSpeedMmS: 100,
    powerWatts: 200,
    pricePerHour: 65,
  },
  "Voron 2.4": { printSpeedMmS: 150, powerWatts: 400, pricePerHour: 100 },
  "Voron Trident": { printSpeedMmS: 150, powerWatts: 350, pricePerHour: 95 },
  "Voron 0.2": { printSpeedMmS: 100, powerWatts: 120, pricePerHour: 60 },
  "Artillery Sidewinder X3 Pro": {
    printSpeedMmS: 150,
    powerWatts: 350,
    pricePerHour: 70,
  },
  "Artillery Genius Pro": {
    printSpeedMmS: 80,
    powerWatts: 180,
    pricePerHour: 45,
  },
  "AnkerMake M5C": { printSpeedMmS: 167, powerWatts: 300, pricePerHour: 80 },
  "AnkerMake M7": { printSpeedMmS: 167, powerWatts: 350, pricePerHour: 95 },
  "FlashForge Creator 3 Pro": {
    printSpeedMmS: 80,
    powerWatts: 800,
    pricePerHour: 120,
  },
  "FlashForge Adventurer 5M": {
    printSpeedMmS: 167,
    powerWatts: 300,
    pricePerHour: 75,
  },
  "Qidi X-Max 3": { printSpeedMmS: 200, powerWatts: 350, pricePerHour: 90 },
  "Qidi Tech X-CF Pro": {
    printSpeedMmS: 100,
    powerWatts: 400,
    pricePerHour: 110,
  },
  "RatRig V-Core 4": { printSpeedMmS: 200, powerWatts: 500, pricePerHour: 115 },
  "Neptune 4 Pro": { printSpeedMmS: 150, powerWatts: 280, pricePerHour: 55 },
  "Neptune 4 Max": { printSpeedMmS: 150, powerWatts: 350, pricePerHour: 65 },

  // ── Смоляные (SLA/MSLA/DLP) ───────────────────────────────────────────────
  "Formlabs Form 3": { printSpeedMmS: 20, powerWatts: 85, pricePerHour: 300 },
  "Formlabs Form 3L": { printSpeedMmS: 20, powerWatts: 120, pricePerHour: 450 },
  "Formlabs Form 4": { printSpeedMmS: 40, powerWatts: 100, pricePerHour: 350 },
  "Elegoo Saturn 4 Ultra": {
    printSpeedMmS: 30,
    powerWatts: 120,
    pricePerHour: 120,
  },
  "Elegoo Mars 4 Ultra": {
    printSpeedMmS: 30,
    powerWatts: 80,
    pricePerHour: 90,
  },
  "Anycubic Photon Mono X2": {
    printSpeedMmS: 25,
    powerWatts: 80,
    pricePerHour: 85,
  },
  "Anycubic Photon M7 Pro": {
    printSpeedMmS: 35,
    powerWatts: 100,
    pricePerHour: 100,
  },
  "Phrozen Sonic Mega 8K S": {
    printSpeedMmS: 30,
    powerWatts: 130,
    pricePerHour: 130,
  },
  "SparkMaker Ultra": { printSpeedMmS: 20, powerWatts: 60, pricePerHour: 70 },

  // ── Промышленные / профессиональные ──────────────────────────────────────
  "Ultimaker S7": { printSpeedMmS: 70, powerWatts: 350, pricePerHour: 400 },
  "Ultimaker S5": { printSpeedMmS: 60, powerWatts: 300, pricePerHour: 320 },
  "MakerBot Method X": {
    printSpeedMmS: 75,
    powerWatts: 250,
    pricePerHour: 350,
  },
  "Markforged Mark Two": {
    printSpeedMmS: 40,
    powerWatts: 200,
    pricePerHour: 600,
  },
  "Stratasys F170": { printSpeedMmS: 30, powerWatts: 1100, pricePerHour: 800 },
  "HP Jet Fusion 5200": {
    printSpeedMmS: 10,
    powerWatts: 3000,
    pricePerHour: 2500,
  },

  // ── Стандартные / универсальные ───────────────────────────────────────────
  "Стандартный FDM": { printSpeedMmS: 60, powerWatts: 150, pricePerHour: 45 },
  "Стандартный MSLA": { printSpeedMmS: 25, powerWatts: 90, pricePerHour: 90 },
};

// ─── Оценка времени печати ────────────────────────────────────────────────────

/**
 * Рассчитывает общее время печати в секундах.
 *
 * Модель расчёта для каждого слоя:
 *   - Периметры (оболочки): длина периметра × количество оболочек / скорость
 *   - Заполнение: (площадь / расстояние_между_линиями) / скорость
 *   - Накладные расходы смены слоя: фиксированное время
 *
 * @param {object} slicerResult   — результат slicerEngine.slice()
 * @param {object} printerOptions
 * @param {number} printerOptions.printSpeedMmS      — средняя скорость мм/с
 * @param {number} [printerOptions.travelSpeedMmS=150] — скорость перемещений мм/с
 * @param {number} [printerOptions.layerChangeSec=2]   — накладные расходы на слой (с)
 * @returns {number} секунды
 */
function estimatePrintTimeSec(slicerResult, printerOptions = {}) {
  const printSpeed = printerOptions.printSpeedMmS || 60;
  const travelSpeed = printerOptions.travelSpeedMmS || 150;
  const layerOverhead = printerOptions.layerChangeSec || 2;

  const { layers, settings } = slicerResult;
  const { nozzleDiameter, shellCount, infillDensity } = settings;

  let totalSec = 0;

  for (const layer of layers) {
    let layerSec = 0;

    for (const contour of layer.contours) {
      // ── Периметры ────────────────────────────────────────────────────────────
      let perimeter = 0;
      for (let i = 0; i < contour.length; i++) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        perimeter += Math.hypot(b.x - a.x, b.y - a.y);
      }
      layerSec += (perimeter * shellCount) / printSpeed;

      // ── Заполнение ───────────────────────────────────────────────────────────
      const area = contour.reduce((sum, _, i) => {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        return sum + (a.x * b.y - b.x * a.y);
      }, 0);
      const absArea = Math.abs(area) / 2;

      if (absArea > 0 && infillDensity > 0) {
        const lineSpacing = nozzleDiameter / infillDensity;
        const infillLength = (absArea / lineSpacing) * 1.05;
        layerSec += infillLength / printSpeed;
      }

      // ── Перемещения (оценка ~5% от периметра) ─────────────────────────────
      layerSec += (perimeter * 0.05) / travelSpeed;
    }

    // ── Поддержки добавляют ~15% времени на слой ─────────────────────────────
    if (layer.hasSupportAt) {
      layerSec *= 1.15;
    }

    layerSec += layerOverhead;
    totalSec += layerSec;
  }

  // Прогрев стола и сопла (5 минут фиксированно)
  totalSec += 300;

  return totalSec;
}

// ─── Объём филамента → длина и масса ─────────────────────────────────────────

/**
 * Пересчитывает объём филамента (мм³) в длину (мм) и массу (г).
 *
 * @param {number} volumeMm3           — объём в мм³
 * @param {number} filamentDiameterMm  — диаметр катушки (1.75 или 2.85)
 * @param {number} densityGcm3         — плотность материала г/см³
 * @returns {{ lengthMm: number, weightGrams: number }}
 */
function filamentStats(
  volumeMm3,
  filamentDiameterMm = 1.75,
  densityGcm3 = 1.24,
) {
  const radius = filamentDiameterMm / 2;
  const crossSection = Math.PI * radius * radius; // мм²
  const lengthMm = volumeMm3 / crossSection;
  const weightGrams = (volumeMm3 / 1000) * densityGcm3; // г/см³ = г/1000мм³

  return {
    lengthMm: Math.round(lengthMm * 100) / 100,
    weightGrams: Math.round(weightGrams * 10000) / 10000,
  };
}

// ─── Главная функция расчёта стоимости ───────────────────────────────────────

/**
 * Рассчитывает полную стоимость 3D-печати модели.
 *
 * @param {object} slicerResult   — результат slicerEngine.slice()
 * @param {object} options
 *
 * -- Материал --
 * @param {string} [options.material='PLA']           — название материала
 * @param {number} [options.materialPricePerKg]       — переопределить цену за кг (₽)
 * @param {number} [options.materialDensity]          — переопределить плотность (г/см³)
 * @param {number} [options.filamentDiameter=1.75]    — диаметр прутка (мм)
 * @param {number} [options.wasteFactor=1.05]         — коэффициент отходов
 *
 * -- Принтер --
 * @param {string} [options.printer='Стандартный FDM'] — название принтера
 * @param {number} [options.printSpeedMmS]             — переопределить скорость мм/с
 * @param {number} [options.powerWatts]                — переопределить мощность Вт
 * @param {number} [options.machineHourRate]           — переопределить стоимость ₽/ч
 *
 * -- Электроэнергия --
 * @param {number} [options.electricityPricePerKwh=6] — цена кВт·ч в рублях
 *
 * -- Труд --
 * @param {number} [options.operatorHourlyRate=0]      — ставка оператора ₽/ч
 * @param {number} [options.prepTimeMins=5]            — время подготовки (мин)
 * @param {number} [options.postProcessTimeMins=10]    — постобработка (мин)
 *
 * -- Наценка --
 * @param {number} [options.profitMarginPercent=0]     — процент наценки
 *
 * @returns {CostResult}
 */
function estimateCost(slicerResult, options = {}) {
  const currency = "₽";

  // ── Материал ──────────────────────────────────────────────────────────────
  const materialName = options.material || "PLA";
  const matPreset = MATERIAL_PRESETS[materialName] || MATERIAL_PRESETS.PLA;
  const pricePerKg =
    options.materialPricePerKg !== undefined
      ? options.materialPricePerKg
      : matPreset.pricePerKg;
  const density =
    options.materialDensity !== undefined
      ? options.materialDensity
      : matPreset.density;
  const filamentDiam = options.filamentDiameter || 1.75;
  const wasteFactor = options.wasteFactor || 1.05;

  // ── Принтер ───────────────────────────────────────────────────────────────
  const printerName = options.printer || "Стандартный FDM";
  const prtPreset =
    PRINTER_PRESETS[printerName] || PRINTER_PRESETS["Стандартный FDM"];
  const printSpeedMmS =
    options.printSpeedMmS !== undefined
      ? options.printSpeedMmS
      : prtPreset.printSpeedMmS;
  const powerWatts =
    options.powerWatts !== undefined
      ? options.powerWatts
      : prtPreset.powerWatts;
  const machineHourRate =
    options.machineHourRate !== undefined
      ? options.machineHourRate
      : prtPreset.pricePerHour;

  // ── Электроэнергия ────────────────────────────────────────────────────────
  // Средний тариф по России ~6 ₽/кВт·ч
  const electricityRate =
    options.electricityPricePerKwh !== undefined
      ? options.electricityPricePerKwh
      : 6;

  // ── Труд ──────────────────────────────────────────────────────────────────
  const operatorRate = options.operatorHourlyRate || 0;
  const prepTimeMins =
    options.prepTimeMins !== undefined ? options.prepTimeMins : 5;
  const postProcessTimeMins =
    options.postProcessTimeMins !== undefined
      ? options.postProcessTimeMins
      : 10;

  // ── Наценка ───────────────────────────────────────────────────────────────
  const profitMargin = options.profitMarginPercent || 0;

  // ── Объёмы из слайсера ────────────────────────────────────────────────────
  const modelVolumeMm3 = slicerResult.totalFilamentMm3 || 0;
  const supportVolumeMm3 = slicerResult.totalSupportMm3 || 0;
  const rawVolumeMm3 = modelVolumeMm3 + supportVolumeMm3;
  const totalVolumeMm3 = rawVolumeMm3 * wasteFactor;

  // ── Характеристики филамента ──────────────────────────────────────────────
  const modelFilament = filamentStats(modelVolumeMm3, filamentDiam, density);
  const supportFilament = filamentStats(
    supportVolumeMm3,
    filamentDiam,
    density,
  );
  const totalFilament = filamentStats(totalVolumeMm3, filamentDiam, density);

  // ── Стоимость материала ───────────────────────────────────────────────────
  const pricePerGram = pricePerKg / 1000;
  const materialCost = totalFilament.weightGrams * pricePerGram;
  const modelMatCost = modelFilament.weightGrams * pricePerGram;
  const supportMatCost = supportFilament.weightGrams * pricePerGram;

  // ── Время печати ──────────────────────────────────────────────────────────
  const printTimeSec = estimatePrintTimeSec(slicerResult, {
    printSpeedMmS,
    travelSpeedMmS: options.travelSpeedMmS || 150,
    layerChangeSec: options.layerChangeSec || 2,
  });
  const printTimeMin = printTimeSec / 60;
  const printTimeHour = printTimeSec / 3600;

  // ── Стоимость машинного времени ───────────────────────────────────────────
  const machineCost = machineHourRate * printTimeHour;

  // ── Стоимость электроэнергии ──────────────────────────────────────────────
  const energyKwh = (powerWatts / 1000) * printTimeHour;
  const electricityCost = energyKwh * electricityRate;

  // ── Стоимость труда ───────────────────────────────────────────────────────
  const totalLaborMins = prepTimeMins + postProcessTimeMins;
  const laborCost = operatorRate * (totalLaborMins / 60);

  // ── Себестоимость ─────────────────────────────────────────────────────────
  const subtotal = materialCost + machineCost + electricityCost + laborCost;

  // ── Наценка и итог ────────────────────────────────────────────────────────
  const profitAmount = subtotal * (profitMargin / 100);
  const totalCost = subtotal + profitAmount;

  // ── Удельные показатели ───────────────────────────────────────────────────
  const costPerGram =
    totalFilament.weightGrams > 0 ? totalCost / totalFilament.weightGrams : 0;
  const costPerCm3 =
    totalVolumeMm3 > 0 ? totalCost / (totalVolumeMm3 / 1000) : 0;

  // ── Вспомогательные функции ───────────────────────────────────────────────
  function r(val, dec = 4) {
    const f = Math.pow(10, dec);
    return Math.round(val * f) / f;
  }

  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (h > 0) parts.push(`${h} ч`);
    if (m > 0) parts.push(`${m} мин`);
    parts.push(`${s} с`);
    return parts.join(" ");
  }

  return {
    currency,

    // ── Входные параметры ───────────────────────────────────────────────────
    inputs: {
      material: materialName,
      pricePerKg: r(pricePerKg, 2),
      density,
      filamentDiameter: filamentDiam,
      wasteFactor,
      printer: printerName,
      printSpeedMmS,
      powerWatts,
      machineHourRate: r(machineHourRate, 2),
      electricityRate,
      operatorRate,
      prepTimeMins,
      postProcessTimeMins,
      profitMarginPercent: profitMargin,
    },

    // ── Расход филамента ────────────────────────────────────────────────────
    filament: {
      modelVolumeMm3: r(modelVolumeMm3, 2),
      supportVolumeMm3: r(supportVolumeMm3, 2),
      wasteVolumeMm3: r(rawVolumeMm3 * (wasteFactor - 1), 2),
      totalVolumeMm3: r(totalVolumeMm3, 2),

      modelLengthMm: modelFilament.lengthMm,
      supportLengthMm: supportFilament.lengthMm,
      totalLengthMm: totalFilament.lengthMm,
      totalLengthM: r(totalFilament.lengthMm / 1000, 3),

      modelWeightGrams: r(modelFilament.weightGrams, 3),
      supportWeightGrams: r(supportFilament.weightGrams, 3),
      totalWeightGrams: r(totalFilament.weightGrams, 3),
    },

    // ── Время печати ────────────────────────────────────────────────────────
    time: {
      printTimeSec: Math.round(printTimeSec),
      printTimeMin: r(printTimeMin, 2),
      printTimeHour: r(printTimeHour, 4),
      printTimeFormatted: formatTime(printTimeSec),
      energyKwh: r(energyKwh, 4),
    },

    // ── Структура стоимости ─────────────────────────────────────────────────
    breakdown: {
      materialCost: r(materialCost, 4),
      modelMatCost: r(modelMatCost, 4),
      supportMatCost: r(supportMatCost, 4),
      machineCost: r(machineCost, 4),
      electricityCost: r(electricityCost, 4),
      laborCost: r(laborCost, 4),
      subtotal: r(subtotal, 4),
      profitAmount: r(profitAmount, 4),
      totalCost: r(totalCost, 4),
    },

    // ── Удельные показатели ─────────────────────────────────────────────────
    metrics: {
      costPerGram: r(costPerGram, 4),
      costPerCm3: r(costPerCm3, 4),
      costPerLayer:
        slicerResult.layerCount > 0
          ? r(totalCost / slicerResult.layerCount, 6)
          : 0,
      materialPercent: r(subtotal > 0 ? (materialCost / subtotal) * 100 : 0, 1),
      machinePercent: r(subtotal > 0 ? (machineCost / subtotal) * 100 : 0, 1),
      electricityPercent: r(
        subtotal > 0 ? (electricityCost / subtotal) * 100 : 0,
        1,
      ),
      laborPercent: r(subtotal > 0 ? (laborCost / subtotal) * 100 : 0, 1),
    },

    // ── Итог ────────────────────────────────────────────────────────────────
    totalCost: r(totalCost, 4),
    totalCostFormatted: `${r(totalCost, 2).toFixed(2)} ${currency}`,
  };
}

/**
 * Возвращает список пресетов материалов.
 */
function getMaterialPresets() {
  return Object.entries(MATERIAL_PRESETS).map(([name, preset]) => ({
    name,
    ...preset,
  }));
}

/**
 * Возвращает список пресетов принтеров.
 */
function getPrinterPresets() {
  return Object.entries(PRINTER_PRESETS).map(([name, preset]) => ({
    name,
    ...preset,
  }));
}

module.exports = {
  estimateCost,
  estimatePrintTimeSec,
  filamentStats,
  getMaterialPresets,
  getPrinterPresets,
  MATERIAL_PRESETS,
  PRINTER_PRESETS,
};
