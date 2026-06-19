import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'exclone — collaborative whiteboard',
  description: 'Real-time collaborative whiteboard (Next.js + Fabric.js)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
