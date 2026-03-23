'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Parses both ASCII and Binary STL files.
 * Returns an array of triangles: [{ normal, v1, v2, v3 }, ...]
 * where each vertex is { x, y, z }
 */

function parseSTL(filePath) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  const buffer = fs.readFileSync(absPath);
  if (isBinarySTL(buffer)) {
    return parseBinarySTL(buffer);
  } else {
    return parseASCIISTL(buffer.toString('utf8'));
  }
}

/**
 * Heuristic: if the file starts with "solid" and contains "facet normal",
 * treat as ASCII. Otherwise treat as binary.
 */
function isBinarySTL(buffer) {
  if (buffer.length < 84) return false;

  // Check ASCII signature
  const header = buffer.slice(0, 256).toString('ascii');
  if (header.trimStart().startsWith('solid')) {
    // Could still be binary if "facet" keyword is absent
    const text = buffer.toString('ascii');
    if (text.indexOf('facet normal') !== -1) {
      return false; // ASCII
    }
  }
  return true; // Binary
}

/**
 * Parse binary STL
 * Format:
 *   80 bytes  - header
 *   4 bytes   - number of triangles (uint32 LE)
 *   per triangle (50 bytes):
 *     12 bytes - normal (3 x float32 LE)
 *     12 bytes - vertex 1 (3 x float32 LE)
 *     12 bytes - vertex 2 (3 x float32 LE)
 *     12 bytes - vertex 3 (3 x float32 LE)
 *     2 bytes  - attribute byte count (ignored)
 */
function parseBinarySTL(buffer) {
  const triangleCount = buffer.readUInt32LE(80);
  const triangles = [];

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    const normal = readVec3(buffer, offset);       offset += 12;
    const v1    = readVec3(buffer, offset);        offset += 12;
    const v2    = readVec3(buffer, offset);        offset += 12;
    const v3    = readVec3(buffer, offset);        offset += 12;
    offset += 2; // attribute byte count

    triangles.push({ normal, v1, v2, v3 });
  }

  return triangles;
}

function readVec3(buffer, offset) {
  return {
    x: buffer.readFloatLE(offset),
    y: buffer.readFloatLE(offset + 4),
    z: buffer.readFloatLE(offset + 8),
  };
}

/**
 * Parse ASCII STL
 */
function parseASCIISTL(text) {
  const triangles = [];

  // Match each facet block
  const facetRegex =
    /facet\s+normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+outer\s+loop\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+endloop\s+endfacet/gi;

  let match;
  while ((match = facetRegex.exec(text)) !== null) {
    triangles.push({
      normal: { x: parseFloat(match[1]),  y: parseFloat(match[2]),  z: parseFloat(match[3])  },
      v1:     { x: parseFloat(match[4]),  y: parseFloat(match[5]),  z: parseFloat(match[6])  },
      v2:     { x: parseFloat(match[7]),  y: parseFloat(match[8]),  z: parseFloat(match[9])  },
      v3:     { x: parseFloat(match[10]), y: parseFloat(match[11]), z: parseFloat(match[12]) },
    });
  }

  if (triangles.length === 0) {
    throw new Error('No triangles found in ASCII STL. The file may be malformed.');
  }

  return triangles;
}

/**
 * Write triangles back to a binary STL file
 */
function writeBinarySTL(triangles, outputPath) {
  const headerBuf = Buffer.alloc(80, 0);
  headerBuf.write('STL Analyzer - generated file', 0, 'ascii');

  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(triangles.length, 0);

  const triangleBuffers = triangles.map((tri) => {
    const buf = Buffer.alloc(50, 0);
    let off = 0;

    const normal = tri.normal || { x: 0, y: 0, z: 0 };
    buf.writeFloatLE(normal.x, off);   off += 4;
    buf.writeFloatLE(normal.y, off);   off += 4;
    buf.writeFloatLE(normal.z, off);   off += 4;

    for (const v of [tri.v1, tri.v2, tri.v3]) {
      buf.writeFloatLE(v.x, off); off += 4;
      buf.writeFloatLE(v.y, off); off += 4;
      buf.writeFloatLE(v.z, off); off += 4;
    }

    // attribute byte count = 0
    buf.writeUInt16LE(0, off);
    return buf;
  });

  const finalBuf = Buffer.concat([headerBuf, countBuf, ...triangleBuffers]);
  fs.writeFileSync(outputPath, finalBuf);
}

/**
 * Compute bounding box from triangles
 */
function getBoundingBox(triangles) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const tri of triangles) {
    for (const v of [tri.v1, tri.v2, tri.v3]) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
      if (v.z > maxZ) maxZ = v.z;
    }
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    size: {
      x: maxX - minX,
      y: maxY - minY,
      z: maxZ - minZ,
    },
  };
}

module.exports = {
  parseSTL,
  writeBinarySTL,
  getBoundingBox,
  isBinarySTL,
};
