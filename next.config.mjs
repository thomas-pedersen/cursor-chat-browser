/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), 'better-sqlite3'];
    }
    config.resolve = config.resolve || {};
    config.resolve.symlinks = false;
    return config;
  },
};

export default nextConfig;
