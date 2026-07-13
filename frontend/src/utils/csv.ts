/**
 * CSV + WKT 解析工具
 * 用于加载南海家园七里的现场设施数据（来自 GIS 导出）
 */

/** 解析单行 CSV（支持引号包裹的逗号和双引号）。 */
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

/** 按完整文本解析 CSV，保留引号字段内部的换行。 */
export function parseCSVRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(field)
      field = ''
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

/** 解析 CSV 文本为对象数组 */
export function parseCSV(text: string): Record<string, string>[] {
  // 去掉 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = parseCSVRows(text)
  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).map((cells) => {
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
 * 解析 POLYGON / MULTIPOLYGON。
 * 返回多个 ring（外环 + 内环/hole）。每个 ring 是 [[lng, lat], ...]
 */
export function parseWKTPolygon(wkt: string): Array<Array<[number, number]>> {
  if (!wkt) return []
  const polygon = wkt.match(/POLYGON\s*\((.*)\)\s*$/is)
  const multiPolygon = wkt.match(/MULTIPOLYGON\s*\((.*)\)\s*$/is)
  const body = multiPolygon?.[1] ?? polygon?.[1]
  if (!body) return []
  const rings: Array<Array<[number, number]>> = []
  const ringRe = multiPolygon ? /\(\(\s*([^()]+?)\s*\)\)/g : /\(\s*([^()]+?)\s*\)/g
  let r
  while ((r = ringRe.exec(body)) !== null) {
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
