import type {
  AuthorizationReconciliationResult,
  ReconcileAuthorizationVersionInput,
} from "../use-cases/reconcile-authorization-version.use-case.js";

export interface ProtectedRequestAuthorizationPort {
  execute(input: ReconcileAuthorizationVersionInput): Promise<AuthorizationReconciliationResult>;
}
