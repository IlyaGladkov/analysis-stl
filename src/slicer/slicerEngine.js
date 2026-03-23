'use strict';

/**
 * Slicer Engine
 *
 * Performs layer-by-layer slicing of an STL mesh and detects
 * regions that require support structures.
 *
 * Algorithm overview:
 *  1. Parse all triangles and find Z extents
 *  2. For each layer Z, find all triangle–plane intersections → line segments
 *  3. Chain segments into closed contours (polygons)
 *  4. For each triangle, check if it is an overhang (normal Z < cos(threshold))
 *  5. Project overhang regions down to the build plate or nearest surface
 *  6. Output per-layer data + support triangles as a new STL
 */

// ─── Vector / math helpers ────────────────────────────────────────────────────

function vecSub(a, b)  { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function vecAdd(a, b)  { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function vecScale(a, s){ return { x: a.x * s,   y: a.y * s,   z: a.z * s   }; }
function vecCross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function vecDot(a, b)  { return a.x * b.x + a.y * b.y + a.z * b.z; }
function vecLen(a)     { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
function vecNorm(a) {
  const l = vecLen(a);
  if (l < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

function lerp(t, a, b) {
  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
    z: a.z + t * (b.z - a.z),
  };
}

function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

function ptKey2D(p) {
  return `${round6(p.x)},${round6(p.y)}`;
}

// ─── Triangle–plane intersection ──────────────────────────────────────────────

/**
 * Intersect a triangle with a horizontal plane at z = planeZ.
 * Returns a line segment { a, b } in 3D (z ≈ planeZ) or null.
 */
function intersectTrianglePlane(v1, v2, v3, planeZ) {
  const d1 = v1.z - planeZ;
  const d2 = v2.z - planeZ;
  const d3 = v3.z - planeZ;

  const above1 = d1 > 0;
  const above2 = d2 > 0;
  const above3 = d3 > 0;

  // All on the same side → no intersection
  if (above1 === above2 && above2 === above3) return null;

  const verts  = [v1, v2, v3];
  const dists  = [d1, d2, d3];
  const points = [];

  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const di = dists[i];
    const dj = dists[j];
    // Edge crosses the plane if signs differ
    if ((di > 0 && dj < 0) || (di < 0 && dj > 0)) {
      const t = di / (di - dj);
      points.push(lerp(t, verts[i], verts[j]));
    } else if (Math.abs(di) < 1e-9) {
      // Vertex exactly on the plane
      points.push({ ...verts[i] });
    }
  }

  // Deduplicate
  const unique = [];
  for (const p of points) {
    const already = unique.some(
      u => Math.abs(u.x - p.x) < 1e-9 && Math.abs(u.y - p.y) < 1e-9
    );
    if (!already) unique.push(p);
  }

  if (unique.length < 2) return null;
  return { a: unique[0], b: unique[1] };
}

// ─── Segment chaining → contours ─────────────────────────────────────────────

/**
 * Chain an unordered array of 2D line segments into closed contours.
 * Each segment is { a: {x,y}, b: {x,y} }.
 * Returns an array of polygons, each polygon is an array of {x,y} points.
 */
function chainSegments(segments) {
  if (segments.length === 0) return [];

  // Build adjacency map: point key → [segment indices that touch this point]
  const adj = new Map(); // ptKey → [ { segIdx, end: 'a'|'b' } ]

  function addPoint(key, segIdx, end) {
    if (!adj.has(key)) adj.set(key, []);
    adj.get(key).push({ segIdx, end });
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    addPoint(ptKey2D(seg.a), i, 'a');
    addPoint(ptKey2D(seg.b), i, 'b');
  }

  const used = new Array(segments.length).fill(false);
  const contours = [];

  for (let startIdx = 0; startIdx < segments.length; startIdx++) {
    if (used[startIdx]) continue;

    const contour = [];
    let   segIdx  = startIdx;
    let   fromEnd = 'a'; // we'll traverse from b

    // Start point
    contour.push({ ...segments[startIdx].a });
    used[startIdx] = true;

    let currentPt = segments[startIdx].b;
    contour.push({ ...currentPt });

    // Walk the chain
    for (let step = 0; step < segments.length * 2; step++) {
      const key  = ptKey2D(currentPt);
      const neighbors = adj.get(key) || [];

      let found = false;
      for (const { segIdx: nIdx, end: nEnd } of neighbors) {
        if (used[nIdx]) continue;

        used[nIdx] = true;
        const seg = segments[nIdx];
        const nextPt = nEnd === 'a' ? seg.b : seg.a;
        contour.push({ ...nextPt });
        currentPt = nextPt;
        found = true;
        break;
      }

      if (!found) break;

      // Check if closed
      const first = contour[0];
      const last  = contour[contour.length - 1];
      if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
        contour.pop(); // remove duplicate closing point
        break;
      }
    }

    if (contour.length >= 3) {
      contours.push(contour);
    }
  }

  return contours;
}

// ─── Polygon area (shoelace) ──────────────────────────────────────────────────

function polygonArea2D(pts) {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

// ─── Polygon centroid ─────────────────────────────────────────────────────────

function polygonCentroid2D(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  return { x: cx / pts.length, y: cy / pts.length };
}

// ─── Overhang detection ───────────────────────────────────────────────────────

/**
 * Determine whether a triangle needs support.
 *
 * A triangle is an overhang when:
 *  - Its downward-facing normal makes an angle with -Z that is greater
 *    than (90° − overhangAngle). Equivalently: dot(normal, -Z) > cos(overhangAngle)
 *  - AND it is not resting on the build plate (minZ > buildPlateZ + epsilon)
 *
 * Standard FDM threshold: 45° from vertical  →  cos(45°) ≈ 0.707
 */
function isOverhang(normal, v1, v2, v3, overhangAngleDeg, buildPlateZ) {
  // Compute the actual face normal from vertices (more reliable than stored normal)
  const ab = vecSub(v2, v1);
  const ac = vecSub(v3, v1);
  const faceNormal = vecNorm(vecCross(ab, ac));

  if (vecLen(faceNormal) < 1e-10) return false; // degenerate

  const minZ = Math.min(v1.z, v2.z, v3.z);

  // If the triangle sits on the build plate, no support needed
  if (minZ <= buildPlateZ + 0.01) return false;

  // downward component: negative Z direction
  const downwardDot = -faceNormal.z; // dot(faceNormal, {0,0,-1})

  // The face is "looking down" if downwardDot > 0
  // It needs support when the angle from vertical exceeds threshold
  const threshold = Math.cos((overhangAngleDeg * Math.PI) / 180);

  return downwardDot > threshold;
}

// ─── Support column generation ────────────────────────────────────────────────

/**
 * For each overhang triangle, generate a vertical support column from the
 * lowest point of the triangle down to the build plate (z = 0).
 *
 * Returns an array of support "pillar" objects:
 *   { baseX, baseY, topZ, bottomZ, radius }
 */
function generateSupportPillars(overhangTriangles, options = {}) {
  const supportRadius  = options.supportRadius  || 0.4;  // mm  (nozzle width)
  const buildPlateZ    = options.buildPlateZ    || 0;

  const pillars = [];

  for (const { v1, v2, v3 } of overhangTriangles) {
    // Place a pillar at the centroid of the overhang triangle
    const cx = (v1.x + v2.x + v3.x) / 3;
    const cy = (v1.y + v2.y + v3.y) / 3;
    const topZ    = Math.min(v1.z, v2.z, v3.z);
    const bottomZ = buildPlateZ;

    if (topZ <= bottomZ) continue;

    // Check if an existing nearby pillar already covers this spot
    const nearby = pillars.find(
      p => Math.hypot(p.baseX - cx, p.baseY - cy) < supportRadius * 3
    );
    if (nearby) {
      // Extend existing pillar if needed
      if (topZ > nearby.topZ) nearby.topZ = topZ;
      continue;
    }

    pillars.push({ baseX: cx, baseY: cy, topZ, bottomZ, radius: supportRadius });
  }

  return pillars;
}

/**
 * Convert a support pillar into a set of STL triangles (a triangulated cylinder).
 * Uses an octagonal prism for efficiency.
 */
function pillarToTriangles(pillar, sides = 8) {
  const { baseX, baseY, topZ, bottomZ, radius } = pillar;
  const tris = [];
  const angleStep = (2 * Math.PI) / sides;

  // Build top and bottom rings
  const topRing    = [];
  const bottomRing = [];
  for (let i = 0; i < sides; i++) {
    const angle = i * angleStep;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    topRing.push(   { x: baseX + x, y: baseY + y, z: topZ    });
    bottomRing.push({ x: baseX + x, y: baseY + y, z: bottomZ });
  }

  const topCenter    = { x: baseX, y: baseY, z: topZ    };
  const bottomCenter = { x: baseX, y: baseY, z: bottomZ };

  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;

    // Side quad → 2 triangles
    tris.push({ normal: { x: 0, y: 0, z: 0 }, v1: topRing[i],    v2: bottomRing[i], v3: bottomRing[j] });
    tris.push({ normal: { x: 0, y: 0, z: 0 }, v1: topRing[i],    v2: bottomRing[j], v3: topRing[j]    });

    // Top cap
    tris.push({ normal: { x: 0, y: 0, z: 1  }, v1: topCenter,    v2: topRing[j],    v3: topRing[i]    });

    // Bottom cap
    tris.push({ normal: { x: 0, y: 0, z: -1 }, v1: bottomCenter, v2: bottomRing[i], v3: bottomRing[j] });
  }

  return tris;
}

// ─── Per-layer statistics ─────────────────────────────────────────────────────

/**
 * Estimate filament used for a single layer from its contour area.
 *
 * Simple model:
 *   - Shell perimeter  → nozzle width × layer height × perimeter length
 *   - Infill area      → infill density × layer area × layer height
 *
 * Returns mm³ of filament for this layer.
 */
function layerFilamentVolume(contours, layerHeight, options = {}) {
  const nozzleDiameter  = options.nozzleDiameter  || 0.4;   // mm
  const infillDensity   = options.infillDensity    || 0.20;  // 0–1
  const shellCount      = options.shellCount       || 3;

  let totalVolume = 0;

  for (const contour of contours) {
    const area = polygonArea2D(contour);

    // Perimeter
    let perimeter = 0;
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }

    // Shell volume
    const shellVolume = perimeter * nozzleDiameter * layerHeight * shellCount;

    // Infill volume (area minus shell area, approximated)
    const innerArea   = Math.max(0, area - perimeter * nozzleDiameter * shellCount);
    const infillVolume = innerArea * layerHeight * infillDensity;

    totalVolume += shellVolume + infillVolume;
  }

  return totalVolume;
}

// ─── Main slicer function ─────────────────────────────────────────────────────

/**
 * Slice an STL mesh and generate per-layer data + support structures.
 *
 * @param {Array}  triangles  - output of stlParser.parseSTL()
 * @param {object} options
 * @param {number} [options.layerHeight=0.2]        - layer height in mm
 * @param {number} [options.overhangAngle=45]        - overhang threshold in degrees
 * @param {number} [options.nozzleDiameter=0.4]      - nozzle diameter in mm
 * @param {number} [options.infillDensity=0.20]      - infill ratio 0–1
 * @param {number} [options.shellCount=3]            - number of perimeter shells
 * @param {number} [options.supportRadius=0.4]       - support pillar radius in mm
 * @param {number} [options.buildPlateZ]             - Z of build plate (default: model minZ)
 * @returns {SlicerResult}
 */
function slice(triangles, options = {}) {
  if (!triangles || triangles.length === 0) {
    throw new Error('No triangles provided to slicer.');
  }

  const layerHeight    = options.layerHeight    || 0.2;
  const overhangAngle  = options.overhangAngle  || 45;
  const nozzleDiameter = options.nozzleDiameter || 0.4;
  const infillDensity  = options.infillDensity  || 0.20;
  const shellCount     = options.shellCount     || 3;
  const supportRadius  = options.supportRadius  || 0.4;

  // ── Find Z extents ───────────────────────────────────────────────────────────
  let minZ =  Infinity;
  let maxZ = -Infinity;
  for (const { v1, v2, v3 } of triangles) {
    for (const v of [v1, v2, v3]) {
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  }

  const buildPlateZ = options.buildPlateZ !== undefined ? options.buildPlateZ : minZ;
  const modelHeight = maxZ - minZ;

  if (modelHeight < layerHeight) {
    throw new Error(
      `Model height (${modelHeight.toFixed(3)} mm) is less than layer height (${layerHeight} mm).`
    );
  }

  const layerCount = Math.ceil(modelHeight / layerHeight);

  // ── Identify overhang triangles ──────────────────────────────────────────────
  const overhangTriangles = [];
  for (const tri of triangles) {
    if (isOverhang(tri.normal, tri.v1, tri.v2, tri.v3, overhangAngle, buildPlateZ)) {
      overhangTriangles.push(tri);
    }
  }

  // ── Generate support pillars ─────────────────────────────────────────────────
  const supportPillars = generateSupportPillars(overhangTriangles, {
    supportRadius,
    buildPlateZ,
  });

  // Convert pillars to triangles for STL export
  const supportTriangles = [];
  for (const pillar of supportPillars) {
    supportTriangles.push(...pillarToTriangles(pillar));
  }

  // ── Slice each layer ─────────────────────────────────────────────────────────
  const layers = [];

  // Pre-bucket triangles by Z range for performance
  // Each triangle spans [triMinZ, triMaxZ]
  const triBuckets = triangles.map(tri => {
    const zVals = [tri.v1.z, tri.v2.z, tri.v3.z];
    return { tri, zMin: Math.min(...zVals), zMax: Math.max(...zVals) };
  });

  let totalFilamentMm3   = 0;
  let totalSupportMm3    = 0;
  let layerWithMaxArea   = null;
  let maxLayerArea       = 0;

  for (let i = 0; i < layerCount; i++) {
    const zPlane = minZ + (i + 0.5) * layerHeight; // slice through the middle of each layer

    // Collect intersecting segments
    const segments = [];
    for (const { tri, zMin, zMax } of triBuckets) {
      if (zMin > zPlane || zMax < zPlane) continue;
      const seg = intersectTrianglePlane(tri.v1, tri.v2, tri.v3, zPlane);
      if (seg) {
        // Project to 2D (drop Z)
        segments.push({
          a: { x: seg.a.x, y: seg.a.y },
          b: { x: seg.b.x, y: seg.b.y },
        });
      }
    }

    // Chain into contours
    const contours = chainSegments(segments);

    // Compute layer area (sum of contour areas)
    const layerArea = contours.reduce((sum, c) => sum + polygonArea2D(c), 0);

    // Filament estimate for this layer
    const filamentVol = layerFilamentVolume(contours, layerHeight, {
      nozzleDiameter,
      infillDensity,
      shellCount,
    });

    // Support volume for this layer slice
    // Sum pillar cross-sections that pass through this Z
    let supportVolLayer = 0;
    for (const pillar of supportPillars) {
      if (pillar.bottomZ <= zPlane && pillar.topZ >= zPlane) {
        const pillarArea = Math.PI * pillar.radius * pillar.radius;
        supportVolLayer += pillarArea * layerHeight;
      }
    }

    totalFilamentMm3 += filamentVol;
    totalSupportMm3  += supportVolLayer;

    if (layerArea > maxLayerArea) {
      maxLayerArea     = layerArea;
      layerWithMaxArea = i + 1;
    }

    layers.push({
      layerIndex:   i + 1,
      zBottom:      parseFloat((minZ + i * layerHeight).toFixed(4)),
      zTop:         parseFloat((minZ + (i + 1) * layerHeight).toFixed(4)),
      zPlane:       parseFloat(zPlane.toFixed(4)),
      segmentCount: segments.length,
      contourCount: contours.length,
      contours,          // array of polygon point arrays
      areaMm2:      parseFloat(layerArea.toFixed(4)),
      filamentMm3:  parseFloat(filamentVol.toFixed(4)),
      hasSupportAt: supportPillars.some(
        p => p.bottomZ <= zPlane && p.topZ >= zPlane
      ),
    });
  }

  return {
    // Slicer settings used
    settings: {
      layerHeight,
      overhangAngle,
      nozzleDiameter,
      infillDensity,
      shellCount,
      supportRadius,
      buildPlateZ,
    },

    // Model Z range
    modelMinZ:   parseFloat(minZ.toFixed(4)),
    modelMaxZ:   parseFloat(maxZ.toFixed(4)),
    modelHeight: parseFloat(modelHeight.toFixed(4)),

    // Layer data
    layerCount,
    layers,

    // Support data
    overhangTriangleCount: overhangTriangles.length,
    supportPillarCount:    supportPillars.length,
    supportPillars,
    supportTriangles,

    // Filament totals (mm³)
    totalFilamentMm3:  parseFloat(totalFilamentMm3.toFixed(4)),
    totalSupportMm3:   parseFloat(totalSupportMm3.toFixed(4)),
    totalMaterialMm3:  parseFloat((totalFilamentMm3 + totalSupportMm3).toFixed(4)),

    // Layer stats
    layerWithMaxArea,
    maxLayerAreaMm2: parseFloat(maxLayerArea.toFixed(4)),
  };
}

// ─── Merge model + support triangles for STL output ──────────────────────────

/**
 * Combine model triangles with support triangles into one mesh.
 * Used when writing the "model + supports" STL file.
 */
function mergeWithSupports(modelTriangles, slicerResult) {
  return [...modelTriangles, ...slicerResult.supportTriangles];
}

module.exports = {
  slice,
  mergeWithSupports,
  isOverhang,
  intersectTrianglePlane,
  chainSegments,
  pillarToTriangles,
  generateSupportPillars,
  polygonArea2D,
  layerFilamentVolume,
};
