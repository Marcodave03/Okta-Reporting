'use client';
import { DashboardView } from '@/components/dashboard';
import { useUser } from '@/components/UserContext';

export default function SodDashboard() {
  return <DashboardView dashKey="sod" role={useUser().role} />;
}
