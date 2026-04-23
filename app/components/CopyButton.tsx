'use client';

import { useState } from 'react';
import styles from './CopyButton.module.css';

export function CopyButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const url =
      typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={styles.button}
      aria-label={copied ? '已复制' : '复制订阅地址'}
      data-copied={copied || undefined}
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}
