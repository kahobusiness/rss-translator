/** @type {import('next').NextConfig} */
const nextConfig = {
  // 允许更长的serverless函数执行时间
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
}

module.exports = nextConfig
