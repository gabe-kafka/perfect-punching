/**
 * Load-combination helpers.  Keep one source of truth for what "wu"
 * means so UI, debug report, FEA, and headless harnesses don't drift.
 *
 * wu (psi, positive downward) = (1.2 * DL_total + 1.6 * LL) / 144
 *   DL_total = SDL (user input `deadPsf`) + slab self-weight
 *   slab self-weight = hIn / 12 × γ_c  (pcf → psf at slab thickness)
 */
import type { ProjectInputs } from "./types";

export const DEFAULT_CONCRETE_UNIT_WEIGHT_PCF = 150;

export function slabSelfWeightPsf(inputs: ProjectInputs): number {
  const gamma = inputs.concreteUnitWeightPcf ?? DEFAULT_CONCRETE_UNIT_WEIGHT_PCF;
  return (inputs.hIn / 12) * gamma;
}

export function totalDeadPsf(inputs: ProjectInputs): number {
  return inputs.deadPsf + slabSelfWeightPsf(inputs);
}

export function factoredPressurePsi(inputs: ProjectInputs): number {
  return (1.2 * totalDeadPsf(inputs) + 1.6 * inputs.livePsf) / 144;
}
