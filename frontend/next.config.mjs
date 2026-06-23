/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  webpack: (config, { dev, isServer }) => {
    if (dev && isServer) {
      // Suppress source-map warnings for vendor chunks in dev
      config.devtool = false;
    }
    return config;
  },
};

export default nextConfig;
