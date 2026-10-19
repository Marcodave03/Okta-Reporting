# 06 · API Reference

Semua endpoint di bawah `/api`, format JSON, autentikasi via cookie sesi `iga_session` (didapat dari `POST /api/auth/login`). Error: `{ "error": "pesan" }` dengan status 400/401/403/404/409/500.
Kolom **Role**: `any` = semua user login, `admin`, `admin/auditor`.

## Auth & profil

| Method | Path | Role | Keterangan |
|---|---|---|---|
| POST | `/auth/login` | publik | `{email, password}` → set cookie |
| POST | `/auth/logout` | publik | hapus cookie |
| GET | `/auth/providers` | publik | `{okta: bool}` — SSO tersedia? |
| GET | `/auth/okta/login` · `/auth/okta/callback` | publik | OIDC authorization code flow |
| GET | `/me` | any | user, preferensi, jumlah review pending |
| PUT | `/me/preferences` | any | `{theme, font, design}` |
| GET | `/health` | publik | status DB |

## Dashboard

| GET | `/metrics` | any | seluruh metrik executive + certification + SoD (`kpiMap`, series chart) |
|---|---|---|---|
| GET/PUT/DELETE | `/dashboards/layout?key=` | any | layout widget per user (`{key, widgets:[{key,visible,size,title}]}`) |

## Directory

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/identities?q&type&status&lifecycle&riskLevel&department&dormant&page&limit&sort&dir` | any | `type`: human, non_human, service, bot, api |
| GET | `/identities/:id` | any | detail + managerChain, access, violations, certifications |
| GET | `/hierarchy` | any | node organisasi + pending reviews |
| GET | `/applications` · PATCH `/applications/:id` | any · admin | owner, riskLevel, description |
| GET | `/entitlements?applicationId&q&riskLevel&privileged` · PATCH `/entitlements/:id` | any · admin | owner, riskLevel, privileged |

## Certification

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/campaigns?status` | any | daftar + `scopeTypes`, `reviewerLevels` |
| POST | `/campaigns` | admin | body campaign + `launchMode: now/schedule/draft` |
| POST | `/campaigns/preview` | admin | jumlah item & distribusi reviewer |
| GET/PATCH/DELETE | `/campaigns/:id` | any/admin | detail, reviewer progress, instances |
| POST | `/campaigns/:id/action` | admin | `{action: launch \| remind \| refresh \| cancel \| complete}` |
| GET | `/certifications/items?campaignId&reviewer=me&decision&q&sod&activeOnly&page&limit` | any | reviewer non-admin otomatis dibatasi ke itemnya |
| POST | `/certifications/decide` | reviewer/admin | `{itemIds[], decision: approved\|revoked\|pending, comment}` (comment wajib utk revoke) |
| POST | `/certifications/reassign` | reviewer/admin | `{itemIds[], to, reason}` |
| POST | `/certifications/remediate` | admin | `{campaignId?, itemIds?}` retry remediasi |

Contoh body campaign:

```json
{
  "name": "Q4 Finance Review",
  "scopeType": "department",
  "scope": { "departments": ["Finance"] },
  "reviewerHierarchy": ["manager", "manager_of_manager", "fallback"],
  "escalation": { "enabled": true, "afterDays": 7, "maxLevel": 2 },
  "allowReassign": true,
  "autoRemediate": false,
  "durationDays": 14,
  "launchMode": "schedule",
  "startAt": "2026-11-01T01:00:00.000Z",
  "recurrence": "quarterly"
}
```

## SoD

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET/POST | `/sod/policies` | any/admin | POST = custom policy `{name, severity, sideA:{label, patterns[], entitlementIds[]}, sideB:{…}}` |
| PATCH/DELETE | `/sod/policies/:id` | admin | predefined hanya `enabled`, `severity`, `owner` |
| GET/POST | `/sod/templates` | any/admin | library predefined; POST `{key, mode: predefined\|custom}` |
| POST | `/sod/preview` | any | entitlement yang cocok dengan sisi A/B |
| POST | `/sod/scan` | admin | jalankan SoD engine |
| GET | `/sod/violations?status&severity&policyId&q` | any | |
| PATCH | `/sod/violations/:id` | admin | `{status: open\|mitigated\|accepted\|remediated, note}` |

## Roles

| GET/POST | `/roles` | any/admin | POST = role manual `{name, entitlementIds[]}` |
|---|---|---|---|
| PATCH/DELETE | `/roles/:id` | admin | `{status}`, `{removeEntitlementId}` |
| POST | `/roles/mine` | admin | `{method, groupBy[], minSupport, minMembers, similarity, useUsage, unusedDays}` |
| GET | `/roles/optimize?unusedDays` | any | rekomendasi + summary |

## Reports, schedules, workflows

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET | `/reports/datasets` | any | dataset, kolom, operator filter, format |
| GET/POST | `/reports` · PATCH/DELETE `/reports/:id` | any (non-auditor utk tulis) | |
| POST | `/reports/run` | any | `{reportId}` atau `{def}` → preview |
| POST | `/reports/export` | any | `{reportId \| def, format: csv\|xlsx\|pdf\|json\|html}` → file |
| GET/POST | `/schedules` · PATCH/DELETE `/schedules/:id` | any/admin | `{reportId, frequency, time, dayOfWeek, dayOfMonth, cron, formats[], recipients[], slack, slackTarget}` |
| POST | `/schedules/:id/run` | admin | eksekusi sekarang |
| GET | `/schedules/runs` | any | riwayat |
| GET | `/workflows` · PATCH `/workflows/:id` · POST `/workflows/:id` (test) | any/admin | |
| GET | `/notifications` | any | log email/Slack |
| GET | `/audit?q&page` | admin/auditor | |

## Admin & integrasi

| Method | Path | Role | Keterangan |
|---|---|---|---|
| GET/PUT | `/settings/integrations` | admin | secret dikembalikan ter-mask |
| POST | `/integrations/test` | admin | `{channel: okta\|smtp\|slack\|slack_bo}` |
| GET/POST | `/okta/sync` | admin | status / mulai sync (background) |
| POST | `/slack/digest` | admin | executive summary → Slack Business Owner (+ email BO) |
| GET/POST · PATCH/DELETE | `/users` · `/users/:id` | admin | user platform |
| POST | `/setup/seed` · `/setup/reset` · `/setup/recompute` | admin | data demo / reset / recompute |
