"use strict";

/**
 * Sample STL Generator
 *
 * Generates simple geometric STL models for testing purposes.
 * All models are written as binary STL files.
 *
 * Available shapes:
 *  - cube(size)
 *  - sphere(radius, segments)
 *  - cylinder(radius, height, segments)
 *  - torus(majorRadius, minorRadius, majorSegments, minorSegments)
 *  - overhangTest()   — a model with deliberate overhangs to test support detection
 */

const fs = require("fs");
const path = require("path");

// ─── Vector helpers ───────────────────────────────────────────────────────────

function vec3(x, y, z) {
  return { x, y, z };
}

function vecSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vecCross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vecNorm(a) {
  const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  if (l < 1e-12) return { x: 0, y: 0, z: 1 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

function computeNormal(v1, v2, v3) {
  return vecNorm(vecCross(vecSub(v2, v1), vecSub(v3, v1)));
}

function makeTri(v1, v2, v3) {
  return { normal: computeNormal(v1, v2, v3), v1, v2, v3 };
}

// ─── Binary STL writer ────────────────────────────────────────────────────────

function writeBinarySTL(triangles, outputPath) {
  const headerBuf = Buffer.alloc(80, 0);
  headerBuf.write("STL Analyzer — sample geometry", 0, "ascii");

  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(triangles.length, 0);

  const triBufs = triangles.map((tri) => {
    const buf = Buffer.alloc(50, 0);
    let off = 0;

    const n = tri.normal;
    buf.writeFloatLE(n.x, off);
    off += 4;
    buf.writeFloatLE(n.y, off);
    off += 4;
    buf.writeFloatLE(n.z, off);
    off += 4;

    for (const v of [tri.v1, tri.v2, tri.v3]) {
      buf.writeFloatLE(v.x, off);
      off += 4;
      buf.writeFloatLE(v.y, off);
      off += 4;
      buf.writeFloatLE(v.z, off);
      off += 4;
    }

    buf.writeUInt16LE(0, off);
    return buf;
  });

  fs.writeFileSync(
    outputPath,
    Buffer.concat([headerBuf, countBuf, ...triBufs]),
  );
  return outputPath;
}

// ─── CUBE ─────────────────────────────────────────────────────────────────────

/**
 * Generate a solid cube centered at origin.
 * @param {number} size  - side length in mm
 */
function generateCube(size = 20) {
  const h = size / 2;

  // 8 vertices
  const v = {
    lbf: vec3(-h, -h, -h), // left-bottom-front
    rbf: vec3(h, -h, -h),
    rtf: vec3(h, h, -h),
    ltf: vec3(-h, h, -h),
    lbb: vec3(-h, -h, h), // left-bottom-back
    rbb: vec3(h, -h, h),
    rtb: vec3(h, h, h),
    ltb: vec3(-h, h, h),
  };

  const tris = [];

  // Bottom face (z = -h)  normal: 0,0,-1
  tris.push(makeTri(v.lbf, v.rtf, v.rbf));
  tris.push(makeTri(v.lbf, v.ltf, v.rtf));

  // Top face (z = +h)  normal: 0,0,+1
  tris.push(makeTri(v.lbb, v.rbb, v.rtb));
  tris.push(makeTri(v.lbb, v.rtb, v.ltb));

  // Front face (y = -h)  normal: 0,-1,0
  tris.push(makeTri(v.lbf, v.rbf, v.rbb));
  tris.push(makeTri(v.lbf, v.rbb, v.lbb));

  // Back face (y = +h)  normal: 0,+1,0
  tris.push(makeTri(v.ltf, v.rtb, v.rtf));
  tris.push(makeTri(v.ltf, v.ltb, v.rtb));

  // Left face (x = -h)  normal: -1,0,0
  tris.push(makeTri(v.lbf, v.lbb, v.ltb));
  tris.push(makeTri(v.lbf, v.ltb, v.ltf));

  // Right face (x = +h)  normal: +1,0,0
  tris.push(makeTri(v.rbf, v.rtf, v.rtb));
  tris.push(makeTri(v.rbf, v.rtb, v.rbb));

  return tris;
}

// ─── SPHERE ───────────────────────────────────────────────────────────────────

/**
 * Generate a UV-sphere.
 * @param {number} radius    - radius in mm
 * @param {number} segments  - number of latitude/longitude subdivisions
 */
function generateSphere(radius = 15, segments = 24) {
  const tris = [];

  // Pre-compute all rings of vertices to avoid duplicate pole points
  // ring[0] = north pole (single point), ring[segments] = south pole (single point)
  // ring[i] for 1 <= i < segments: array of `segments` points

  const rings = [];
  for (let lat = 0; lat <= segments; lat++) {
    const theta = (lat / segments) * Math.PI;
    if (lat === 0) {
      // North pole — single shared vertex
      rings.push(spherePoint(radius, theta, 0));
    } else if (lat === segments) {
      // South pole — single shared vertex
      rings.push(spherePoint(radius, theta, 0));
    } else {
      const ring = [];
      for (let lon = 0; lon < segments; lon++) {
        const phi = (lon / segments) * 2 * Math.PI;
        ring.push(spherePoint(radius, theta, phi));
      }
      rings.push(ring);
    }
  }

  for (let lat = 0; lat < segments; lat++) {
    for (let lon = 0; lon < segments; lon++) {
      const lon1 = (lon + 1) % segments;

      if (lat === 0) {
        // North-pole cap: single apex + one edge of the first ring
        const apex = rings[0];
        const v10 = rings[1][lon];
        const v11 = rings[1][lon1];
        tris.push(makeTri(apex, v10, v11));
      } else if (lat === segments - 1) {
        // South-pole cap: one edge of the last full ring + single apex
        const v00 = rings[lat][lon];
        const v01 = rings[lat][lon1];
        const apex = rings[segments];
        tris.push(makeTri(v00, apex, v01));
      } else {
        // Middle band: two triangles per quad
        const v00 = rings[lat][lon];
        const v10 = rings[lat + 1][lon];
        const v01 = rings[lat][lon1];
        const v11 = rings[lat + 1][lon1];
        tris.push(makeTri(v00, v10, v11));
        tris.push(makeTri(v00, v11, v01));
      }
    }
  }

  return tris;
}

function spherePoint(r, theta, phi) {
  return vec3(
    r * Math.sin(theta) * Math.cos(phi),
    r * Math.sin(theta) * Math.sin(phi),
    r * Math.cos(theta),
  );
}

// ─── CYLINDER ────────────────────────────────────────────────────────────────

/**
 * Generate a closed cylinder standing on the Z axis.
 * @param {number} radius   - radius in mm
 * @param {number} height   - height in mm
 * @param {number} segments - number of sides
 */
function generateCylinder(radius = 10, height = 30, segments = 32) {
  const tris = [];
  const topZ = height / 2;
  const bottomZ = -height / 2;

  const topCenter = vec3(0, 0, topZ);
  const bottomCenter = vec3(0, 0, bottomZ);

  const topRing = [];
  const bottomRing = [];

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    topRing.push(vec3(x, y, topZ));
    bottomRing.push(vec3(x, y, bottomZ));
  }

  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;

    // Side wall — two triangles per quad
    tris.push(makeTri(topRing[i], bottomRing[i], bottomRing[j]));
    tris.push(makeTri(topRing[i], bottomRing[j], topRing[j]));

    // Top cap
    tris.push(makeTri(topCenter, topRing[j], topRing[i]));

    // Bottom cap
    tris.push(makeTri(bottomCenter, bottomRing[i], bottomRing[j]));
  }

  return tris;
}

// ─── TORUS ────────────────────────────────────────────────────────────────────

/**
 * Generate a torus lying in the XY plane.
 * @param {number} majorRadius  - distance from torus center to tube center
 * @param {number} minorRadius  - radius of the tube
 * @param {number} majorSeg     - segments around the torus ring
 * @param {number} minorSeg     - segments around the tube cross-section
 */
function generateTorus(
  majorRadius = 20,
  minorRadius = 6,
  majorSeg = 36,
  minorSeg = 18,
) {
  const tris = [];

  // Build vertex grid — only [0..majorSeg-1][0..minorSeg-1] unique vertices.
  // The last row/column wraps back to index 0 to guarantee exact vertex reuse
  // and avoid floating-point seam mismatches (e.g. sin(2π) ≠ 0 exactly).
  const grid = [];
  for (let i = 0; i < majorSeg; i++) {
    const u = (i / majorSeg) * 2 * Math.PI;
    const cosU = Math.cos(u);
    const sinU = Math.sin(u);
    const row = [];
    for (let j = 0; j < minorSeg; j++) {
      const v = (j / minorSeg) * 2 * Math.PI;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);
      const x = (majorRadius + minorRadius * cosV) * cosU;
      const y = (majorRadius + minorRadius * cosV) * sinU;
      const z = minorRadius * sinV;
      row.push(vec3(x, y, z));
    }
    grid.push(row);
  }

  // Build triangles from grid quads, wrapping indices with modulo
  for (let i = 0; i < majorSeg; i++) {
    const i1 = (i + 1) % majorSeg;
    for (let j = 0; j < minorSeg; j++) {
      const j1 = (j + 1) % minorSeg;
      const v00 = grid[i][j];
      const v10 = grid[i1][j];
      const v01 = grid[i][j1];
      const v11 = grid[i1][j1];

      tris.push(makeTri(v00, v10, v11));
      tris.push(makeTri(v00, v11, v01));
    }
  }

  return tris;
}

// ─── OVERHANG TEST MODEL ──────────────────────────────────────────────────────

/**
 * Generate a model specifically designed to test overhang detection.
 *
 * Shape: a base block with a horizontal "arm" extending out at 90°
 * and a staircase with progressively steeper overhangs.
 *
 *   Side view:
 *
 *        ┌───────────────────┐   ← arm (needs support)
 *        │                   │
 *   ─────┘   ← base block
 */
function generateOverhangTest() {
  const tris = [];

  // ── Base block: 30×30×15 mm ───────────────────────────────────────────────
  tris.push(...boxTriangles(vec3(-15, -15, 0), vec3(15, 15, 15)));

  // ── Horizontal arm: 30×10×5 mm, starting at Z=15, cantilevered in +X ─────
  // This arm overhangs in X from X=15 to X=45  (full overhang, 90°)
  tris.push(...boxTriangles(vec3(15, -5, 15), vec3(45, 5, 20)));

  // ── Staircase overhangs (each step overhangs 5 mm in X) ──────────────────
  // Step 1: 30° overhang  (gentle)
  tris.push(...boxTriangles(vec3(-15, 20, 0), vec3(0, 30, 10)));
  tris.push(...boxTriangles(vec3(0, 20, 5), vec3(10, 30, 15)));

  // Step 2: 60° overhang  (steep — needs support)
  tris.push(...boxTriangles(vec3(-15, -45, 0), vec3(0, -35, 10)));
  tris.push(...boxTriangles(vec3(0, -45, 8), vec3(15, -35, 18)));

  return tris;
}

/**
 * Helper: generate 12 triangles for an axis-aligned box.
 * @param {{ x,y,z }} min - minimum corner
 * @param {{ x,y,z }} max - maximum corner
 */
function boxTriangles(min, max) {
  const { x: x0, y: y0, z: z0 } = min;
  const { x: x1, y: y1, z: z1 } = max;

  // 8 corners
  const a = vec3(x0, y0, z0);
  const b = vec3(x1, y0, z0);
  const c = vec3(x1, y1, z0);
  const d = vec3(x0, y1, z0);
  const e = vec3(x0, y0, z1);
  const f = vec3(x1, y0, z1);
  const g = vec3(x1, y1, z1);
  const h = vec3(x0, y1, z1);

  return [
    // Bottom (z0)
    makeTri(a, c, b),
    makeTri(a, d, c),
    // Top    (z1)
    makeTri(e, f, g),
    makeTri(e, g, h),
    // Front  (y0)
    makeTri(a, b, f),
    makeTri(a, f, e),
    // Back   (y1)
    makeTri(d, g, c),
    makeTri(d, h, g),
    // Left   (x0)
    makeTri(a, e, h),
    makeTri(a, h, d),
    // Right  (x1)
    makeTri(b, c, g),
    makeTri(b, g, f),
  ];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a sample STL file of the requested shape.
 *
 * @param {'cube'|'sphere'|'cylinder'|'torus'|'overhang'} shape
 * @param {string} outputDir
 * @param {object} [params]   - shape-specific parameters (optional)
 * @returns {string} path to the generated file
 */
function generateSampleSTL(shape, outputDir, params = {}) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let triangles;
  let fileName;

  switch (shape.toLowerCase()) {
    case "cube":
      triangles = generateCube(params.size || 20);
      fileName = `sample_cube_${params.size || 20}mm.stl`;
      break;

    case "sphere":
      triangles = generateSphere(params.radius || 15, params.segments || 24);
      fileName = `sample_sphere_r${params.radius || 15}mm.stl`;
      break;

    case "cylinder":
      triangles = generateCylinder(
        params.radius || 10,
        params.height || 30,
        params.segments || 32,
      );
      fileName = `sample_cylinder_r${params.radius || 10}h${params.height || 30}mm.stl`;
      break;

    case "torus":
      triangles = generateTorus(
        params.majorRadius || 20,
        params.minorRadius || 6,
        params.majorSeg || 36,
        params.minorSeg || 18,
      );
      fileName = `sample_torus_R${params.majorRadius || 20}r${params.minorRadius || 6}mm.stl`;
      break;

    case "overhang":
      triangles = generateOverhangTest();
      fileName = "sample_overhang_test.stl";
      break;

    default:
      throw new Error(
        `Unknown shape: "${shape}". Choose: cube, sphere, cylinder, torus, overhang`,
      );
  }

  const outputPath = path.join(outputDir, fileName);
  writeBinarySTL(triangles, outputPath);

  return outputPath;
}

/**
 * Generate all sample shapes at once.
 * @param {string} outputDir
 * @returns {string[]} list of generated file paths
 */
function generateAllSamples(outputDir) {
  const shapes = [
    { shape: "cube", params: { size: 20 } },
    { shape: "sphere", params: { radius: 15, segments: 32 } },
    { shape: "cylinder", params: { radius: 10, height: 30, segments: 32 } },
    { shape: "torus", params: { majorRadius: 20, minorRadius: 6 } },
    { shape: "overhang", params: {} },
  ];

  return shapes.map(({ shape, params }) =>
    generateSampleSTL(shape, outputDir, params),
  );
}

module.exports = {
  generateSampleSTL,
  generateAllSamples,
  generateCube,
  generateSphere,
  generateCylinder,
  generateTorus,
  generateOverhangTest,
  writeBinarySTL,
  boxTriangles,
};
