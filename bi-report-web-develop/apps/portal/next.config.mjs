/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['powerbi-client-react', 'three'],
  experimental: {
    serverComponentsExternalPackages: ['pg'],
    optimizePackageImports: ['lucide-react', 'framer-motion', 'echarts'],
  },
  webpack: (config, { dev, isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    }
    // OneDrive corrupts the on-disk webpack cache and Next then crashes with
    // "Cannot read properties of undefined (reading 'clientModules')".
    if (dev) {
      config.cache = { type: "memory" };
    }
    config.module.rules.push({
      test: /\.glb$/,
      type: "asset/resource",
    });
    return config;
  },
};

export default nextConfig;
