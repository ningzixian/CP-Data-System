import type { InspectionRecord } from '@/types/models'

export interface InletParameterReading {
  inlet_id: number
  inlet_code: string
  diameter_readings: number[]
  average_diameter: number | null
  diameter_difference: number | null
  out_of_roundness: number | null
  wall_thickness: number | null
  instrument: string
  note: string
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function computeInletDiameterStats(values: number[]): Pick<InletParameterReading, 'average_diameter' | 'diameter_difference' | 'out_of_roundness'> {
  const valid = values.filter(Number.isFinite)
  if (!valid.length) return { average_diameter: null, diameter_difference: null, out_of_roundness: null }
  const average = valid.reduce((sum, value) => sum + value, 0) / valid.length
  const difference = Math.max(...valid) - Math.min(...valid)
  return {
    average_diameter: Number(average.toFixed(2)),
    diameter_difference: Number(difference.toFixed(2)),
    out_of_roundness: average ? Number((difference / average * 100).toFixed(3)) : null,
  }
}

export function normalizeInletParameterReading(value: unknown): InletParameterReading | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const inletId = Number(source.inlet_id)
  if (!Number.isFinite(inletId)) return null
  const diameterReadings = Array.isArray(source.diameter_readings)
    ? source.diameter_readings.map(Number).filter(Number.isFinite)
    : []
  const calculated = computeInletDiameterStats(diameterReadings)
  return {
    inlet_id: inletId,
    inlet_code: String(source.inlet_code ?? inletId),
    diameter_readings: diameterReadings,
    average_diameter: numberOrNull(source.average_diameter) ?? calculated.average_diameter,
    diameter_difference: numberOrNull(source.diameter_difference) ?? calculated.diameter_difference,
    out_of_roundness: numberOrNull(source.out_of_roundness) ?? calculated.out_of_roundness,
    wall_thickness: numberOrNull(source.wall_thickness),
    instrument: String(source.instrument ?? '数显游标卡尺'),
    note: String(source.note ?? ''),
  }
}

export function inletParameterReadings(record?: InspectionRecord): Map<number, InletParameterReading> {
  const source = record?.result_data?.inlets
  if (!Array.isArray(source)) return new Map()
  const readings = new Map<number, InletParameterReading>()
  source.forEach((value) => {
    const reading = normalizeInletParameterReading(value)
    if (reading) readings.set(reading.inlet_id, reading)
  })
  return readings
}

export function hasInletParameterResult(reading?: InletParameterReading): boolean {
  return reading?.average_diameter !== null && reading?.average_diameter !== undefined
}

export function inletParameterPhotoOwnerKey(unitId: number, inletId: number): string {
  return `inlet-parameters:${unitId}:inlet:${inletId}`
}
