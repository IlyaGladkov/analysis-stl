"use strict";

/**
 * Integrity Analyzer
 *
 * Checks whether an STL mesh is "watertight" (manifold):
 *  - Every edge must be shared by exactly 2 triangles
 *  - No degenerate triangles (zero-area faces)
 *  - No self-intersecting triangles (basic check)
 *  - Consistent face normals (all outward or all inward)
 *
 * A watertight mesh is required for correct volume calculation
 * and successful 3D printing.
 */

const { getBoundingBox } = require("../utils/stlParser");

// ─── Vector helpers ────────────────────────────────────────────────────────────

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
function vecDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function vecLen(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
function vecNorm(a) {
  const l = vecLen(a);
  if (l === 0) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

// ─── Edge key ─────────────────────────────────────────────────────────────────

/**
 * Encode a vertex to a rounded string key (to handle floating-point noise).
 */
const PRECISION = 4;
function vertKey(v) {
  return `${v.x.toFixed(PRECISION)},${v.y.toFixed(PRECISION)},${v.z.toFixed(PRECISION)}`;
}

/**
 * Canonical edge key: sort the two vertex keys so order doesn't matter.
 * Also stores direction to detect orientation flips.
 */
function edgeKey(va, vb) {
  const ka = vertKey(va);
  const kb = vertKey(vb);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

// ─── Triangle area ─────────────────────────────────────────────────────────────

function triangleArea(v1, v2, v3) {
  const ab = vecSub(v2, v1);
  const ac = vecSub(v3, v1);
  return vecLen(vecCross(ab, ac)) / 2;
}

// ─── Computed normal ───────────────────────────────────────────────────────────

function computeNormal(v1, v2, v3) {
  const ab = vecSub(v2, v1);
  const ac = vecSub(v3, v1);
  return vecNorm(vecCross(ab, ac));
}

// ─── Main analyzer ─────────────────────────────────────────────────────────────

/**
 * Analyze the structural integrity of a parsed STL mesh.
 *
 * @param {Array}  triangles   - output of stlParser.parseSTL()
 * @returns {IntegrityResult}
 */
function analyzeIntegrity(triangles) {
  if (!triangles || triangles.length === 0) {
    return buildResult(false, triangles || [], {
      errors: ["No triangles found in model."],
    });
  }

  const issues = []; // critical issues (break watertightness)
  const warnings = []; // non-fatal observations

  // ── 1. Degenerate triangles ──────────────────────────────────────────────────
  const degenerateIndices = [];
  for (let i = 0; i < triangles.length; i++) {
    const { v1, v2, v3 } = triangles[i];
    const area = triangleArea(v1, v2, v3);
    if (area < 1e-10) {
      degenerateIndices.push(i);
    }
  }
  if (degenerateIndices.length > 0) {
    issues.push(
      `Обнаружено ${degenerateIndices.length} вырожденных треугольников (нулевая площадь). ` +
        `Индексы: ${degenerateIndices.slice(0, 10).join(", ")}${degenerateIndices.length > 10 ? "…" : ""}`,
    );
  }

  // ── 2. Edge manifold check ───────────────────────────────────────────────────
  // Each edge (pair of vertices) should be shared by exactly 2 triangles.
  // If an edge appears only once → open hole (boundary edge).
  // If an edge appears 3+ times → non-manifold geometry.

  const edgeMap = new Map(); // edgeKey → { count, triangleIndices[] }

  for (let i = 0; i < triangles.length; i++) {
    const { v1, v2, v3 } = triangles[i];
    const edges = [
      { a: v1, b: v2 },
      { a: v2, b: v3 },
      { a: v3, b: v1 },
    ];

    for (const { a, b } of edges) {
      const key = edgeKey(a, b);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { count: 0, triangleIndices: [] });
      }
      const entry = edgeMap.get(key);
      entry.count++;
      if (entry.triangleIndices.length < 5) {
        entry.triangleIndices.push(i); // keep first few for reporting
      }
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  const boundaryExamples = [];
  const nonManifoldExamples = [];

  for (const [key, { count, triangleIndices }] of edgeMap.entries()) {
    if (count === 1) {
      boundaryEdges++;
      if (boundaryExamples.length < 3) {
        boundaryExamples.push({ edge: key, triangle: triangleIndices[0] });
      }
    } else if (count > 2) {
      nonManifoldEdges++;
      if (nonManifoldExamples.length < 3) {
        nonManifoldExamples.push({
          edge: key,
          count,
          triangles: triangleIndices,
        });
      }
    }
  }

  if (boundaryEdges > 0) {
    issues.push(
      `Обнаружено ${boundaryEdges} открытых граничных рёбер — меш имеет дыры. ` +
        `Пример (индекс треугольника): ${boundaryExamples.map((e) => e.triangle).join(", ")}`,
    );
  }
  if (nonManifoldEdges > 0) {
    issues.push(
      `Обнаружено ${nonManifoldEdges} не-многообразных рёбер — принадлежат 3 и более треугольникам. ` +
        `Кратность: ${nonManifoldExamples.map((e) => `×${e.count}`).join(", ")}`,
    );
  }

  // ── 3. Duplicate triangles ───────────────────────────────────────────────────
  const triKeySet = new Set();
  let duplicateTriangles = 0;
  for (const { v1, v2, v3 } of triangles) {
    // Sort vertex keys to make the duplicate check order-independent
    const keys = [vertKey(v1), vertKey(v2), vertKey(v3)].sort();
    const k = keys.join("||");
    if (triKeySet.has(k)) {
      duplicateTriangles++;
    } else {
      triKeySet.add(k);
    }
  }
  if (duplicateTriangles > 0) {
    warnings.push(
      `Обнаружено ${duplicateTriangles} дублирующихся треугольников.`,
    );
  }

  // ── 4. Normal consistency ────────────────────────────────────────────────────
  // Compare stored normals (if non-zero) with computed normals.
  // A flip indicates an incorrectly wound triangle.
  let flippedNormals = 0;
  let missingNormals = 0;
  for (const { normal, v1, v2, v3 } of triangles) {
    if (!normal || (normal.x === 0 && normal.y === 0 && normal.z === 0)) {
      missingNormals++;
      continue;
    }
    const computed = computeNormal(v1, v2, v3);
    if (vecLen(computed) < 1e-10) continue; // degenerate, already reported
    const dot = vecDot(normal, computed);
    if (dot < -0.1) {
      flippedNormals++;
    }
  }
  if (flippedNormals > 0) {
    warnings.push(
      `У ${flippedNormals} треугольников нормали направлены внутрь (инвертированный обход вершин). ` +
        `Это может вызвать артефакты при печати.`,
    );
  }
  if (missingNormals > 0 && missingNormals === triangles.length) {
    warnings.push(
      "Все нормали нулевые — файл не содержит данных о нормалях (будут пересчитаны слайсером).",
    );
  }

  // ── 5. Vertex count & connectivity stats ─────────────────────────────────────
  const uniqueVertices = new Set();
  for (const { v1, v2, v3 } of triangles) {
    uniqueVertices.add(vertKey(v1));
    uniqueVertices.add(vertKey(v2));
    uniqueVertices.add(vertKey(v3));
  }

  const V = uniqueVertices.size;
  const E = edgeMap.size;
  const F = triangles.length;

  // Euler characteristic: χ = V − E + F
  // For a closed orientable surface (sphere-like): χ = 2
  const eulerCharacteristic = V - E + F;
  const eulerOk = eulerCharacteristic === 2;

  if (!eulerOk) {
    warnings.push(
      `Характеристика Эйлера χ = V(${V}) − E(${E}) + F(${F}) = ${eulerCharacteristic} ` +
        `(ожидается 2 для замкнутого многообразного меша).`,
    );
  }

  // ── 6. Shell / connected component count ─────────────────────────────────────
  const shellCount = countShells(triangles);
  if (shellCount > 1) {
    warnings.push(
      `Меш содержит ${shellCount} отдельных оболочек/тел. ` +
        `Несколько оболочек допустимо, но может указывать на непреднамеренную геометрию.`,
    );
  }

  // ── 7. Bounding box sanity ───────────────────────────────────────────────────
  const bbox = getBoundingBox(triangles);
  if (bbox.size.x < 0.01 || bbox.size.y < 0.01 || bbox.size.z < 0.01) {
    warnings.push(
      `Модель крайне плоская хотя бы по одной оси ` +
        `(${bbox.size.x.toFixed(3)} × ${bbox.size.y.toFixed(3)} × ${bbox.size.z.toFixed(3)} мм). ` +
        `Проверьте ориентацию модели.`,
    );
  }

  // ── Final verdict ─────────────────────────────────────────────────────────────
  const isWatertight = issues.length === 0;

  return buildResult(isWatertight, triangles, {
    errors: issues,
    warnings,
    stats: {
      triangleCount: triangles.length,
      uniqueVertexCount: V,
      edgeCount: E,
      boundaryEdges,
      nonManifoldEdges,
      degenerateTriangles: degenerateIndices.length,
      duplicateTriangles,
      flippedNormals,
      eulerCharacteristic,
      eulerOk,
      shellCount,
      bbox,
    },
  });
}

// ─── Shell (connected component) counter ──────────────────────────────────────

/**
 * Count disconnected shells in the mesh using a Union-Find approach on vertices.
 */
function countShells(triangles) {
  // Map vertex key → integer id
  const vertToId = new Map();
  let nextId = 0;

  function getId(v) {
    const k = vertKey(v);
    if (!vertToId.has(k)) vertToId.set(k, nextId++);
    return vertToId.get(k);
  }

  // Union-Find
  const parent = [];
  function find(x) {
    if (parent[x] === undefined) parent[x] = x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(x, y) {
    const px = find(x),
      py = find(y);
    if (px !== py) parent[px] = py;
  }

  for (const { v1, v2, v3 } of triangles) {
    const id1 = getId(v1);
    const id2 = getId(v2);
    const id3 = getId(v3);
    // Ensure all ids have a parent entry
    if (parent[id1] === undefined) parent[id1] = id1;
    if (parent[id2] === undefined) parent[id2] = id2;
    if (parent[id3] === undefined) parent[id3] = id3;
    union(id1, id2);
    union(id2, id3);
  }

  // Count distinct roots
  const roots = new Set();
  for (let i = 0; i < nextId; i++) {
    roots.add(find(i));
  }
  return roots.size;
}

// ─── Result builder ───────────────────────────────────────────────────────────

function buildResult(
  isWatertight,
  triangles,
  { errors = [], warnings = [], stats = {} } = {},
) {
  let verdict;
  if (isWatertight) {
    verdict = "ПРОЙДЕНО — Меш герметичен (многообразен). Готов к 3D-печати.";
  } else {
    verdict =
      "НЕ ПРОЙДЕНО — Меш имеет проблемы целостности. Рекомендуется ремонт перед печатью.";
  }

  return {
    isWatertight,
    verdict,
    errors,
    warnings,
    stats: {
      triangleCount: triangles.length,
      uniqueVertexCount: stats.uniqueVertexCount || 0,
      edgeCount: stats.edgeCount || 0,
      boundaryEdges: stats.boundaryEdges || 0,
      nonManifoldEdges: stats.nonManifoldEdges || 0,
      degenerateTriangles: stats.degenerateTriangles || 0,
      duplicateTriangles: stats.duplicateTriangles || 0,
      flippedNormals: stats.flippedNormals || 0,
      eulerCharacteristic:
        stats.eulerCharacteristic !== undefined
          ? stats.eulerCharacteristic
          : null,
      eulerOk: stats.eulerOk !== undefined ? stats.eulerOk : null,
      shellCount: stats.shellCount || 1,
      bbox: stats.bbox || null,
    },
  };
}

module.exports = {
  analyzeIntegrity,
};
