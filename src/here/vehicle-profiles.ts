/**
 * Vehicle profile definitions for HERE Routing API
 * All measurements in metric units
 */
export interface VehicleProfile {
  /** Gross weight in kg */
  grossWeight: number;
  /** Height in meters */
  height: number;
  /** Width in meters */
  width: number;
  /** Length in meters */
  length: number;
  /** Number of axles */
  axleCount: number;
}

export type VehicleProfileId = 'van_8ep' | 'solo_18t_23ep' | 'ftl_13_6_33ep';

/**
 * Central vehicle profile definitions
 */
export const VEHICLE_PROFILES: Record<VehicleProfileId, VehicleProfile> = {
  /**
   * Van - 8 euro pallets capacity
   * Light commercial vehicle under 3.5t
   */
  van_8ep: {
    grossWeight: 3500,
    height: 2.7,
    width: 2.2,
    length: 6.5,
    axleCount: 2,
  },

  /**
   * Solo truck - 18t, 23 euro pallets capacity
   * Medium rigid truck
   */
  solo_18t_23ep: {
    grossWeight: 18000,
    height: 3.6,
    width: 2.55,
    length: 10.0,
    axleCount: 2,
  },

  /**
   * Full truck load - 13.6m trailer, 33 euro pallets capacity
   * Articulated truck / tractor-trailer
   */
  ftl_13_6_33ep: {
    grossWeight: 40000,
    height: 4.0,
    width: 2.55,
    length: 16.5,
    axleCount: 5,
  },
} as const;

/**
 * Get vehicle profile by ID
 * @throws Error if profile ID is invalid
 */
export function getVehicleProfile(id: VehicleProfileId): VehicleProfile {
  const profile = VEHICLE_PROFILES[id];
  if (!profile) {
    throw new Error(`Unknown vehicle profile: ${id}`);
  }
  return profile;
}
