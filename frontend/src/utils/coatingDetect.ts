import type { InspectionRecord } from '@/types/models'

export interface CoatingDamagePhoto {
  name: string
  url: string
}

export interface CoatingDamagePoint {
  id: number
  name: string
  building: string
  location_desc: string
  lng: number | null
  lat: number | null
  source_x: number | null
  source_y: number | null
  buried_depth: number | null
  leakage_potential: number | null
  surface: string
  severity: string
  note: string
  photo_urls: CoatingDamagePhoto[]
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function coatingDamagePhotoOwnerKey(unitId: number, pointId: number): string {
  return `coating-detect:${unitId}:point:${pointId}`
}

export function normalizeCoatingDamagePoint(value: unknown): CoatingDamagePoint | null {
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
    name: String(source.name ?? `破损点 ${id}`),
    building: String(source.building ?? ''),
    location_desc: String(source.location_desc ?? ''),
    lng: numberOrNull(source.lng),
    lat: numberOrNull(source.lat),
    source_x: numberOrNull(source.source_x),
    source_y: numberOrNull(source.source_y),
    buried_depth: numberOrNull(source.buried_depth),
    leakage_potential: numberOrNull(source.leakage_potential),
    surface: String(source.surface ?? ''),
    severity: String(source.severity ?? '疑似破损'),
    note: String(source.note ?? ''),
    photo_urls: photoUrls,
  }
}

export function coatingDamagePoints(record?: InspectionRecord): CoatingDamagePoint[] {
  const source = record?.result_data?.damage_locations
  if (!Array.isArray(source)) return []
  return source.map(normalizeCoatingDamagePoint).filter((point): point is CoatingDamagePoint => !!point)
}

export function hasCoatingDamageCoordinates(point: CoatingDamagePoint): point is CoatingDamagePoint & { lng: number; lat: number } {
  return point.lng !== null && point.lat !== null && Number.isFinite(point.lng) && Number.isFinite(point.lat)
}

export function hasCompleteCoatingDamagePoint(point: CoatingDamagePoint): boolean {
  return hasCoatingDamageCoordinates(point)
    && point.buried_depth !== null
    && point.leakage_potential !== null
    && !!point.location_desc.trim()
}
