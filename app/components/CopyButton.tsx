'use client';

import { useState } from 'react';
import { track } from '@vercel/analytics';
import { subscriptionCopyProperties } from '@/lib/web-analytics';
import styles from './CopyButton.module.css';

export function CopyButton({ path, label = '复制订阅地址' }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const url =
      typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      const properties = subscriptionCopyProperties(path);
      // Only a successful clipboard write signals subscription intent.
      // Analytics failure must not affect clipboard feedback.
      try { if (properties) track('rss_subscription_copy', properties); } catch { /* best effort */ }
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={styles.button}
      aria-label={copied ? '已复制' : label}
      data-copied={copied || undefined}
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}
