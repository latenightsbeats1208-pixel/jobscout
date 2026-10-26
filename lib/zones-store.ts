import "server-only";
import { getSetting, setSetting, parseJson } from "@/lib/db";
import { ZONES, isZoneId, type Zone, type ZoneId } from "@/lib/zones";

const SETTING_KEY = "search_zones";

/** Zones choisies (vide = aucune restriction géographique). */
export function getSearchZoneIds(): ZoneId[] {
  return parseJson<unknown[]>(getSetting(SETTING_KEY), []).filter(isZoneId);
}

export function getSearchZones(): Zone[] {
  return getSearchZoneIds().map((id) => ZONES[id]);
}

export function setSearchZoneIds(ids: unknown[]): ZoneId[] {
  const clean = [...new Set(ids.filter(isZoneId))];
  setSetting(SETTING_KEY, JSON.stringify(clean));
  return clean;
}
