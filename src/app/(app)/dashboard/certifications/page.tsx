'use client';
import { DashboardView } from '@/components/dashboard';
import { useUser } from '@/components/UserContext';

export default function CertificationDashboard() {
  return <DashboardView dashKey="certification" role={useUser().role} />;
}
