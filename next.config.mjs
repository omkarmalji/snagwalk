/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use standalone in Docker container builds
  output: process.env.NEXT_STANDALONE === 'false' ? undefined : 'standalone',
};

export default nextConfig;
