/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: [
      'pg',
      'nodemailer',
      'exceljs',
      'jspdf',
      'jspdf-autotable',
      'bcryptjs',
      'cron-parser',
    ],
  },
};

export default nextConfig;
