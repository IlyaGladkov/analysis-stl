"use strict";

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
 *     AND there is no model surface below (ray cast downward)
 *  5. Place support points proportional to overhang triangle area
 *  6. Generate supports in the chosen style: Linear | Grid | Tree
 *  7. Output per-layer data + support triangles as a new STL
 *
 * Support types:
 *  - "linear"  – simple vertical cylinders from overhang down to model/plate
 *  - "grid"    – full rectangular grid under every overhang region
 *  - "tree"    – branching tree: multiple tips merge into shared trunk columns
 *
 * Key improvements over v1:
 *  - Support points are sampled proportional to overhang triangle area,
 *    so large faces get adequate coverage.
 *  - Ray cast downward: a support column stops at the first model surface
 *    it hits, not always the build plate → reduces material waste.
 *  - Air gap: support tops are pulled down by `airGap` mm so supports
 *    detach cleanly from the model surface.
 *  - Merging: nearby support points are deduplicated within `mergeRadius`.
 *  - Three structural styles with appropriate geometry.
 */

// ─── Vector / math helpers ────────────────────────────────────────────────────

function vecSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function vecAdd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function vecScale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function vecCross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function vecDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function vecLen(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
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

  const above1 = d1 > 1e-9;
  const above2 = d2 > 1e-9;
  const above3 = d3 > 1e-9;
  const below1 = d1 < -1e-9;
  const below2 = d2 < -1e-9;
  const below3 = d3 < -1e-9;

  const anyAbove = above1 || above2 || above3;
  const anyBelow = below1 || below2 || below3;
  if (!anyAbove || !anyBelow) return null;

  const verts = [v1, v2, v3];
  const dists = [d1, d2, d3];
  const points = [];

  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const di = dists[i];
    const dj = dists[j];
    if ((di > 0 && dj < 0) || (di < 0 && dj > 0)) {
      const t = di / (di - dj);
      points.push(lerp(t, verts[i], verts[j]));
    } else if (Math.abs(di) < 1e-9) {
      points.push({ ...verts[i] });
    }
  }

  const unique = [];
  for (const p of points) {
    const already = unique.some(
      (u) =>
        Math.abs(u.x - p.x) < 1e-9 &&
        Math.abs(u.y - p.y) < 1e-9 &&
        Math.abs(u.z - p.z) < 1e-9,
    );
    if (!already) unique.push(p);
  }

  if (unique.length < 2) return null;
  return { a: unique[0], b: unique[1] };
}

// ─── Segment chaining → contours ─────────────────────────────────────────────

/**
 * Chain an unordered array of 2D line segments into closed contours.
 */
function chainSegments(segments) {
  if (segments.length === 0) return [];

  const adj = new Map();

  function addPoint(key, segIdx, end) {
    if (!adj.has(key)) adj.set(key, []);
    adj.get(key).push({ segIdx, end });
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    addPoint(ptKey2D(seg.a), i, "a");
    addPoint(ptKey2D(seg.b), i, "b");
  }

  const used = new Array(segments.length).fill(false);
  const contours = [];

  for (let startIdx = 0; startIdx < segments.length; startIdx++) {
    if (used[startIdx]) continue;

    const contour = [];
    let segIdx = startIdx;
    let fromEnd = "a";

    contour.push({ ...segments[startIdx].a });
    used[startIdx] = true;

    let currentPt = segments[startIdx].b;
    contour.push({ ...currentPt });

    for (let step = 0; step < segments.length * 2; step++) {
      const key = ptKey2D(currentPt);
      const neighbors = adj.get(key) || [];

      let found = false;
      for (const { segIdx: nIdx, end: nEnd } of neighbors) {
        if (used[nIdx]) continue;

        used[nIdx] = true;
        const seg = segments[nIdx];
        const nextPt = nEnd === "a" ? seg.b : seg.a;
        contour.push({ ...nextPt });
        currentPt = nextPt;
        found = true;
        break;
      }

      if (!found) break;

      const first = contour[0];
      const last = contour[contour.length - 1];
      if (
        Math.abs(first.x - last.x) < 1e-6 &&
        Math.abs(first.y - last.y) < 1e-6
      ) {
        contour.pop();
        break;
      }
    }

    if (contour.length >= 3) {
      contours.push(contour);
    }
  }

  return contours;
}

// ─── Polygon helpers ──────────────────────────────────────────────────────────

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

function polygonCentroid2D(pts) {
  let cx = 0,
    cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / pts.length, y: cy / pts.length };
}

// ─── Triangle geometry ────────────────────────────────────────────────────────

/**
 * Compute the 3D area of a triangle.
 */
function triangleArea3D(v1, v2, v3) {
  const ab = vecSub(v2, v1);
  const ac = vecSub(v3, v1);
  return vecLen(vecCross(ab, ac)) / 2;
}

/**
 * Compute the reliable face normal from vertices (ignores stored normal).
 */
function faceNormal(v1, v2, v3) {
  const ab = vecSub(v2, v1);
  const ac = vecSub(v3, v1);
  return vecNorm(vecCross(ab, ac));
}

// ─── Overhang detection ───────────────────────────────────────────────────────

/**
 * Determine whether a triangle is an overhang that needs support.
 *
 * Conditions (ALL must be true):
 *  1. Face normal has a significant downward component:
 *       dot(n, -Z) > cos(overhangAngleDeg)
 *     i.e. the face "looks down" more steeply than the threshold.
 *  2. The triangle is not ON the build plate
 *     (its lowest vertex is above buildPlateZ + epsilon).
 *  3. There is no model surface within `supportGap` mm directly below the
 *     triangle's centroid (ray-cast check) — meaning it truly "hangs in air".
 *
 * @param {object}   tri              - { normal, v1, v2, v3 }
 * @param {number}   overhangAngleDeg - typically 45°; lower = more supports
 * @param {number}   buildPlateZ      - Z of the build plate
 * @param {Array}    triBuckets       - pre-bucketed triangles for ray cast
 * @param {number}   [supportGap=0.3] - mm below centroid to look for surface
 * @returns {boolean}
 */
function isOverhang(
  tri,
  overhangAngleDeg,
  buildPlateZ,
  triBuckets,
  supportGap = 0.3,
) {
  const { v1, v2, v3 } = tri;

  const n = faceNormal(v1, v2, v3);
  if (vecLen(n) < 1e-10) return false; // degenerate triangle

  const minZ = Math.min(v1.z, v2.z, v3.z);

  // Condition 2: not on build plate
  if (minZ <= buildPlateZ + 0.05) return false;

  // Condition 1: face looks downward beyond threshold
  // downwardDot = dot(n, {0,0,-1}) = -n.z
  const downwardDot = -n.z;
  const threshold = Math.cos((overhangAngleDeg * Math.PI) / 180);
  if (downwardDot <= threshold) return false;

  // Condition 3: nothing directly below (ray cast from centroid downward)
  const cx = (v1.x + v2.x + v3.x) / 3;
  const cy = (v1.y + v2.y + v3.y) / 3;
  const cz = minZ - 0.001; // just below the triangle

  const hasModelBelow = rayHitsModelBelow(cx, cy, cz, supportGap, triBuckets);
  return !hasModelBelow;
}

/**
 * Cast a vertical ray downward from (x, y, z) and check if any model triangle
 * exists within `maxDist` mm below.
 *
 * Uses a fast 2D point-in-triangle test on each candidate triangle.
 * Candidate triangles are those whose Z range overlaps [z - maxDist, z].
 *
 * @returns {boolean} true if a surface was found below
 */
function rayHitsModelBelow(x, y, z, maxDist, triBuckets) {
  const zMin = z - maxDist;
  const zMax = z;

  for (const { tri, zMin: tMin, zMax: tMax } of triBuckets) {
    // Quick Z range cull
    if (tMax > z + 0.001) continue; // triangle is above the point
    if (tMin < zMin) continue; // triangle is too far below

    // 2D point-in-triangle test (project XY)
    if (pointInTriangle2D(x, y, tri.v1, tri.v2, tri.v3)) {
      return true;
    }
  }
  return false;
}

/**
 * 2D point-in-triangle test using barycentric coordinates.
 */
function pointInTriangle2D(px, py, v1, v2, v3) {
  const d1 = sign2D(px, py, v1.x, v1.y, v2.x, v2.y);
  const d2 = sign2D(px, py, v2.x, v2.y, v3.x, v3.y);
  const d3 = sign2D(px, py, v3.x, v3.y, v1.x, v1.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign2D(px, py, x1, y1, x2, y2) {
  return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
}

// ─── Ray cast: find Z of model surface below a point ─────────────────────────

/**
 * Find the highest Z of any model surface below point (x, y, fromZ).
 * Returns buildPlateZ if nothing found (support goes all the way to plate).
 */
function findSurfaceBelow(x, y, fromZ, triBuckets, buildPlateZ) {
  let bestZ = buildPlateZ;

  for (const { tri, zMin: tMin, zMax: tMax } of triBuckets) {
    // Only look at triangles strictly below fromZ
    if (tMax >= fromZ - 0.001) continue;

    if (!pointInTriangle2D(x, y, tri.v1, tri.v2, tri.v3)) continue;

    // Interpolate Z on this triangle at (x, y)
    const z = interpolateZOnTriangle(x, y, tri.v1, tri.v2, tri.v3);
    if (z !== null && z > bestZ && z < fromZ - 0.001) {
      bestZ = z;
    }
  }

  return bestZ;
}

/**
 * Barycentric interpolation of Z on a triangle at (px, py).
 * Returns null if the point is outside.
 */
function interpolateZOnTriangle(px, py, v1, v2, v3) {
  const denom = (v2.y - v3.y) * (v1.x - v3.x) + (v3.x - v2.x) * (v1.y - v3.y);
  if (Math.abs(denom) < 1e-10) return null;

  const w1 =
    ((v2.y - v3.y) * (px - v3.x) + (v3.x - v2.x) * (py - v3.y)) / denom;
  const w2 =
    ((v3.y - v1.y) * (px - v3.x) + (v1.x - v3.x) * (py - v3.y)) / denom;
  const w3 = 1 - w1 - w2;

  if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) return null;

  return w1 * v1.z + w2 * v2.z + w3 * v3.z;
}

// ─── Support point sampling ───────────────────────────────────────────────────

/**
 * Sample support attachment points from an overhang triangle.
 *
 * Strategy:
 *  - Always include the centroid.
 *  - For large triangles (area > spacing²) also sample a regular grid of
 *    barycentric points so that large overhangs get full coverage.
 *
 * @param {object} tri     - { v1, v2, v3 }
 * @param {number} spacing - target distance between sample points (mm)
 * @returns {Array<{x,y,z}>} 3D points on the surface of the triangle
 */
function sampleTrianglePoints(tri, spacing) {
  const { v1, v2, v3 } = tri;
  const area = triangleArea3D(v1, v2, v3);
  const points = [];

  // Always add centroid
  points.push({
    x: (v1.x + v2.x + v3.x) / 3,
    y: (v1.y + v2.y + v3.y) / 3,
    z: (v1.z + v2.z + v3.z) / 3,
  });

  // For larger triangles: grid-sample in barycentric coordinates
  // Number of subdivisions proportional to sqrt(area) / spacing
  const subdivisions = Math.max(1, Math.floor(Math.sqrt(area) / spacing));

  if (subdivisions > 1) {
    for (let i = 1; i <= subdivisions - 1; i++) {
      for (let j = 1; j <= subdivisions - i; j++) {
        const u = i / subdivisions;
        const v = j / subdivisions;
        const w = 1 - u - v;
        if (w < 0) continue;
        points.push({
          x: u * v1.x + v * v2.x + w * v3.x,
          y: u * v1.y + v * v2.y + w * v3.y,
          z: u * v1.z + v * v2.z + w * v3.z,
        });
      }
    }
  }

  return points;
}

// ─── Merge nearby support points ─────────────────────────────────────────────

/**
 * Remove duplicate support attachment points that are closer than mergeRadius.
 * Uses a greedy sweep — O(n²) but n is typically small (< 10 000).
 */
function mergeSupportPoints(points, mergeRadius) {
  const result = [];
  for (const p of points) {
    const isDuplicate = result.some(
      (r) => Math.hypot(r.x - p.x, r.y - p.y) < mergeRadius,
    );
    if (!isDuplicate) result.push(p);
  }
  return result;
}

// ─── Support pillar generation ────────────────────────────────────────────────

/**
 * Build a list of support pillar descriptors from sampled overhang points.
 *
 * Each pillar:
 *   { baseX, baseY, topZ, bottomZ, radius }
 *
 *  - topZ    = attachment point Z minus airGap  (leaves space to detach)
 *  - bottomZ = highest model surface below OR buildPlateZ
 *
 * @param {Array}  overhangPoints  - from sampleTrianglePoints, merged
 * @param {object} options
 * @param {number} options.supportRadius  - pillar radius mm
 * @param {number} options.airGap         - gap between support tip and model (mm)
 * @param {number} options.buildPlateZ    - Z of the build plate
 * @param {Array}  options.triBuckets     - for surface-below ray cast
 * @returns {Array} pillars
 */
function buildSupportPillars(overhangPoints, options) {
  const {
    supportRadius = 0.4,
    airGap = 0.2,
    buildPlateZ = 0,
    triBuckets = [],
  } = options;

  const pillars = [];

  for (const pt of overhangPoints) {
    const topZ = pt.z - airGap;
    const bottomZ = findSurfaceBelow(pt.x, pt.y, pt.z, triBuckets, buildPlateZ);

    if (topZ <= bottomZ + 0.05) continue; // too short to be useful

    pillars.push({
      baseX: pt.x,
      baseY: pt.y,
      topZ,
      bottomZ,
      radius: supportRadius,
    });
  }

  return pillars;
}

// ─── Grid support generation ──────────────────────────────────────────────────

/**
 * "Grid" support type:
 *   Places pillars on a regular XY grid under the bounding box of each
 *   overhang triangle, skipping grid cells that are outside any overhang region.
 *
 * This gives even, predictable coverage for flat horizontal overhangs
 * (e.g. bridging gaps, flat ceilings).
 *
 * @param {Array}  overhangTriangles
 * @param {object} options
 * @returns {Array} pillars
 */
function buildGridSupports(overhangTriangles, options) {
  const {
    gridSpacing = 2.0, // mm between grid lines
    supportRadius = 0.4,
    airGap = 0.2,
    buildPlateZ = 0,
    triBuckets = [],
  } = options;

  // Collect all grid candidate points from all overhang triangles
  const rawPoints = [];

  for (const tri of overhangTriangles) {
    const { v1, v2, v3 } = tri;

    // Bounding box of this triangle in XY
    const xMin = Math.min(v1.x, v2.x, v3.x);
    const xMax = Math.max(v1.x, v2.x, v3.x);
    const yMin = Math.min(v1.y, v2.y, v3.y);
    const yMax = Math.max(v1.y, v2.y, v3.y);
    const triMinZ = Math.min(v1.z, v2.z, v3.z);

    // Snap to grid
    const xStart = Math.ceil(xMin / gridSpacing) * gridSpacing;
    const yStart = Math.ceil(yMin / gridSpacing) * gridSpacing;

    for (let gx = xStart; gx <= xMax + 1e-6; gx += gridSpacing) {
      for (let gy = yStart; gy <= yMax + 1e-6; gy += gridSpacing) {
        // Only if the grid point projects onto this triangle
        if (pointInTriangle2D(gx, gy, v1, v2, v3)) {
          const gz = interpolateZOnTriangle(gx, gy, v1, v2, v3);
          if (gz !== null) {
            rawPoints.push({ x: gx, y: gy, z: gz });
          }
        }
      }
    }
  }

  const merged = mergeSupportPoints(rawPoints, supportRadius * 2);
  return buildSupportPillars(merged, {
    supportRadius,
    airGap,
    buildPlateZ,
    triBuckets,
  });
}

// ─── Tree support generation ──────────────────────────────────────────────────

/**
 * "Tree" support type:
 *
 * Phase 1 (tips): sample overhang points densely (like linear supports).
 * Phase 2 (trunk): cluster nearby tips and combine them into a shared trunk
 *   column that merges below a "branch height".
 *
 * Result:
 *   - Tips are thin (tipRadius) and connect directly to the model with airGap.
 *   - Below the branch height, thin pillars merge into a single thicker trunk.
 *   - Reduces contact area with model and uses less material than grid.
 *
 * Great for organic/curved models with many scattered overhangs.
 */
function buildTreeSupports(overhangTriangles, options) {
  const {
    supportRadius = 0.4,
    trunkRadius = 1.2, // radius of merged trunk columns
    airGap = 0.2,
    buildPlateZ = 0,
    triBuckets = [],
    spacing = 1.5, // sample spacing mm
    branchHeightFrac = 0.4, // how far up from bottom to merge (fraction of pillar height)
    clusterRadius = 4.0, // tips within this XY distance share a trunk
  } = options;

  // ── Phase 1: collect tip points ──────────────────────────────────────────────
  const rawPoints = [];
  for (const tri of overhangTriangles) {
    const pts = sampleTrianglePoints(tri, spacing);
    for (const p of pts) rawPoints.push(p);
  }
  const tipPoints = mergeSupportPoints(rawPoints, supportRadius * 1.5);

  if (tipPoints.length === 0) return { tipPillars: [], trunkPillars: [] };

  // ── Phase 2: cluster tips into trunks ────────────────────────────────────────
  const assigned = new Array(tipPoints.length).fill(-1);
  const clusters = [];

  for (let i = 0; i < tipPoints.length; i++) {
    if (assigned[i] !== -1) continue;

    const cluster = [i];
    assigned[i] = clusters.length;

    for (let j = i + 1; j < tipPoints.length; j++) {
      if (assigned[j] !== -1) continue;
      const dist = Math.hypot(
        tipPoints[i].x - tipPoints[j].x,
        tipPoints[i].y - tipPoints[j].y,
      );
      if (dist < clusterRadius) {
        assigned[j] = clusters.length;
        cluster.push(j);
      }
    }
    clusters.push(cluster);
  }

  const tipPillars = [];
  const trunkPillars = [];

  for (const cluster of clusters) {
    // Compute cluster centroid (XY)
    let sumX = 0,
      sumY = 0;
    for (const idx of cluster) {
      sumX += tipPoints[idx].x;
      sumY += tipPoints[idx].y;
    }
    const centX = sumX / cluster.length;
    const centY = sumY / cluster.length;

    // Lowest tipZ in cluster → branch point Z
    let lowestTipZ = Infinity;
    for (const idx of cluster) {
      const topZ = tipPoints[idx].z - airGap;
      if (topZ < lowestTipZ) lowestTipZ = topZ;
    }

    // Bottom of trunk
    const trunkBottomZ = findSurfaceBelow(
      centX,
      centY,
      lowestTipZ,
      triBuckets,
      buildPlateZ,
    );
    const branchZ =
      trunkBottomZ + (lowestTipZ - trunkBottomZ) * branchHeightFrac;

    // ── Trunk: one thick column from plate/surface to branchZ ───────────────────
    if (lowestTipZ > trunkBottomZ + 0.1) {
      trunkPillars.push({
        baseX: centX,
        baseY: centY,
        topZ: Math.min(lowestTipZ, branchZ + 0.5),
        bottomZ: trunkBottomZ,
        radius: trunkRadius,
      });
    }

    // ── Tips: thin columns from branchZ up to each attachment point ─────────────
    for (const idx of cluster) {
      const pt = tipPoints[idx];
      const topZ = pt.z - airGap;
      const tipBottom = Math.max(branchZ, trunkBottomZ);

      if (topZ > tipBottom + 0.05) {
        tipPillars.push({
          baseX: pt.x,
          baseY: pt.y,
          topZ,
          bottomZ: tipBottom,
          radius: supportRadius,
        });
      }
    }
  }

  // Flatten for uniform output
  return [...tipPillars, ...trunkPillars];
}

// ─── Generate all support pillars (entry point) ───────────────────────────────

/**
 * Unified entry point for support pillar generation.
 * Dispatches to the correct algorithm based on `supportType`.
 *
 * @param {Array}  overhangTriangles
 * @param {object} options
 * @param {string} [options.supportType="linear"]  "linear" | "grid" | "tree"
 * @param {number} [options.supportRadius=0.4]     pillar tip radius mm
 * @param {number} [options.airGap=0.2]            gap between support and model mm
 * @param {number} [options.buildPlateZ=0]         build plate Z
 * @param {Array}  [options.triBuckets=[]]         pre-bucketed mesh triangles
 * @param {number} [options.spacing=1.5]           sample / grid spacing mm
 * @returns {Array} pillars { baseX, baseY, topZ, bottomZ, radius }
 */
function generateSupportPillars(overhangTriangles, options = {}) {
  const supportType = (options.supportType || "linear").toLowerCase();

  if (overhangTriangles.length === 0) return [];

  switch (supportType) {
    case "grid":
      return buildGridSupports(overhangTriangles, {
        gridSpacing: options.spacing || 2.0,
        supportRadius: options.supportRadius || 0.4,
        airGap: options.airGap || 0.2,
        buildPlateZ: options.buildPlateZ || 0,
        triBuckets: options.triBuckets || [],
      });

    case "tree":
      return buildTreeSupports(overhangTriangles, {
        supportRadius: options.supportRadius || 0.4,
        trunkRadius:
          options.trunkRadius ||
          Math.max(1.2, (options.supportRadius || 0.4) * 3),
        airGap: options.airGap || 0.2,
        buildPlateZ: options.buildPlateZ || 0,
        triBuckets: options.triBuckets || [],
        spacing: options.spacing || 1.5,
        branchHeightFrac: options.branchHeightFrac || 0.4,
        clusterRadius: options.clusterRadius || 4.0,
      });

    case "linear":
    default: {
      // Sample one point per overhang triangle (+ extra for large faces)
      const rawPoints = [];
      for (const tri of overhangTriangles) {
        const pts = sampleTrianglePoints(tri, options.spacing || 1.5);
        for (const p of pts) rawPoints.push(p);
      }
      const merged = mergeSupportPoints(
        rawPoints,
        (options.supportRadius || 0.4) * 2,
      );
      return buildSupportPillars(merged, {
        supportRadius: options.supportRadius || 0.4,
        airGap: options.airGap || 0.2,
        buildPlateZ: options.buildPlateZ || 0,
        triBuckets: options.triBuckets || [],
      });
    }
  }
}

// ─── Pillar → triangles (STL geometry) ───────────────────────────────────────

/**
 * Convert a support pillar into STL triangles (triangulated cylinder / prism).
 * Uses an octagonal cross-section for a good balance of fidelity and triangle count.
 *
 * @param {object} pillar  - { baseX, baseY, topZ, bottomZ, radius }
 * @param {number} [sides=8]
 * @returns {Array} triangle objects { normal, v1, v2, v3 }
 */
function pillarToTriangles(pillar, sides = 8) {
  const { baseX, baseY, topZ, bottomZ, radius } = pillar;
  const tris = [];
  const angleStep = (2 * Math.PI) / sides;

  const topRing = [];
  const bottomRing = [];
  for (let i = 0; i < sides; i++) {
    const angle = i * angleStep;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    topRing.push({ x: baseX + x, y: baseY + y, z: topZ });
    bottomRing.push({ x: baseX + x, y: baseY + y, z: bottomZ });
  }

  const topCenter = { x: baseX, y: baseY, z: topZ };
  const bottomCenter = { x: baseX, y: baseY, z: bottomZ };

  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;

    // Side quad → 2 triangles (outward normals computed from vertices)
    tris.push({
      normal: { x: 0, y: 0, z: 0 },
      v1: topRing[i],
      v2: bottomRing[i],
      v3: bottomRing[j],
    });
    tris.push({
      normal: { x: 0, y: 0, z: 0 },
      v1: topRing[i],
      v2: bottomRing[j],
      v3: topRing[j],
    });

    // Top cap (normal +Z)
    tris.push({
      normal: { x: 0, y: 0, z: 1 },
      v1: topCenter,
      v2: topRing[j],
      v3: topRing[i],
    });

    // Bottom cap (normal -Z)
    tris.push({
      normal: { x: 0, y: 0, z: -1 },
      v1: bottomCenter,
      v2: bottomRing[i],
      v3: bottomRing[j],
    });
  }

  return tris;
}

// ─── Per-layer filament volume estimate ───────────────────────────────────────

/**
 * Estimate filament used for a single layer from its contour area.
 *
 * Model:
 *   - Shell perimeter  → nozzle width × layer height × perimeter length × shellCount
 *   - Infill area      → (area − shell offset area) × infill density × layer height
 *
 * Returns mm³ of filament for this layer.
 */
function layerFilamentVolume(contours, layerHeight, options = {}) {
  const nozzleDiameter = options.nozzleDiameter || 0.4;
  const infillDensity = options.infillDensity || 0.2;
  const shellCount = options.shellCount || 3;

  let totalVolume = 0;

  for (const contour of contours) {
    const area = polygonArea2D(contour);

    let perimeter = 0;
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }

    const shellVolume = perimeter * nozzleDiameter * layerHeight * shellCount;

    const innerArea = Math.max(
      0,
      area - perimeter * nozzleDiameter * shellCount,
    );
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
 * @param {number} [options.layerHeight=0.2]         layer height in mm
 * @param {number} [options.overhangAngle=45]         overhang threshold in degrees
 * @param {number} [options.nozzleDiameter=0.4]       nozzle diameter in mm
 * @param {number} [options.infillDensity=0.20]       infill ratio 0–1
 * @param {number} [options.shellCount=3]             number of perimeter shells
 * @param {number} [options.supportRadius=0.4]        support pillar tip radius mm
 * @param {number} [options.airGap=0.2]               gap between support and model mm
 * @param {string} [options.supportType="linear"]     "linear" | "grid" | "tree"
 * @param {number} [options.supportSpacing=1.5]       sample/grid spacing mm
 * @param {number} [options.buildPlateZ]              Z of build plate (default: model minZ)
 * @returns {SlicerResult}
 */
function slice(triangles, options = {}) {
  if (!triangles || triangles.length === 0) {
    throw new Error("No triangles provided to slicer.");
  }

  const layerHeight = options.layerHeight || 0.2;
  const overhangAngle = options.overhangAngle || 45;
  const nozzleDiameter = options.nozzleDiameter || 0.4;
  const infillDensity = options.infillDensity || 0.2;
  const shellCount = options.shellCount || 3;
  const supportRadius = options.supportRadius || options.nozzleDiameter || 0.4;
  const airGap = options.airGap !== undefined ? options.airGap : 0.2;
  const supportType = options.supportType || "linear";
  const supportSpacing = options.supportSpacing || 1.5;

  // ── Find Z extents ───────────────────────────────────────────────────────────
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const { v1, v2, v3 } of triangles) {
    for (const v of [v1, v2, v3]) {
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  }

  const buildPlateZ =
    options.buildPlateZ !== undefined ? options.buildPlateZ : minZ;
  const modelHeight = maxZ - minZ;

  if (modelHeight < layerHeight) {
    throw new Error(
      `Model height (${modelHeight.toFixed(3)} mm) is less than layer height (${layerHeight} mm).`,
    );
  }

  const layerCount = Math.ceil(modelHeight / layerHeight);

  // ── Pre-bucket triangles by Z range ─────────────────────────────────────────
  // Used for ray casting (find surface below) and overhang detection.
  const triBuckets = triangles.map((tri) => {
    const zVals = [tri.v1.z, tri.v2.z, tri.v3.z];
    return { tri, zMin: Math.min(...zVals), zMax: Math.max(...zVals) };
  });

  // ── Identify overhang triangles ──────────────────────────────────────────────
  // Use a small supportGap for the "is there material below?" check —
  // we look within 2 layer heights to decide if support is truly needed.
  const supportGap = layerHeight * 2;

  const overhangTriangles = [];
  for (const tri of triangles) {
    if (isOverhang(tri, overhangAngle, buildPlateZ, triBuckets, supportGap)) {
      overhangTriangles.push(tri);
    }
  }

  // ── Generate support pillars ─────────────────────────────────────────────────
  const supportPillars = generateSupportPillars(overhangTriangles, {
    supportType,
    supportRadius,
    airGap,
    buildPlateZ,
    triBuckets,
    spacing: supportSpacing,
  });

  // Convert pillars to triangles for STL export
  const supportTriangles = [];
  for (const pillar of supportPillars) {
    supportTriangles.push(...pillarToTriangles(pillar));
  }

  // ── Slice each layer ─────────────────────────────────────────────────────────
  const layers = [];

  let totalFilamentMm3 = 0;
  let totalSupportMm3 = 0;
  let layerWithMaxArea = null;
  let maxLayerArea = 0;

  for (let i = 0; i < layerCount; i++) {
    const zPlane = minZ + (i + 0.5) * layerHeight;

    // Collect intersecting segments
    const segments = [];
    for (const { tri, zMin: tMin, zMax: tMax } of triBuckets) {
      if (tMin > zPlane || tMax < zPlane) continue;
      const seg = intersectTrianglePlane(tri.v1, tri.v2, tri.v3, zPlane);
      if (seg) {
        segments.push({
          a: { x: seg.a.x, y: seg.a.y },
          b: { x: seg.b.x, y: seg.b.y },
        });
      }
    }

    const contours = chainSegments(segments);
    const layerArea = contours.reduce((sum, c) => sum + polygonArea2D(c), 0);

    const filamentVol = layerFilamentVolume(contours, layerHeight, {
      nozzleDiameter,
      infillDensity,
      shellCount,
    });

    // Support volume for this layer slice (sum of pillar cross-sections)
    let supportVolLayer = 0;
    for (const pillar of supportPillars) {
      if (pillar.bottomZ <= zPlane && pillar.topZ >= zPlane) {
        const pillarArea = Math.PI * pillar.radius * pillar.radius;
        supportVolLayer += pillarArea * layerHeight;
      }
    }

    totalFilamentMm3 += filamentVol;
    totalSupportMm3 += supportVolLayer;

    if (layerArea > maxLayerArea) {
      maxLayerArea = layerArea;
      layerWithMaxArea = i + 1;
    }

    layers.push({
      layerIndex: i + 1,
      zBottom: parseFloat((minZ + i * layerHeight).toFixed(4)),
      zTop: parseFloat((minZ + (i + 1) * layerHeight).toFixed(4)),
      zPlane: parseFloat(zPlane.toFixed(4)),
      segmentCount: segments.length,
      contourCount: contours.length,
      contours,
      areaMm2: parseFloat(layerArea.toFixed(4)),
      filamentMm3: parseFloat(filamentVol.toFixed(4)),
      hasSupportAt: supportPillars.some(
        (p) => p.bottomZ <= zPlane && p.topZ >= zPlane,
      ),
    });
  }

  return {
    settings: {
      layerHeight,
      overhangAngle,
      nozzleDiameter,
      infillDensity,
      shellCount,
      supportRadius,
      airGap,
      supportType,
      buildPlateZ,
    },

    modelMinZ: parseFloat(minZ.toFixed(4)),
    modelMaxZ: parseFloat(maxZ.toFixed(4)),
    modelHeight: parseFloat(modelHeight.toFixed(4)),

    layerCount,
    layers,

    overhangTriangleCount: overhangTriangles.length,
    supportPillarCount: supportPillars.length,
    supportPillars,
    supportTriangles,

    totalFilamentMm3: parseFloat(totalFilamentMm3.toFixed(4)),
    totalSupportMm3: parseFloat(totalSupportMm3.toFixed(4)),
    totalMaterialMm3: parseFloat(
      (totalFilamentMm3 + totalSupportMm3).toFixed(4),
    ),

    layerWithMaxArea,
    maxLayerAreaMm2: parseFloat(maxLayerArea.toFixed(4)),
  };
}

// ─── Merge model + support triangles for STL output ──────────────────────────

/**
 * Combine model triangles with support triangles into one mesh.
 */
function mergeWithSupports(modelTriangles, slicerResult) {
  return [...modelTriangles, ...slicerResult.supportTriangles];
}

module.exports = {
  slice,
  mergeWithSupports,

  // Exposed for testing
  isOverhang,
  generateSupportPillars,
  pillarToTriangles,
  sampleTrianglePoints,
  findSurfaceBelow,
  buildGridSupports,
  buildTreeSupports,
};
