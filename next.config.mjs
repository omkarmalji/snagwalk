/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use standalone in Docker container builds
  output: process.env.NEXT_STANDALONE === 'false' ? undefined : 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
