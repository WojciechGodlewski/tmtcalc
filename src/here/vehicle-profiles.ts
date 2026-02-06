/**
 * Vehicle profile definitions for HERE Routing API v8
 * Dimensions in centimeters (as required by HERE API), weight in kg
 */
export interface VehicleProfile {
  /** Gross weight in kg */
  grossWeight: number;
  /** Height in centimeters */
  heightCm: number;
  /** Width in centimeters */
  widthCm: number;
  /** Length in centimeters */
  lengthCm: number;
  /** Number of axles */
  axleCount: number;
}

export type VehicleProfileId = 'van_8ep' | 'solo_18t_23ep' | 'ftl_13_6_33ep';

/**
 * Central vehicle profile definitions
 * Dimensions in centimeters for HERE Routing API v8
 */
export const VEHICLE_PROFILES: Record<VehicleProfileId, VehicleProfile> = {
  /**
   * Van - 8 euro pallets capacity
   * Light commercial vehicle under 3.5t
   */
  van_8ep: {
    grossWeight: 3500,
    heightCm: 270,
    widthCm: 220,
    lengthCm: 650,
    axleCount: 2,
  },

  /**
   * Solo truck - 18t, 23 euro pallets capacity
   * Medium rigid truck
   */
  solo_18t_23ep: {
    grossWeight: 18000,
    heightCm: 360,
    widthCm: 255,
    lengthCm: 1000,
    axleCount: 2,
  },

  /**
   * Full truck load - 13.6m trailer, 33 euro pallets capacity
   * Articulated truck / tractor-trailer
   */
  ftl_13_6_33ep: {
    grossWeight: 40000,
    heightCm: 400,
    widthCm: 255,
    lengthCm: 1650,
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
