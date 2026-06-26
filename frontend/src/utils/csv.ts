/**
 * CSV + WKT 解析工具
 * 用于加载南海家园七里的现场设施数据（来自 GIS 导出）
 */

/** 解析 CSV 行（支持引号包裹的字段，含逗号或换行） */
export function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result
}

/** 解析 CSV 文本为对象数组 */
export function parseCSV(text: string): Record<string, string>[] {
  // 去掉 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  const headers = parseCSVLine(lines[0]).map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = parseCSVLine(line)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? '').trim()
    })
    return obj
  })
}

/** 解析 MULTIPOINT ((lng lat)) → [lng, lat] */
export function parseWKTPoint(wkt: string): [number, number] | null {
  if (!wkt) return null
  const m = wkt.match(/MULTIPOINT\s*\(\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)\s*\)/i)
  if (m) return [parseFloat(m[1]), parseFloat(m[2])]
  // 兼容 POINT (lng lat)
  const m2 = wkt.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i)
  if (m2) return [parseFloat(m2[1]), parseFloat(m2[2])]
  return null
}

/** 解析 MULTILINESTRING ((lng lat, lng lat, ...)) → [[lng, lat], ...] */
export function parseWKTLine(wkt: string): Array<[number, number]> | null {
  if (!wkt) return null
  const m = wkt.match(/MULTILINESTRING\s*\(\s*\(([^)]+)\)\s*\)/i)
  if (!m) return null
  return m[1]
    .split(',')
    .map((pair) => {
      const [lng, lat] = pair.trim().split(/\s+/).map(parseFloat)
      return [lng, lat] as [number, number]
    })
    .filter(([lng, lat]) => !isNaN(lng) && !isNaN(lat))
}

/**
 * 解析 MULTIPOLYGON (((lng lat, lng lat, ...)), ((lng lat, ...)), ...)
 * 返回多个 ring（外环 + 内环/hole）。每个 ring 是 [[lng, lat], ...]
 */
export function parseWKTPolygon(wkt: string): Array<Array<[number, number]>> {
  if (!wkt) return []
  const m = wkt.match(/MULTIPOLYGON\s*\((.*)\)\s*$/is)
  if (!m) return []
  const rings: Array<Array<[number, number]>> = []
  const ringRe = /\(\(\s*([^\(\)]+?)\s*\)\)/g
  let r
  while ((r = ringRe.exec(m[1])) !== null) {
    const coords = r[1]
      .split(',')
      .map((pair) => {
        const [lng, lat] = pair.trim().split(/\s+/).map(parseFloat)
        return [lng, lat] as [number, number]
      })
      .filter(([lng, lat]) => !isNaN(lng) && !isNaN(lat))
    if (coords.length >= 3) rings.push(coords)
  }
  return rings
}