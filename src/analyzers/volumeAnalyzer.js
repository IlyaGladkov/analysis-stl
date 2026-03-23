'use strict';

const NodeStl = require('node-stl');

/**
 * Volume Analyzer
 * Uses node-stl to calculate volume, weight, bounding box,
 * surface area, and center of mass of an STL model.
 */

// Material density presets (g/cm³)
const MATERIAL_DENSITIES = {
  PLA:        1.24,
  ABS:        1.04,
  PETG:       1.27,
  TPU:        1.21,
  ASA:        1.07,
  Nylon:      1.14,
  Resin:      1.10,
  custom:     1.00,
};

/**
 * Analyze the volume and physical properties of an STL file.
 *
 * @param {string} filePath - absolute or relative path to .stl file
 * @param {object} options
 * @param {string} [options.material='PLA']   - material name (key of MATERIAL_DENSITIES)
 * @param {number} [options.density]          - override density (g/cm³)
 * @returns {VolumeResult}
 */
function analyzeVolume(filePath, options = {}) {
  const material = options.material || 'PLA';
  const density  = options.density  || MATERIAL_DENSITIES[material] || MATERIAL_DENSITIES.PLA;

  let stl;
  try {
    stl = new NodeStl(filePath, { density });
  } catch (err) {
    throw new Error(`node-stl failed to parse file: ${err.message}`);
  }

  // node-stl exposes volume in cm³, weight in grams
  const volumeCm3   = Math.abs(stl.volume   || 0);
  const weightGrams = Math.abs(stl.weight   || 0);
  const areaMm2     = Math.abs(stl.area     || 0);       // surface area in mm² (node-stl returns mm)
  const boundingBox = stl.boundingBox || [0, 0, 0];       // [x, y, z] in mm
  const centerOfMass = stl.centerOfMass || [0, 0, 0];     // [x, y, z] in mm
  const isWatertight = stl.isWatertight !== undefined ? stl.isWatertight : null;

  // Convert units
  const volumeMm3    = volumeCm3 * 1000;                 // cm³ → mm³
  const volumeIn3    = volumeCm3 * 0.0610237;            // cm³ → in³
  const weightKg     = weightGrams / 1000;
  const areaCm2      = areaMm2 / 100;                    // mm² → cm²

  // Bounding box volume (how much space the model occupies)
  const bboxVolumeMm3 = boundingBox[0] * boundingBox[1] * boundingBox[2];
  // Fill ratio: how much of the bounding box is the actual model
  const fillRatio = bboxVolumeMm3 > 0 ? (volumeMm3 / bboxVolumeMm3) * 100 : 0;

  return {
    material,
    density,

    // Volume
    volumeCm3:    round(volumeCm3, 4),
    volumeMm3:    round(volumeMm3, 2),
    volumeIn3:    round(volumeIn3, 6),

    // Weight
    weightGrams:  round(weightGrams, 4),
    weightKg:     round(weightKg, 6),

    // Surface area
    areaMm2:      round(areaMm2, 4),
    areaCm2:      round(areaCm2, 4),

    // Bounding box  [width, depth, height] in mm
    boundingBox: {
      x: round(boundingBox[0], 3),
      y: round(boundingBox[1], 3),
      z: round(boundingBox[2], 3),
    },

    // Center of mass [x, y, z] in mm
    centerOfMass: {
      x: round(centerOfMass[0], 3),
      y: round(centerOfMass[1], 3),
      z: round(centerOfMass[2], 3),
    },

    // Derived
    bboxVolumeMm3: round(bboxVolumeMm3, 2),
    fillRatio:     round(fillRatio, 2),   // %

    // Watertight (from node-stl, may be null if not determinable)
    isWatertight,
  };
}

/**
 * Return available material presets with their densities.
 */
function getMaterialPresets() {
  return Object.entries(MATERIAL_DENSITIES).map(([name, density]) => ({
    name,
    density,
  }));
}

function round(val, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

module.exports = {
  analyzeVolume,
  getMaterialPresets,
  MATERIAL_DENSITIES,
};
