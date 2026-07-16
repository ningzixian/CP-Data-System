import type { InspectionRecord } from '@/types/models'

export interface InletInsulationReading {
  inlet_id: number
  inlet_code: string
  bolt_resistances: Array<number | null>
  flange_resistance: number | null
}

export function insulationPhotoOwnerKey(unitId: number, inletId: number): string {
  return `joint-verify:${unitId}:inlet:${inletId}`
}

function numericOrNull(value: unknown): number | null {
  if (value === '' || value === undefined || value === null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function normalizeInletInsulation(value: unknown): InletInsulationReading | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const inletId = Number(source.inlet_id)
  if (!Number.isFinite(inletId)) return null
  const bolts = Array.isArray(source.bolt_resistances) ? source.bolt_resistances : []
  return {
    inlet_id: inletId,
    inlet_code: String(source.inlet_code ?? inletId),
    bolt_resistances: Array.from({ length: 4 }, (_, index) => numericOrNull(bolts[index])),
    flange_resistance: numericOrNull(source.flange_resistance),
  }
}

export function inletInsulationReadings(record?: InspectionRecord): Map<number, InletInsulationReading> {
  const source = record?.result_data?.inlets
  if (!Array.isArray(source)) return new Map()
  const readings = new Map<number, InletInsulationReading>()
  source.forEach((value) => {
    const reading = normalizeInletInsulation(value)
    if (reading) readings.set(reading.inlet_id, reading)
  })
  return readings
}

export function hasCompleteInsulationReading(reading: InletInsulationReading): boolean {
  return reading.bolt_resistances.every((value) => value !== null)
    && reading.flange_resistance !== null
}

export function insulationValues(readings: InletInsulationReading[]): number[] {
  return readings.flatMap((reading) => [
    ...reading.bolt_resistances,
    reading.flange_resistance,
  ]).filter((value): value is number => value !== null && Number.isFinite(value))
}
