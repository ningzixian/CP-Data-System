import type { InspectionRecord } from '@/types/models'

export type InsulationResistanceUnit = 'Ω' | 'kΩ' | 'MΩ'

export interface InletInsulationReading {
  inlet_id: number
  inlet_code: string
  bolt_resistances: Array<number | null>
  bolt_resistance_units: InsulationResistanceUnit[]
  flange_resistance: number | null
  flange_resistance_unit: InsulationResistanceUnit
}

export function insulationPhotoOwnerKey(unitId: number, inletId: number): string {
  return `joint-verify:${unitId}:inlet:${inletId}`
}

function numericOrNull(value: unknown): number | null {
  if (value === '' || value === undefined || value === null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function resistanceUnit(value: unknown): InsulationResistanceUnit {
  return value === 'Ω' || value === 'kΩ' || value === 'MΩ' ? value : 'MΩ'
}

export function normalizeInletInsulation(value: unknown): InletInsulationReading | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const inletId = Number(source.inlet_id)
  if (!Number.isFinite(inletId)) return null
  const bolts = Array.isArray(source.bolt_resistances) ? source.bolt_resistances : []
  const boltUnits = Array.isArray(source.bolt_resistance_units) ? source.bolt_resistance_units : []
  return {
    inlet_id: inletId,
    inlet_code: String(source.inlet_code ?? inletId),
    bolt_resistances: Array.from({ length: 4 }, (_, index) => numericOrNull(bolts[index])),
    bolt_resistance_units: Array.from({ length: 4 }, (_, index) => resistanceUnit(boltUnits[index])),
    flange_resistance: numericOrNull(source.flange_resistance),
    flange_resistance_unit: resistanceUnit(source.flange_resistance_unit),
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
  const toMegaohms = (value: number | null, unit: InsulationResistanceUnit): number | null => {
    if (value === null || !Number.isFinite(value)) return null
    if (unit === 'Ω') return value / 1_000_000
    if (unit === 'kΩ') return value / 1_000
    return value
  }
  return readings.flatMap((reading) => [
    ...reading.bolt_resistances.map((value, index) => toMegaohms(value, reading.bolt_resistance_units[index] ?? 'MΩ')),
    toMegaohms(reading.flange_resistance, reading.flange_resistance_unit),
  ]).filter((value): value is number => value !== null)
}
