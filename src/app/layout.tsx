import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ReplayTrader — Manual Backtesting',
  description:
    'High-performance bar replay and manual backtesting tool. Upload CSV data, replay candle-by-candle, and test trading strategies in past markets.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
