import { route } from '@/lib/api';
import { WorkflowRule } from '@/lib/models';
import { WORKFLOW_EVENTS } from '@/lib/notify';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({ items: await WorkflowRule.find({}).sort({ event: 1, name: 1 }).lean(), events: WORKFLOW_EVENTS }));
