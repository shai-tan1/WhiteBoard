/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // avoids double-mount re-connecting the socket twice in dev
  transpilePackages: ['fabric'],
};

module.exports = nextConfig;
