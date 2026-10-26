'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLayoutEffect } from 'react';
import type { ComponentProps } from 'react';
import styles from '../page.module.css';

const POSITION_KEY = 'rss-list-position';
const RESTORE_KEY = 'rss-list-restore';

export function ArticleLink({ feedId, ...props }: ComponentProps<typeof Link> & { feedId: string }) {
  return <Link {...props} onNavigate={() => {
    try {
      const card = document.getElementById(`feed-${feedId}`);
      sessionStorage.setItem(POSITION_KEY, JSON.stringify({ feedId,
        offset: card ? window.scrollY - (card.getBoundingClientRect().top + window.scrollY) : 0 }));
    } catch { /* Navigation still works when browser storage is unavailable. */ }
  }} />;
}

export function ReturnToFeeds({ feedId }: { feedId: string }) {
  const router = useRouter();
  return <Link href={`/#feed-${feedId}`} className={styles.backLink} onNavigate={event => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(POSITION_KEY) || 'null');
      if (!saved || typeof saved.feedId !== 'string' || !Number.isFinite(saved.offset)) return;
      sessionStorage.setItem(RESTORE_KEY, '1');
      event.preventDefault();
      router.push('/', { scroll: false });
    } catch { /* Direct visits fall back to the corresponding feed anchor. */ }
  }}>← 返回全部订阅源</Link>;
}

export function RestoreFeedPosition() {
  useLayoutEffect(() => {
    let saved: { feedId: string; offset: number };
    try {
      if (sessionStorage.getItem(RESTORE_KEY) !== '1') return;
      sessionStorage.removeItem(RESTORE_KEY);
      saved = JSON.parse(sessionStorage.getItem(POSITION_KEY) || 'null');
      if (!saved || typeof saved.feedId !== 'string' || !Number.isFinite(saved.offset)) return;
    } catch { return; }
    // Cards above the saved position stream in independently. Reapply the
    // relative offset as their heights settle, stopping on any user input.
    let stopped = false;
    const restore = () => {
      if (stopped) return;
      const card = document.getElementById(`feed-${saved.feedId}`);
      if (card) window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY + saved.offset, behavior: 'instant' });
    };
    const observer = new ResizeObserver(restore);
    const stop = () => { stopped = true; observer.disconnect(); };
    observer.observe(document.body);
    restore();
    const timer = window.setTimeout(stop, 30_000);
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    events.forEach(event => window.addEventListener(event, stop, { passive: true, once: true }));
    return () => {
      stop();
      clearTimeout(timer);
      events.forEach(event => window.removeEventListener(event, stop));
    };
  }, []);
  return null;
}
