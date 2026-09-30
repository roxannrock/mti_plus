// Section progress colour relative to the test's own pass mark (not a fixed 70%).
export function sectionBarClass(pct: number, passPercent: number): string {
  if (pct >= passPercent) return "bg-emerald-500";
  if (pct >= passPercent * 0.6) return "bg-amber-500";
  return "bg-red-500";
}
