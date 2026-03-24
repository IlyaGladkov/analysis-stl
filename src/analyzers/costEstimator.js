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
  // ── PLA и его вариации ────────────────────────────────────────────────────
  PLA: { pricePerKg: 1800, density: 1.24, label: "PLA (стандартный)" },
  "PLA+": { pricePerKg: 2200, density: 1.24, label: "PLA+ (усиленный)" },
  "PLA Silk": { pricePerKg: 2500, density: 1.24, label: "PLA Silk (шёлковый)" },
  "PLA Matte": {
    pricePerKg: 2300,
    density: 1.24,
    label: "PLA Matte (матовый)",
  },
  "PLA Metal": {
    pricePerKg: 3500,
    density: 1.6,
    label: "PLA Metal (металлизированный)",
  },
  "PLA Wood": {
    pricePerKg: 3000,
    density: 1.15,
    label: "PLA Wood (с древесным наполнением)",
  },
  "PLA Marble": {
    pricePerKg: 2800,
    density: 1.27,
    label: "PLA Marble (под мрамор)",
  },
  "PLA Glow": {
    pricePerKg: 2600,
    density: 1.24,
    label: "PLA Glow (светящийся)",
  },
  "PLA-CF": {
    pricePerKg: 4500,
    density: 1.3,
    label: "PLA Carbon Fiber (с углеволокном)",
  },
  "PLA HT": { pricePerKg: 3200, density: 1.24, label: "PLA HT (термостойкий)" },

  // ── ABS и его вариации ────────────────────────────────────────────────────
  ABS: { pricePerKg: 1600, density: 1.04, label: "ABS (стандартный)" },
  "ABS+": { pricePerKg: 2000, density: 1.04, label: "ABS+ (усиленный)" },
  "ABS-CF": {
    pricePerKg: 4800,
    density: 1.1,
    label: "ABS Carbon Fiber (с углеволокном)",
  },
  ASA: { pricePerKg: 2400, density: 1.07, label: "ASA (УФ-стойкий)" },
  "ASA-CF": {
    pricePerKg: 5000,
    density: 1.12,
    label: "ASA Carbon Fiber (с углеволокном)",
  },

  // ── PETG и его вариации ───────────────────────────────────────────────────
  PETG: { pricePerKg: 2000, density: 1.27, label: "PETG (стандартный)" },
  "PETG-CF": {
    pricePerKg: 4500,
    density: 1.35,
    label: "PETG Carbon Fiber (с углеволокном)",
  },
  "PETG Silk": {
    pricePerKg: 2600,
    density: 1.27,
    label: "PETG Silk (шёлковый)",
  },
  "PETG HF": {
    pricePerKg: 2800,
    density: 1.27,
    label: "PETG High Flow (высокоскоростной)",
  },

  // ── TPU / гибкие ─────────────────────────────────────────────────────────
  TPU: { pricePerKg: 3200, density: 1.21, label: "TPU (гибкий, 95A)" },
  "TPU 85A": { pricePerKg: 3500, density: 1.2, label: "TPU 85A (мягкий)" },
  "TPU 98A": { pricePerKg: 3100, density: 1.22, label: "TPU 98A (жёсткий)" },
  TPE: { pricePerKg: 3800, density: 1.18, label: "TPE (эластомер)" },
  TPU95HF: {
    pricePerKg: 3600,
    density: 1.21,
    label: "TPU HF (высокоскоростной)",
  },

  // ── Нейлон и его вариации ─────────────────────────────────────────────────
  Nylon: { pricePerKg: 4000, density: 1.14, label: "Нейлон PA6" },
  "Nylon PA12": { pricePerKg: 4500, density: 1.01, label: "Нейлон PA12" },
  "Nylon CF": {
    pricePerKg: 7500,
    density: 1.2,
    label: "Нейлон Carbon Fiber (с углеволокном)",
  },
  "Nylon GF": {
    pricePerKg: 6000,
    density: 1.35,
    label: "Нейлон Glass Fiber (со стекловолокном)",
  },
  "Nylon+": {
    pricePerKg: 5000,
    density: 1.14,
    label: "Нейлон PA6+ (усиленный)",
  },

  // ── Высокотемпературные ───────────────────────────────────────────────────
  PC: { pricePerKg: 5000, density: 1.2, label: "Поликарбонат (PC)" },
  "PC-CF": {
    pricePerKg: 8000,
    density: 1.27,
    label: "PC Carbon Fiber (с углеволокном)",
  },
  "PC-ABS": { pricePerKg: 4000, density: 1.1, label: "PC-ABS (сплав)" },
  PEEK: { pricePerKg: 35000, density: 1.32, label: "PEEK (высокоэффективный)" },
  PEI: { pricePerKg: 25000, density: 1.27, label: "PEI / Ultem (жаростойкий)" },
  PEKK: { pricePerKg: 40000, density: 1.3, label: "PEKK (авиационный)" },
  PPS: { pricePerKg: 28000, density: 1.35, label: "PPS (химически стойкий)" },
  PSU: { pricePerKg: 22000, density: 1.24, label: "PSU (полисульфон)" },
  HIPS: {
    pricePerKg: 1700,
    density: 1.04,
    label: "HIPS (растворимые поддержки)",
  },

  // ── Специальные / экзотические ────────────────────────────────────────────
  PVOH: {
    pricePerKg: 12000,
    density: 1.23,
    label: "PVA / PVOH (водорастворимые поддержки)",
  },
  PP: { pricePerKg: 3500, density: 0.9, label: "Полипропилен (PP)" },
  "PP-CF": {
    pricePerKg: 6500,
    density: 1.0,
    label: "PP Carbon Fiber (с углеволокном)",
  },
  PMMA: { pricePerKg: 4500, density: 1.19, label: "PMMA / Акрил (прозрачный)" },
  "Co-Polyester": {
    pricePerKg: 3800,
    density: 1.23,
    label: "Co-Polyester (Amphora)",
  },
  PVB: { pricePerKg: 5000, density: 1.19, label: "PVB (полируемый)" },

  // ── Смоляные (для SLA/MSLA/DLP) ──────────────────────────────────────────
  Resin: { pricePerKg: 4500, density: 1.1, label: "Фотополимер стандартный" },
  "Resin ABS-like": {
    pricePerKg: 5000,
    density: 1.1,
    label: "Фотополимер ABS-подобный",
  },
  "Resin Tough": {
    pricePerKg: 6000,
    density: 1.15,
    label: "Фотополимер Tough (ударопрочный)",
  },
  "Resin Flexible": {
    pricePerKg: 7000,
    density: 1.1,
    label: "Фотополимер Flexible (гибкий)",
  },
  "Resin Castable": {
    pricePerKg: 12000,
    density: 1.05,
    label: "Фотополимер Castable (для литья)",
  },
  "Resin Dental": {
    pricePerKg: 20000,
    density: 1.15,
    label: "Фотополимер Dental (стоматологический)",
  },
  "Resin Water-Washable": {
    pricePerKg: 5500,
    density: 1.1,
    label: "Фотополимер водосмываемый",
  },
  "Resin 8K": {
    pricePerKg: 5000,
    density: 1.1,
    label: "Фотополимер 8K (высокодетализированный)",
  },
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
