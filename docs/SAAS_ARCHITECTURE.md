# SaaS Multi-tenant Architecture

## Option A - Shared database + school_id (implemented)
- One database instance.
- Every business table includes `school_id`.
- Every query filters with `WHERE school_id = ?`.

### Advantages
- Lower infrastructure cost.
- Simpler deployments/backups.
- Easier aggregate analytics for superadmin.

### Drawbacks
- Strong discipline required in code review to avoid missing tenant filters.
- Noisy-neighbor risk under very high load.

## Option B - Database per school
- One database file or schema per tenant.

### Advantages
- Physical isolation and easier tenant export.
- Better compliance for strict segregation.

### Drawbacks
- High operational complexity.
- Harder global reporting and migrations.

## Decision
Option A is the best fit for current stack and project size. The codebase now enforces tenant context through middleware + model-level SQL filters.

## Security controls
- Session stores `role`, `school_id`, `subscription_plan`.
- Middleware injects `req.school_id`.
- Tenant routes require auth + tenant context.
- Superadmin routes are role-guarded.
- Finance module is guarded by subscription feature.

## Migration checklist
1. Add `schools`, `users`, `subscription_plans`, `saas_subscriptions`.
2. Add `school_id` to existing business tables.
3. Enforce `school_id` in all SQL queries.
4. Protect every tenant route with `requireAuth` + `requireTenant`.
5. Keep role-based guards for superadmin APIs.
