/**
 * 地理工具：点-多边形归属判断、多边形 bbox、面积等
 */

/** 射线法判断点 (lng, lat) 是否在多边形内（仅支持外环，不处理 hole） */
export function pointInPolygon(
  point: [number, number],
  polygon: Array<[number, number]>,
): boolean {
  const [x, y] = point
  if (polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

/** 多边形外接矩形 [minX, minY, maxX, maxY] */
export function polygonBBox(polygon: Array<[number, number]>): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of polygon) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

/** 点是否在 bbox 内（粗筛） */
export function pointInBBox(
  point: [number, number],
  bbox: [number, number, number, number],
): boolean {
  const [x, y] = point
  const [minX, minY, maxX, maxY] = bbox
  return x >= minX && x <= maxX && y >= minY && y <= maxY
}

/** 多边形面积（平方米）— 球面简化版（适合小区级尺度） */
export function polygonAreaM2(polygon: Array<[number, number]>): number {
  if (polygon.length < 3) return 0
  // 取第一个点的纬度作为参考纬度
  const refLat = polygon[0][1]
  const metersPerDegLng = 111320 * Math.cos((refLat * Math.PI) / 180)
  const metersPerDegLat = 110540
  let area = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const xiM = xi * metersPerDegLng
    const yiM = yi * metersPerDegLat
    const xjM = xj * metersPerDegLng
    const yjM = yj * metersPerDegLat
    area += xjM * yiM - xiM * yjM
  }
  return Math.abs(area / 2)
}

/** 计算几何中心（外环所有点平均） */
export function polygonCenter(polygon: Array<[number, number]>): [number, number] {
  if (polygon.length === 0) return [0, 0]
  let cx = 0, cy = 0
  for (const [x, y] of polygon) {
    cx += x; cy += y
  }
  return [cx / polygon.length, cy / polygon.length]
}