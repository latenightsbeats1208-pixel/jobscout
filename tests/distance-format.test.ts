import { describe, expect, it } from "vitest";
import { depOfInsee, distanceLabel, formatKm, roundKm } from "@/lib/distance/format";

describe("affichage des distances", () => {
  it("arrondit comme le filtre et garde « km » sur la même ligne", () => {
    expect(roundKm(5.28)).toBe(5);
    expect(roundKm(104)).toBe(100);
    expect(roundKm(1249)).toBe(1200);
    expect(formatKm(0.3)).toBe("moins de 1 km");
    expect(formatKm(12.4)).toBe("12 km");
  });
  it("signale les lieux approximatifs (département, homonyme)", () => {
    expect(distanceLabel({ distance_km: 348, same_city: false, geo_precision: "homonyme" })).toBe("≈ 350 km");
    expect(distanceLabel({ distance_km: 25, same_city: false, geo_precision: "departement" })).toBe("≈ 25 km");
    expect(distanceLabel({ distance_km: 0.4, same_city: false, same_dept: true, geo_precision: "departement" })).toBe("≈ dans votre département");
    expect(distanceLabel({ distance_km: 3, same_city: true, geo_precision: "homonyme" })).toBe("probablement dans votre ville");
    expect(distanceLabel({ distance_km: 3, same_city: true, geo_precision: "commune" })).toBe("dans votre ville");
    expect(distanceLabel({ distance_km: null, same_city: false, geo_precision: "pays" })).toBeNull();
  });
  it("département d'un code INSEE", () => {
    expect(depOfInsee("69123")).toBe("69");
    expect(depOfInsee("97411")).toBe("974");
    expect(depOfInsee("2A004")).toBe("2A");
  });
});
