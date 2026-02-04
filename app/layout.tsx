import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'RSS Translator',
  description: '将RSS订阅源翻译成中文',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
