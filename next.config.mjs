/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use standalone in Docker container builds
  output: process.env.NEXT_STANDALONE === 'false' ? undefined : 'standalone',
  webpack(config) {
    // `import source from './file.html?raw'` (ThreeUI effect documents) resolves to the file's text.
    config.module.rules.push({ resourceQuery: /raw/, type: 'asset/source' });
    return config;
  },
};

export default nextConfig;
