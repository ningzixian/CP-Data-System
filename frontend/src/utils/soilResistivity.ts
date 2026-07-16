import type { InspectionRecord } from '@/types/models'

export interface SoilResistivityPhoto {
  name: string
  url: string
}

export interface SoilResistivityPoint {
  id: number
  name: string
  lng: number | null
  lat: number | null
  ground_rod_count: number | null
  ground_rod_spacing: number | null
  test_current: number | null
  test_voltage: number | null
  measured_resistance: number | null
  geometric_coefficient: number | null
  resistivity: number | null
  note: string
  photo_urls: SoilResistivityPhoto[]
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function soilPhotoOwnerKey(unitId: number, pointId: number): string {
  return `soil-resistivity:${unitId}:point:${pointId}`
}

export function normalizeSoilResistivityPoint(value: unknown): SoilResistivityPoint | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const id = Number(source.id)
  if (!Number.isFinite(id)) return null
  const photoUrls = Array.isArray(source.photo_urls)
    ? source.photo_urls.flatMap((photo) => {
        if (!photo || typeof photo !== 'object') return []
        const item = photo as Record<string, unknown>
        const url = String(item.url ?? '').trim()
        return url ? [{ name: String(item.name ?? '现场照片'), url }] : []
      })
    : []
  return {
    id,
    name: String(source.name ?? `测试点 ${id}`),
    lng: numberOrNull(source.lng),
    lat: numberOrNull(source.lat),
    ground_rod_count: numberOrNull(source.ground_rod_count),
    ground_rod_spacing: numberOrNull(source.ground_rod_spacing),
    test_current: numberOrNull(source.test_current),
    test_voltage: numberOrNull(source.test_voltage),
    measured_resistance: numberOrNull(source.measured_resistance),
    geometric_coefficient: numberOrNull(source.geometric_coefficient),
    resistivity: numberOrNull(source.resistivity),
    note: String(source.note ?? ''),
    photo_urls: photoUrls,
  }
}

export function soilResistivityPoints(record?: InspectionRecord): SoilResistivityPoint[] {
  const source = record?.result_data?.test_points
  if (!Array.isArray(source)) return []
  return source.map(normalizeSoilResistivityPoint).filter((point): point is SoilResistivityPoint => !!point)
}

export function hasSoilCoordinates(point: SoilResistivityPoint): point is SoilResistivityPoint & { lng: number; lat: number } {
  return point.lng !== null && point.lat !== null
    && Number.isFinite(point.lng) && Number.isFinite(point.lat)
}

export function hasCompleteSoilReading(point: SoilResistivityPoint): boolean {
  return hasSoilCoordinates(point)
    && point.ground_rod_count !== null
    && point.ground_rod_spacing !== null
    && point.resistivity !== null
}
