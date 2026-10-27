import { normalizeQoderQuotaSnapshot } from "../auth/usage.js";

export function quotaUsage(raw: unknown) {
  const snapshot = normalizeQoderQuotaSnapshot(raw);
  if (!snapshot) throw new Error("Qoder returned no quota data");
  const until = snapshot.expiresAt === undefined ? undefined : new Date(snapshot.expiresAt).toISOString();
  const windows = (
    [
      ["Personal quota", snapshot.userQuota],
      ["Add-on credits", snapshot.addOnQuota],
      ["Organization resource package", snapshot.orgResourcePackage],
    ] as const
  ).flatMap(([name, bucket]) => {
    if (!bucket) return [];
    const amount =
      bucket.used ??
      (bucket.total !== undefined && bucket.remaining !== undefined && bucket.remaining <= bucket.total
        ? Math.max(0, bucket.total - bucket.remaining)
        : undefined);
    const used =
      bucket.total !== undefined && bucket.total > 0 && amount !== undefined
        ? Math.min(100, (amount / bucket.total) * 100)
        : undefined;
    const display = [
      bucket.remaining === undefined
        ? undefined
        : `${bucket.remaining}${bucket.unit ? ` ${bucket.unit}` : ""} remaining`,
      amount === undefined ? undefined : `${amount} used`,
      bucket.total === undefined ? undefined : `total ${bucket.total}`,
      until ? `Quota resets ${until}` : undefined,
    ]
      .filter(Boolean)
      .join("; ");
    return [
      {
        name,
        ...(until ? { resetsAt: until } : {}),
        ...(used === undefined ? {} : { used }),
        ...(amount === undefined ? {} : { amount }),
        ...(bucket.total === undefined ? {} : { limit: bucket.total }),
        ...(bucket.unit ? { unit: bucket.unit } : {}),
        display,
        aside: true,
      },
    ];
  });
  return { ...(until ? { until } : {}), windows };
}
