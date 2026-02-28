import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Use webpack for builds (Turbopack has production build issues in Next.js 16)
  // Dev server still uses Turbopack by default
};

export default nextConfig;
