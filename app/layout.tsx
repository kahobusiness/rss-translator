import type { Metadata } from 'next';
import './globals.css';
import { WebAnalytics } from './components/WebAnalytics';

export const metadata: Metadata = {
  title: 'RSS Translator',
  description: '精选英文技术博客的中文翻译 RSS 订阅源',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}<WebAnalytics /></body>
    </html>
  );
}
