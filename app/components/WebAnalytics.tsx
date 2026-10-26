'use client';

import { Analytics } from '@vercel/analytics/next';
import { publicAnalyticsEvent } from '@/lib/web-analytics';

export function WebAnalytics() {
  return <Analytics beforeSend={publicAnalyticsEvent} />;
}
