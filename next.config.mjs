/** @type {import('next').NextConfig} */
const nextConfig = {
  // src/instrumentation.ts: the one-time data migrations and the contact
  // finder's hourly timer, once per server start (Node.js runtime only).
  experimental: { instrumentationHook: true },
};

export default nextConfig;
