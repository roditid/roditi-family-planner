import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pickup Planner — Roditi Family',
  description: 'Weekly pickup planning for grandparents and helpers.',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
  themeColor: '#FBF6EC',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
