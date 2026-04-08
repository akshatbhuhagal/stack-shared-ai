/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    domains: ["images.unsplash.com", "cdn.example.com"],
  },
  experimental: {
    serverActions: true,
    typedRoutes: true,
  },
};

export default nextConfig;
