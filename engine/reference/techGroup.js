// Technology / Non Technology split used by the house index groups (owner / Alok Sir, 2026-11-26).
// US: the owner's workbook places every stock by sub-industry, and its Information Technology sector is the technology set
// (semiconductors, software, hardware, communications equipment, IT services, electronic components / equipment, EMS,
// cloud / AI compute, internet infrastructure). India and Global have no sub-industry: they use the GICS Information
// Technology sector (industry groups Software and Services, Technology Hardware and Equipment, Semiconductors and
// Semiconductor Equipment). Change the definition here only; everything else reads techGroup().
export const TECH = "Technology";
export const NON_TECH = "Non Technology";
export const TECH_GROUPS = [TECH, NON_TECH];
export const TECH_SECTORS = new Set(["Information Technology"]);

export function techGroup(sec) {
  return TECH_SECTORS.has(sec?.sector) ? TECH : NON_TECH;
}
