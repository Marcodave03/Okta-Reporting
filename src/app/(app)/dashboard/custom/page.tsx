'use client';
import { DashboardView } from '@/components/dashboard';
import { useUser } from '@/components/UserContext';

export default function CustomDashboard() {
  return <DashboardView dashKey="custom" role={useUser().role} />;
}
