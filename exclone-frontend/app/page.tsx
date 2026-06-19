'use client';

import dynamic from 'next/dynamic';

// Fabric.js touches window/document, so render the board only on the client.
const Whiteboard = dynamic(() => import('@/components/Whiteboard'), {
  ssr: false,
});

export default function Page() {
  return <Whiteboard />;
}
