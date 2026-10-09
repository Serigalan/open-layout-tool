/** The first of the reasons a form cannot be committed that holds, or null (R10.4). */
export const firstReason = (...reasons) => reasons.find(Boolean) ?? null
