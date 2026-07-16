import type { InspectionRecord } from '@/types/models'

export interface InletPotentialReading {
  inlet_id: number
  inlet_code: string
  natural_potential: number | null
  reference_electrode: string
  test_method: string
  note: string
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function normalizeInletPotentialReading(value: unknown): InletPotentialReading | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const inletId = Number(source.inlet_id)
  if (!Number.isFinite(inletId)) return null
  return {
    inlet_id: inletId,
    inlet_code: String(source.inlet_code ?? inletId),
    natural_potential: numberOrNull(source.natural_potential),
    reference_electrode: String(source.reference_electrode ?? 'Cu/CuSO₄'),
    test_method: String(source.test_method ?? '自然电位法'),
    note: String(source.note ?? ''),
  }
}

export function inletPotentialReadings(record?: InspectionRecord): Map<number, InletPotentialReading> {
  const source = record?.result_data?.inlets
  if (!Array.isArray(source)) return new Map()
  const readings = new Map<number, InletPotentialReading>()
  source.forEach((value) => {
    const reading = normalizeInletPotentialReading(value)
    if (reading) readings.set(reading.inlet_id, reading)
  })
  return readings
}

export function hasNaturalPotential(reading?: InletPotentialReading): boolean {
  return reading?.natural_potential !== null && reading?.natural_potential !== undefined
}

export function pipePotentialValues(readings: InletPotentialReading[]): number[] {
  return readings.flatMap((reading) => reading.natural_potential === null ? [] : [reading.natural_potential])
}

export function pipePotentialPhotoOwnerKey(unitId: number, inletId: number): string {
  return `pipe-ground-potential:${unitId}:inlet:${inletId}`
}
