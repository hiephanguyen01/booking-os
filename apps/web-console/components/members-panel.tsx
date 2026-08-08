"use client";

import { Alert } from "@booking-os/ui/alert";
import { Button } from "@booking-os/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@booking-os/ui/card";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InviteMemberForm } from "./invite-member-form";
import { readProblemMessage } from "./problem-message";

type RoleKey = "tenant_owner" | "tenant_admin";
type MembershipStatus = "invited" | "active" | "suspended" | "revoked";

interface MembershipRecord {
  readonly id: string;
  readonly userId: string;
  readonly status: MembershipStatus;
  readonly authorizationVersion: number;
  readonly roleKeys: RoleKey[];
}

interface CurrentSessionResponse {
  readonly actor?: { readonly id?: unknown };
  readonly session?: {
    readonly state?: unknown;
    readonly scope?: {
      readonly type?: unknown;
      readonly tenantId?: unknown;
    };
  };
}

type MemberAction = "suspend" | "revoke" | "promote-owner" | "demote-owner";

function roleLabel(roleKeys: RoleKey[]): string {
  if (roleKeys.includes("tenant_owner")) return "Owner";
  if (roleKeys.includes("tenant_admin")) return "Administrator";
  return "Unassigned";
}

export function MembersPanel() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [members, setMembers] = useState<MembershipRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sessionResponse = await fetch("/api/auth/me", { cache: "no-store" });
      if (!sessionResponse.ok) {
        setError(await readProblemMessage(sessionResponse));
        return;
      }
      const session = (await sessionResponse.json()) as CurrentSessionResponse;
      const nextActorId = session.actor?.id;
      const scope = session.session?.scope;
      if (
        session.session?.state !== "active" ||
        scope?.type !== "tenant" ||
        typeof scope.tenantId !== "string" ||
        typeof nextActorId !== "string"
      ) {
        setError("TENANT_CONTEXT_REQUIRED: An active tenant session is required.");
        return;
      }

      const membershipResponse = await fetch(
        `/api/tenants/${encodeURIComponent(scope.tenantId)}/members`,
        { cache: "no-store" },
      );
      if (!membershipResponse.ok) {
        setError(await readProblemMessage(membershipResponse));
        return;
      }

      setTenantId(scope.tenantId);
      setActorId(nextActorId);
      setMembers((await membershipResponse.json()) as MembershipRecord[]);
    } catch {
      setError("NETWORK_ERROR: Booking OS could not load tenant memberships.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentMembership = useMemo(
    () => members.find((membership) => membership.userId === actorId) ?? null,
    [actorId, members],
  );
  const canManageOwners = currentMembership?.roleKeys.includes("tenant_owner") ?? false;

  async function mutateMember(membershipId: string, action: MemberAction) {
    if (!tenantId) return;
    setMutatingId(`${membershipId}:${action}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(membershipId)}/${action}`,
        { method: "POST", cache: "no-store" },
      );
      if (!response.ok) {
        setError(await readProblemMessage(response));
        return;
      }
      await load();
    } catch {
      setError("NETWORK_ERROR: Booking OS could not update this membership.");
    } finally {
      setMutatingId(null);
    }
  }

  return (
    <div className="grid gap-6">
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Tenant members</CardTitle>
          <CardDescription>
            Membership state and authorization version are read from the tenant-scoped API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Loading memberships…</p> : null}
          {!loading && members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No memberships are available.</p>
          ) : null}
          {members.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-2 py-3 font-medium">User</th>
                    <th className="px-2 py-3 font-medium">Role</th>
                    <th className="px-2 py-3 font-medium">Status</th>
                    <th className="px-2 py-3 font-medium">Auth version</th>
                    <th className="px-2 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((membership) => {
                    const isSelf = membership.userId === actorId;
                    const isOwner = membership.roleKeys.includes("tenant_owner");
                    const isAdmin = membership.roleKeys.includes("tenant_admin");
                    return (
                      <tr key={membership.id} className="border-b last:border-0">
                        <td className="px-2 py-3 font-mono text-xs">
                          {membership.userId}
                          {isSelf ? " (you)" : ""}
                        </td>
                        <td className="px-2 py-3">{roleLabel(membership.roleKeys)}</td>
                        <td className="px-2 py-3 capitalize">{membership.status}</td>
                        <td className="px-2 py-3">{membership.authorizationVersion}</td>
                        <td className="px-2 py-3">
                          <div className="flex flex-wrap gap-2">
                            {!isSelf && membership.status === "active" && isAdmin ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={mutatingId !== null}
                                  onClick={() => void mutateMember(membership.id, "suspend")}
                                >
                                  {mutatingId === `${membership.id}:suspend`
                                    ? "Suspending…"
                                    : "Suspend"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  disabled={mutatingId !== null}
                                  onClick={() => void mutateMember(membership.id, "revoke")}
                                >
                                  {mutatingId === `${membership.id}:revoke`
                                    ? "Revoking…"
                                    : "Revoke"}
                                </Button>
                                {canManageOwners ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={mutatingId !== null}
                                    onClick={() =>
                                      void mutateMember(membership.id, "promote-owner")
                                    }
                                  >
                                    {mutatingId === `${membership.id}:promote-owner`
                                      ? "Promoting…"
                                      : "Promote owner"}
                                  </Button>
                                ) : null}
                              </>
                            ) : null}
                            {!isSelf &&
                            membership.status === "active" &&
                            isOwner &&
                            canManageOwners ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={mutatingId !== null}
                                onClick={() => void mutateMember(membership.id, "demote-owner")}
                              >
                                {mutatingId === `${membership.id}:demote-owner`
                                  ? "Demoting…"
                                  : "Demote owner"}
                              </Button>
                            ) : null}
                            {!isSelf && membership.status === "suspended" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={mutatingId !== null}
                                onClick={() => void mutateMember(membership.id, "revoke")}
                              >
                                {mutatingId === `${membership.id}:revoke` ? "Revoking…" : "Revoke"}
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {tenantId ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite administrator</CardTitle>
            <CardDescription>
              Invitations default to tenant_admin and expire after seven days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteMemberForm tenantId={tenantId} onInvited={() => void load()} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
