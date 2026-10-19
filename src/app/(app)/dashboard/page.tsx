'use client';
import { DashboardView } from '@/components/dashboard';
import { useUser } from '@/components/UserContext';

export default function ExecutiveDashboard() {
  return <DashboardView dashKey="executive" role={useUser().role} />;
}
