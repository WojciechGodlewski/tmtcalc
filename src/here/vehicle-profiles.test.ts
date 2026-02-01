import { describe, it, expect } from 'vitest';
import { VEHICLE_PROFILES, getVehicleProfile, type VehicleProfileId } from './vehicle-profiles.js';

describe('VehicleProfiles', () => {
  describe('VEHICLE_PROFILES', () => {
    it('defines van_8ep profile with dimensions in cm', () => {
      const profile = VEHICLE_PROFILES.van_8ep;
      expect(profile.grossWeight).toBe(3500);
      expect(profile.heightCm).toBe(270);
      expect(profile.widthCm).toBe(220);
      expect(profile.lengthCm).toBe(650);
      expect(profile.axleCount).toBe(2);
    });

    it('defines solo_18t_23ep profile with dimensions in cm', () => {
      const profile = VEHICLE_PROFILES.solo_18t_23ep;
      expect(profile.grossWeight).toBe(18000);
      expect(profile.heightCm).toBe(360);
      expect(profile.widthCm).toBe(255);
      expect(profile.lengthCm).toBe(1000);
      expect(profile.axleCount).toBe(2);
    });

    it('defines ftl_13_6_33ep profile with dimensions in cm', () => {
      const profile = VEHICLE_PROFILES.ftl_13_6_33ep;
      expect(profile.grossWeight).toBe(40000);
      expect(profile.heightCm).toBe(400);
      expect(profile.widthCm).toBe(255);
      expect(profile.lengthCm).toBe(1650);
      expect(profile.axleCount).toBe(5);
    });

    it('has exactly 3 profiles', () => {
      expect(Object.keys(VEHICLE_PROFILES)).toHaveLength(3);
    });
  });

  describe('getVehicleProfile', () => {
    it('returns profile for valid ID', () => {
      const ids: VehicleProfileId[] = ['van_8ep', 'solo_18t_23ep', 'ftl_13_6_33ep'];

      for (const id of ids) {
        const profile = getVehicleProfile(id);
        expect(profile).toBeDefined();
        expect(profile.grossWeight).toBeGreaterThan(0);
      }
    });

    it('throws error for invalid ID', () => {
      expect(() => getVehicleProfile('invalid' as VehicleProfileId))
        .toThrow('Unknown vehicle profile: invalid');
    });
  });

  describe('profile constraints', () => {
    it('van is under 3.5t limit', () => {
      expect(VEHICLE_PROFILES.van_8ep.grossWeight).toBeLessThanOrEqual(3500);
    });

    it('all profiles have valid dimensions in cm', () => {
      for (const profile of Object.values(VEHICLE_PROFILES)) {
        expect(profile.heightCm).toBeGreaterThan(0);
        expect(profile.widthCm).toBeGreaterThan(0);
        expect(profile.lengthCm).toBeGreaterThan(0);
        expect(profile.axleCount).toBeGreaterThanOrEqual(2);
      }
    });

    it('all dimensions are integers (cm, no decimals)', () => {
      for (const profile of Object.values(VEHICLE_PROFILES)) {
        expect(Number.isInteger(profile.heightCm)).toBe(true);
        expect(Number.isInteger(profile.widthCm)).toBe(true);
        expect(Number.isInteger(profile.lengthCm)).toBe(true);
      }
    });

    it('FTL is the heaviest', () => {
      expect(VEHICLE_PROFILES.ftl_13_6_33ep.grossWeight)
        .toBeGreaterThan(VEHICLE_PROFILES.solo_18t_23ep.grossWeight);
      expect(VEHICLE_PROFILES.solo_18t_23ep.grossWeight)
        .toBeGreaterThan(VEHICLE_PROFILES.van_8ep.grossWeight);
    });
  });
});
