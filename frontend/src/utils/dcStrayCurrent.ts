import type { InspectionRecord } from '@/types/models'

export interface DcStrayPhoto {
  name: string
  url: string
}

export interface DcStrayCurrentPoint {
  id: number
  name: string
  lng: number | null
  lat: number | null
  potential_readings: number[]
  min_potential: number | null
  max_potential: number | null
  average_potential: number | null
  potential_fluctuation: number | null
  reference_electrode: string
  note: string
  photo_urls: DcStrayPhoto[]
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function dcStrayPhotoOwnerKey(unitId: number, pointId: number): string {
  return `dc-stray-current:${unitId}:point:${pointId}`
}

export function calculateDcStrayStatistics(readings: number[]) {
  const values = readings.map(Number).filter(Number.isFinite)
  if (!values.length) return { min: null, max: null, average: null, fluctuation: null }
  const min = Math.min(...values)
  const max = Math.max(...values)
  return {
    min: Number(min.toFixed(4)),
    max: Number(max.toFixed(4)),
    average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)),
    fluctuation: Number(((max - min) * 1000).toFixed(1)),
  }
}

export function normalizeDcStrayCurrentPoint(value: unknown): DcStrayCurrentPoint | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const id = Number(source.id)
  if (!Number.isFinite(id)) return null
  const potentialReadings = Array.isArray(source.potential_readings)
    ? source.potential_readings.map(Number).filter(Number.isFinite)
    : []
  const stats = calculateDcStrayStatistics(potentialReadings)
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
    name: String(source.name ?? `监测点 ${id}`),
    lng: numberOrNull(source.lng),
    lat: numberOrNull(source.lat),
    potential_readings: potentialReadings,
    min_potential: numberOrNull(source.min_potential) ?? stats.min,
    max_potential: numberOrNull(source.max_potential) ?? stats.max,
    average_potential: numberOrNull(source.average_potential) ?? stats.average,
    potential_fluctuation: numberOrNull(source.potential_fluctuation) ?? stats.fluctuation,
    reference_electrode: String(source.reference_electrode ?? 'Cu/CuSO₄'),
    note: String(source.note ?? ''),
    photo_urls: photoUrls,
  }
}

export function dcStrayCurrentPoints(record?: InspectionRecord): DcStrayCurrentPoint[] {
  const source = record?.result_data?.monitoring_points
  if (!Array.isArray(source)) return []
  return source.map(normalizeDcStrayCurrentPoint).filter((point): point is DcStrayCurrentPoint => !!point)
}

export function hasDcStrayCoordinates(point: DcStrayCurrentPoint): point is DcStrayCurrentPoint & { lng: number; lat: number } {
  return point.lng !== null && point.lat !== null && Number.isFinite(point.lng) && Number.isFinite(point.lat)
}

export function hasCompleteDcStrayReading(point: DcStrayCurrentPoint): boolean {
  return hasDcStrayCoordinates(point) && point.potential_readings.length > 0
}
