'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, useApi } from '@/lib/client';
import { Button, Loading, PageHeader, toast, toastError } from '@/components/ui';
import { CampaignForm, DEFAULT_CAMPAIGN } from '@/components/CampaignForm';

export default function NewCampaignPage() {
  const router = useRouter();
  const meta = useApi<any>('/api/campaigns');
  const [v, setV] = useState<any>(DEFAULT_CAMPAIGN);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const body = { ...v, startAt: v.startAt ? new Date(v.startAt).toISOString() : undefined, recurrence: v.launchMode === 'schedule' ? v.recurrence : 'none' };
      const c = await api('/api/campaigns', { body });
      toast(v.launchMode === 'now' ? `Campaign diluncurkan — ${c.stats?.total ?? 0} item, reviewer dinotifikasi` : v.launchMode === 'schedule' ? 'Campaign dijadwalkan' : 'Draft disimpan', 'success');
      router.push(`/campaigns/${c._id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  if (meta.loading) return <Loading />;
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Campaigns', href: '/campaigns' }, { label: 'New' }]}
        title="New certification campaign"
        actions={<><Button onClick={() => router.back()}>Batal</Button><Button variant="primary" loading={saving} onClick={submit} disabled={!v.name}>{v.launchMode === 'now' ? 'Launch campaign' : v.launchMode === 'schedule' ? 'Jadwalkan' : 'Simpan draft'}</Button></>}
      />
      <CampaignForm value={v} onChange={setV} levels={meta.data?.reviewerLevels || {}} />
    </>
  );
}
