'use strict';

/**
 * STL Analyzer - Main Library Export
 *
 * This is the main entry point for the stl-analyzer npm package.
 * All public APIs are exported from here.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Core Analysis Functions
// ──────────────────────────────────────────────────────────────────────────────

const {
  analyzeVolume,
  getMaterialPresets: getVolumeMaterialPresets,
} = require('../src/analyzers/volumeAnalyzer');

const { analyzeIntegrity } = require('../src/analyzers/integrityAnalyzer');

const { slice, mergeWithSupports } = require('../src/slicer/slicerEngine');

const {
  estimateCost,
  getMaterialPresets: getCostMaterialPresets,
  getPrinterPresets,
} = require('../src/analyzers/costEstimator');

// ──────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ──────────────────────────────────────────────────────────────────────────────

const {
  parseSTL,
  writeBinarySTL,
  getBoundingBox,
} = require('../src/utils/stlParser');

const reporter = require('../src/utils/reporter');

// ──────────────────────────────────────────────────────────────────────────────
// Public API Exports
// ──────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Volume Analysis ────────────────────────────────────────────────────────
  /**
   * Analyze the volume and physical properties of an STL file
   * @param {string} filePath - path to .stl file
   * @param {object} options - analysis options
   * @returns {object} volume analysis results
   */
  analyzeVolume,

  /**
   * Get available material presets for volume calculation
   * @returns {array} array of material presets with density information
   */
  getVolumeMaterialPresets,

  // ── Integrity Analysis ─────────────────────────────────────────────────────
  /**
   * Analyze mesh integrity (watertightness, manifoldness, etc.)
   * @param {array} triangles - array of triangle objects
   * @returns {object} integrity analysis results
   */
  analyzeIntegrity,

  // ── Slicing ────────────────────────────────────────────────────────────────
  /**
   * Slice model into layers and detect supports
   * @param {array} triangles - array of triangle objects
   * @param {object} options - slicing options
   * @returns {object} slicing results with layer information
   */
  slice,

  /**
   * Merge original model triangles with support triangles
   * @param {array} triangles - original model triangles
   * @param {object} slicerResult - result from slice() function
   * @returns {array} merged triangle array
   */
  mergeWithSupports,

  // ── Cost Estimation ────────────────────────────────────────────────────────
  /**
   * Estimate print cost based on slicer data
   * @param {object} slicerResult - result from slice() function
   * @param {object} options - cost estimation options
   * @returns {object} cost breakdown and total
   */
  estimateCost,

  /**
   * Get available material presets for cost estimation
   * @returns {array} array of material presets with pricing
   */
  getCostMaterialPresets,

  /**
   * Get available printer presets
   * @returns {array} array of printer presets with specifications
   */
  getPrinterPresets,

  // ── STL Utilities ──────────────────────────────────────────────────────────
  /**
   * Parse binary STL file into array of triangles
   * @param {string} filePath - path to .stl file
   * @returns {array} array of triangle objects {v1, v2, v3, normal}
   */
  parseSTL,

  /**
   * Write triangles to binary STL file
   * @param {array} triangles - array of triangle objects
   * @param {string} outputPath - output file path
   */
  writeBinarySTL,

  /**
   * Get bounding box of triangles
   * @param {array} triangles - array of triangle objects
   * @returns {object} bounding box {min: {x,y,z}, max: {x,y,z}}
   */
  getBoundingBox,

  // ── Reporting ──────────────────────────────────────────────────────────────
  /**
   * Reporting utilities for formatting analysis results
   */
  reporter,
};

// ──────────────────────────────────────────────────────────────────────────────
// Version Export
// ──────────────────────────────────────────────────────────────────────────────

module.exports.version = '1.0.0';
