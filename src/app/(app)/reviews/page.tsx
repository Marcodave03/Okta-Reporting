'use client';
import { useState } from 'react';
import { Card, PageHeader } from '@/components/ui';
import { ReviewTable } from '@/components/ReviewTable';
import { useUser } from '@/components/UserContext';

export default function MyReviewsPage() {
  const user = useUser();
  const [scope, setScope] = useState<'me' | 'all'>('me');
  return (
    <>
      <PageHeader
        title="My Reviews"
        subtitle={`Access review yang ditugaskan kepada ${user.email}. Approve, revoke, atau reassign ke reviewer lain.`}
        actions={
          user.role !== 'reviewer' && (
            <select className="select" value={scope} onChange={(e) => setScope(e.target.value as any)} style={{ width: 'auto' }}>
              <option value="me">Ditugaskan ke saya</option>
              <option value="all">Semua reviewer (admin view)</option>
            </select>
          )
        }
      />
      <Card flush>
        <ReviewTable key={scope} reviewer={scope === 'me' ? 'me' : undefined} showCampaign showReviewer={scope === 'all'} readOnly={user.role === 'auditor'} />
      </Card>
    </>
  );
}
