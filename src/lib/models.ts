import { Schema, model } from './docdb';

const ObjectId = Schema.Types.ObjectId;
const ts = { timestamps: true };

/* ---------------- Application users (login ke platform IGA) ---------------- */
export const AppUser = model(
  'AppUser',
  new Schema(
    {
      email: { type: String, unique: true, lowercase: true, trim: true, required: true },
      name: String,
      passwordHash: String,
      role: { type: String, enum: ['admin', 'reviewer', 'auditor'], default: 'reviewer' },
      authSource: { type: String, default: 'local' },
      active: { type: Boolean, default: true },
      preferences: {
        theme: { type: String, default: 'okta' },
        font: { type: String, default: 'public-sans' },
        design: { type: String, default: 'classic' },
      },
      lastLoginAt: Date,
    },
    ts,
  ),
);

/* ---------------- Identities (users dari Okta) ---------------- */
const IdentitySchema = new Schema(
  {
    oktaId: { type: String, index: true, sparse: true },
    login: { type: String, index: true },
    email: { type: String, lowercase: true, index: true },
    firstName: String,
    lastName: String,
    displayName: String,
    department: { type: String, index: true },
    title: String,
    location: String,
    employeeType: String,
    managerRef: String, // nilai mentah profile.managerId / profile.manager dari Okta
    managerId: { type: ObjectId, ref: 'Identity', index: true },
    status: { type: String, default: 'ACTIVE', index: true },
    identityType: { type: String, enum: ['human', 'service', 'bot', 'api'], default: 'human', index: true },
    lifecycle: { type: String, enum: ['joiner', 'active', 'mover', 'leaver', 'inactive'], default: 'active', index: true },
    previousDepartment: String,
    departmentChangedAt: Date,
    lastLogin: Date,
    sourceCreatedAt: Date,
    statusChangedAt: Date,
    riskScore: { type: Number, default: 0, index: true },
    riskLevel: { type: String, default: 'low', index: true },
    source: { type: String, default: 'okta' },
    lastSyncedAt: Date,
  },
  ts,
);
IdentitySchema.index({ displayName: 'text', login: 'text', email: 'text' });
export const Identity = model('Identity', IdentitySchema);

/* ---------------- Applications ---------------- */
export const Application = model(
  'Application',
  new Schema(
    {
      oktaId: { type: String, index: true, sparse: true },
      name: String,
      label: String,
      status: { type: String, default: 'ACTIVE' },
      signOnMode: String,
      owner: { type: String, lowercase: true },
      riskLevel: { type: String, default: 'medium' },
      description: String,
      source: { type: String, default: 'okta' },
    },
    ts,
  ),
);

/* ---------------- Entitlements (Okta group, app assignment, admin role) ---------------- */
export const Entitlement = model(
  'Entitlement',
  new Schema(
    {
      oktaId: { type: String, index: true, sparse: true },
      kind: { type: String, enum: ['group', 'app', 'admin_role'], default: 'group' },
      name: { type: String, index: true },
      description: String,
      applicationId: { type: ObjectId, ref: 'Application', index: true },
      riskLevel: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
      privileged: { type: Boolean, default: false },
      owner: { type: String, lowercase: true },
      source: { type: String, default: 'okta' },
    },
    ts,
  ),
);

/* ---------------- Assignments (identity <-> entitlement + usage data) ---------------- */
const AssignmentSchema = new Schema(
  {
    identityId: { type: ObjectId, ref: 'Identity', index: true },
    entitlementId: { type: ObjectId, ref: 'Entitlement', index: true },
    grantedAt: Date,
    lastUsedAt: Date,
    source: { type: String, default: 'okta' },
    syncToken: String,
  },
  ts,
);
AssignmentSchema.index({ identityId: 1, entitlementId: 1 }, { unique: true });
export const Assignment = model('Assignment', AssignmentSchema);

/* ---------------- Roles (role mining) ---------------- */
export const Role = model(
  'Role',
  new Schema(
    {
      name: String,
      description: String,
      status: { type: String, enum: ['candidate', 'active', 'deprecated'], default: 'candidate' },
      source: { type: String, enum: ['mined', 'manual'], default: 'mined' },
      method: String,
      criteria: Schema.Types.Mixed,
      entitlementIds: [{ type: ObjectId, ref: 'Entitlement' }],
      memberIds: [{ type: ObjectId, ref: 'Identity' }],
      confidence: Number,
      coverage: Number,
      unusedEntitlementIds: [{ type: ObjectId, ref: 'Entitlement' }],
    },
    ts,
  ),
);

/* ---------------- Separation of Duties ---------------- */
const SideSchema = new Schema(
  { label: String, entitlementIds: [{ type: ObjectId, ref: 'Entitlement' }], patterns: [String] },
  { _id: false },
);
export const SodPolicy = model(
  'SodPolicy',
  new Schema(
    {
      name: String,
      description: String,
      category: String,
      isPredefined: { type: Boolean, default: false },
      templateKey: String,
      severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'high' },
      enabled: { type: Boolean, default: true },
      sideA: SideSchema,
      sideB: SideSchema,
      mitigation: String,
      owner: String,
      createdBy: String,
    },
    ts,
  ),
);

const ViolationSchema = new Schema(
  {
    policyId: { type: ObjectId, ref: 'SodPolicy', index: true },
    identityId: { type: ObjectId, ref: 'Identity', index: true },
    matchedA: [{ type: ObjectId, ref: 'Entitlement' }],
    matchedB: [{ type: ObjectId, ref: 'Entitlement' }],
    severity: { type: String, index: true },
    status: { type: String, enum: ['open', 'mitigated', 'accepted', 'remediated'], default: 'open', index: true },
    detectedAt: Date,
    resolvedAt: Date,
    note: String,
    resolvedBy: String,
  },
  ts,
);
ViolationSchema.index({ policyId: 1, identityId: 1 }, { unique: true });
export const SodViolation = model('SodViolation', ViolationSchema);

/* ---------------- Daily snapshots (trend) ---------------- */
export const Snapshot = model(
  'Snapshot',
  new Schema(
    {
      day: { type: String, unique: true }, // YYYY-MM-DD
      at: Date,
      sodOpen: Number,
      sodBySeverity: { low: Number, medium: Number, high: Number, critical: Number },
      sodNew: Number,
      sodResolved: Number,
      avgRisk: Number,
      highRisk: Number,
      identities: Number,
      nonHuman: Number,
      certCompletion: Number,
    },
    ts,
  ),
);

/* ---------------- Certification campaigns ---------------- */
export const Campaign = model(
  'Campaign',
  new Schema(
    {
      name: { type: String, required: true },
      description: String,
      scopeType: {
        type: String,
        enum: ['all', 'department', 'application', 'entitlement', 'role', 'risk', 'mover', 'leaver', 'inactive', 'privileged', 'non_human'],
        default: 'all',
      },
      scope: {
        departments: [String],
        applicationIds: [{ type: ObjectId, ref: 'Application' }],
        entitlementIds: [{ type: ObjectId, ref: 'Entitlement' }],
        roleIds: [{ type: ObjectId, ref: 'Role' }],
        riskLevels: [String],
        riskTarget: { type: String, default: 'identity' },
        inactiveDays: { type: Number, default: 90 },
      },
      reviewerHierarchy: { type: [String], default: ['manager', 'manager_of_manager', 'fallback'] },
      specificReviewer: { type: String, lowercase: true },
      fallbackReviewer: { type: String, lowercase: true },
      escalation: {
        enabled: { type: Boolean, default: true },
        afterDays: { type: Number, default: 7 },
        maxLevel: { type: Number, default: 2 },
      },
      allowReassign: { type: Boolean, default: true },
      autoRemediate: { type: Boolean, default: false },
      durationDays: { type: Number, default: 14 },
      recurrence: { type: String, enum: ['none', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual'], default: 'none' },
      startAt: Date,
      nextRunAt: Date,
      lastRunAt: Date,
      isTemplate: { type: Boolean, default: false },
      parentId: { type: ObjectId, ref: 'Campaign' },
      status: { type: String, enum: ['draft', 'scheduled', 'active', 'completed', 'cancelled'], default: 'draft', index: true },
      launchedAt: Date,
      dueDate: Date,
      completedAt: Date,
      lastReminderAt: Date,
      owner: { type: String, lowercase: true },
      stats: { total: Number, approved: Number, revoked: Number, pending: Number, reassigned: Number, overdue: Number },
      createdBy: String,
    },
    ts,
  ),
);

export const CertItem = model(
  'CertItem',
  new Schema(
    {
      campaignId: { type: ObjectId, ref: 'Campaign', index: true },
      identityId: { type: ObjectId, ref: 'Identity', index: true },
      entitlementId: { type: ObjectId, ref: 'Entitlement' },
      applicationId: { type: ObjectId, ref: 'Application' },
      reviewer: { type: String, lowercase: true, index: true },
      reviewerLevel: Number,
      reviewerLevelName: String,
      assignedAt: Date,
      decision: { type: String, enum: ['pending', 'approved', 'revoked'], default: 'pending', index: true },
      comment: String,
      decidedAt: Date,
      decidedBy: String,
      reassignHistory: [{ from: String, to: String, by: String, reason: String, at: Date, _id: false }],
      dueDate: Date,
      riskLevel: String,
      sodFlag: Boolean,
      lastUsedAt: Date,
      remediation: { status: { type: String, default: 'none' }, message: String, at: Date },
    },
    ts,
  ),
);

/* ---------------- Reports ---------------- */
export const ReportDef = model(
  'ReportDef',
  new Schema(
    {
      name: String,
      description: String,
      dataset: String,
      columns: [String],
      filters: [{ field: String, op: String, value: Schema.Types.Mixed, _id: false }],
      sortBy: String,
      sortDir: { type: String, default: 'asc' },
      limit: Number,
      chart: { type: { type: String, default: 'none' }, groupBy: String },
      isSystem: { type: Boolean, default: false },
      systemKey: String,
      createdBy: String,
    },
    ts,
  ),
);

export const ReportSchedule = model(
  'ReportSchedule',
  new Schema(
    {
      name: String,
      reportId: { type: ObjectId, ref: 'ReportDef' },
      frequency: { type: String, enum: ['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'custom'], default: 'weekly' },
      cron: String,
      time: { type: String, default: '08:00' },
      dayOfWeek: { type: Number, default: 1 },
      dayOfMonth: { type: Number, default: 1 },
      formats: { type: [String], default: ['pdf'] },
      recipients: [String],
      slack: { type: Boolean, default: false },
      slackTarget: { type: String, default: 'default' }, // default | business_owner
      enabled: { type: Boolean, default: true },
      lastRunAt: Date,
      nextRunAt: Date,
      lastStatus: String,
      createdBy: String,
    },
    ts,
  ),
);

export const ReportRun = model(
  'ReportRun',
  new Schema(
    {
      reportId: { type: ObjectId, ref: 'ReportDef' },
      scheduleId: { type: ObjectId, ref: 'ReportSchedule' },
      reportName: String,
      ranAt: Date,
      rows: Number,
      formats: [String],
      status: String,
      error: String,
      deliveredTo: [String],
      slack: Boolean,
      trigger: String,
    },
    ts,
  ),
);

/* ---------------- Workflow notification rules ---------------- */
export const WorkflowRule = model(
  'WorkflowRule',
  new Schema(
    {
      key: { type: String, unique: true },
      name: String,
      event: String,
      enabled: { type: Boolean, default: true },
      channels: { email: { type: Boolean, default: true }, slack: { type: Boolean, default: false } },
      slackTarget: { type: String, default: 'default' },
      recipientRoles: [String], // reviewers | owner | admins | business_owners
      recipients: [String],
      subject: String,
      body: String,
    },
    ts,
  ),
);

export const NotificationLog = model(
  'NotificationLog',
  new Schema(
    {
      channel: String,
      event: String,
      to: String,
      subject: String,
      status: String,
      error: String,
      at: { type: Date, default: Date.now, index: true },
    },
    ts,
  ),
);

/* ---------------- Dashboard customization ---------------- */
export const DashboardLayout = model(
  'DashboardLayout',
  new Schema(
    {
      userEmail: { type: String, index: true },
      dashboardKey: String,
      widgets: [{ key: String, visible: Boolean, size: Number, title: String, _id: false }],
    },
    ts,
  ),
);

/* ---------------- Okta System Log (semua event, disimpan permanen) ---------------- */
const OktaActorSchema = new Schema({ id: String, type: String, alternateId: String, displayName: String }, { _id: false });

const OktaEventSchema = new Schema(
    {
      uuid: { type: String, unique: true },
      published: { type: Date, index: true },
      eventType: { type: String, index: true },
      category: { type: String, index: true },
      displayMessage: String,
      severity: String,
      outcome: String,
      outcomeReason: String,
      actor: OktaActorSchema,
      targets: [OktaActorSchema],
      userIds: { type: [String], index: true }, // Okta user id yang terlibat (actor + target user)
      ipAddress: String,
      location: String,
      raw: String, // event asli (JSON) — string agar key Okta yang mengandung '.'/'$' aman disimpan
    },
    ts,
);
// lookup per user/app (detail akses aplikasi) — tanpa index ini query memindai seluruh koleksi
OktaEventSchema.index({ 'targets.id': 1, published: -1 });
OktaEventSchema.index({ 'actor.id': 1, published: -1 });
export const OktaEvent = model('OktaEvent', OktaEventSchema);

/* ---------------- Settings & audit ---------------- */
export const Setting = model('Setting', new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed }, ts));

export const AuditLog = model(
  'AuditLog',
  new Schema(
    {
      actor: String,
      action: { type: String, index: true },
      target: String,
      details: Schema.Types.Mixed,
      at: { type: Date, default: Date.now, index: true },
    },
    ts,
  ),
);
