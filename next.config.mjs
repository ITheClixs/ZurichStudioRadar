/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "flatfox.ch" },
      { protocol: "https", hostname: "www.flatfox.ch" }
    ]
  }
};

export default nextConfig;
