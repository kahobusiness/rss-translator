// VERCEL_URL identifies a deployment and may require Vercel Authentication.
// Subscription links must use a stable, public origin instead.
export function getSiteUrl(request?: { url: string }): string {
  const configured = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (configured) {
    const url = new URL(configured.includes('://') ? configured : `https://${configured}`);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid SITE_URL protocol');
    return url.origin;
  }
  return request ? new URL(request.url).origin : 'http://localhost:3000';
}
