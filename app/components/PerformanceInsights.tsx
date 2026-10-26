'use client';

import { SpeedInsights } from '@vercel/speed-insights/next';
import { publicPerformanceEvent } from '@/lib/speed-insights';

export function PerformanceInsights() {
  return <SpeedInsights beforeSend={publicPerformanceEvent} />;
}
