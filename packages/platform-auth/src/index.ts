import { hashPayload } from '@zerotrace/evidence';

export * from './oidc.js';

export type PlatformRole = 'investigator' | 'admin' | 'readonly';

export interface Principal {
  subject: string;
  roles: readonly PlatformRole[];
  tenantId: string;
  mfaSatisfied: boolean;
}

export type SensitiveAction =
  'entity.merge' | 'tactic.confirm' | 'case.publish' | 'legal.hold' | 'model.upgrade';

export function authorize(principal: Principal, action: string, tenantId: string): boolean {
  if (principal.tenantId !== tenantId) return false;
  if (action.startsWith('admin.') && !principal.roles.includes('admin')) return false;
  if (action === 'case.read') {
    return principal.roles.some((role) =>
      (['readonly', 'investigator', 'admin'] as const).includes(role),
    );
  }
  if (principal.roles.includes('readonly')) return false;
  return principal.roles.includes('investigator') || principal.roles.includes('admin');
}

export function requireFourEyes(
  action: SensitiveAction,
  actor: Principal,
  reviewer: Principal | undefined,
): void {
  if (reviewer === undefined || reviewer.subject === actor.subject) {
    throw new Error(`四眼复核：${action} 需要不同的第二人批准。`);
  }
  if (reviewer.tenantId !== actor.tenantId) {
    throw new Error('四眼复核不得跨租户。');
  }
  if (
    !actor.mfaSatisfied ||
    !reviewer.mfaSatisfied ||
    !actor.roles.some((role) => role === 'investigator' || role === 'admin') ||
    !reviewer.roles.some((role) => role === 'investigator' || role === 'admin')
  ) {
    throw new Error('四眼复核双方必须具备调查权限并完成 MFA。');
  }
}

export interface AuditEvent {
  actor: string;
  role: string;
  action: string;
  reason: string;
  previousHash: string;
  payload: unknown;
}

export function appendAudit(previousHash: string, event: Omit<AuditEvent, 'previousHash'>): string {
  return hashPayload({ ...event, previousHash });
}

export function productionAuthConfigured(env: {
  OIDC_ISSUER?: string;
  OIDC_AUDIENCE?: string;
  OIDC_JWKS_URI?: string;
  NODE_ENV?: string;
  LOCAL_DEV_AUTH?: string;
}): boolean {
  if (env.NODE_ENV === 'production') {
    return Boolean(env.OIDC_ISSUER && env.OIDC_AUDIENCE && env.OIDC_JWKS_URI);
  }
  return env.LOCAL_DEV_AUTH === '1' || Boolean(env.OIDC_ISSUER);
}

export function productionResourceAuthConfigured(env: {
  OIDC_ISSUER?: string;
  OIDC_AUDIENCE?: string;
  OIDC_JWKS_URI?: string;
  OIDC_TENANT_CLAIM?: string;
  OIDC_ROLES_CLAIM?: string;
  ZEROTRACE_TENANT_ID?: string;
  NODE_ENV?: string;
}): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return Boolean(
    env.OIDC_ISSUER &&
    env.OIDC_AUDIENCE &&
    env.OIDC_JWKS_URI &&
    env.OIDC_TENANT_CLAIM &&
    env.OIDC_ROLES_CLAIM &&
    env.ZEROTRACE_TENANT_ID,
  );
}
