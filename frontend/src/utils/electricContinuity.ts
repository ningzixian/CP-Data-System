import type { InspectionRecord } from '@/types/models'

export interface ElectricContinuityPhoto {
  name: string
  url: string
}

export interface ElectricContinuityPoint {
  id: number
  name: string
  target_type: string
  lng: number | null
  lat: number | null
  measured_resistance: number | null
  resistance_unit: string
  is_connected: boolean | null
  conclusion: string
  note: string
  photo_urls: ElectricContinuityPhoto[]
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function normalizeElectricContinuityPoint(value: unknown): ElectricContinuityPoint | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const id = Number(source.id)
  if (!Number.isFinite(id)) return null
  const photoUrls = Array.isArray(source.photo_urls)
    ? source.photo_urls.flatMap((photo) => {
      if (!photo || typeof photo !== 'object') return []
      const item = photo as Record<string, unknown>
      if (!item.url) return []
      return [{ name: String(item.name ?? '现场照片'), url: String(item.url) }]
    })
    : []
  return {
    id,
    name: String(source.name ?? `电联通测试点 ${id}`),
    target_type: String(source.target_type ?? '外部接地体'),
    lng: numberOrNull(source.lng),
    lat: numberOrNull(source.lat),
    measured_resistance: numberOrNull(source.measured_resistance),
    resistance_unit: String(source.resistance_unit ?? 'kΩ'),
    is_connected: source.is_connected === true ? true : source.is_connected === false ? false : null,
    conclusion: String(source.conclusion ?? '待判定'),
    note: String(source.note ?? ''),
    photo_urls: photoUrls,
  }
}

export function electricContinuityPoints(record?: InspectionRecord): ElectricContinuityPoint[] {
  const source = record?.result_data?.test_points
  if (!Array.isArray(source)) return []
  return source.flatMap((value) => {
    const point = normalizeElectricContinuityPoint(value)
    return point ? [point] : []
  })
}

export function hasElectricContinuityCoordinates(point: ElectricContinuityPoint): point is ElectricContinuityPoint & { lng: number; lat: number } {
  return point.lng !== null && point.lat !== null
}

export function hasElectricContinuityResult(point: ElectricContinuityPoint): boolean {
  return point.measured_resistance !== null
}

export function electricContinuityAverage(points: ElectricContinuityPoint[]): number | null {
  const values = points.flatMap((point) => {
    if (point.measured_resistance === null) return []
    return [point.resistance_unit === 'MΩ' ? point.measured_resistance * 1000 : point.measured_resistance]
  })
  if (!values.length) return null
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3))
}

export function electricContinuityPhotoOwnerKey(unitId: number, pointId: number): string {
  return `electric-continuity:${unitId}:point:${pointId}`
}
