import { MembersPanel } from "../../../components/members-panel";

export default function MembershipSettingsPage() {
  return (
    <main className="min-h-screen bg-muted/40 px-4 py-12">
      <div className="mx-auto grid w-full max-w-6xl gap-6">
        <header className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Booking OS</p>
          <h1 className="text-3xl font-semibold tracking-tight">Members</h1>
          <p className="text-muted-foreground">
            Invite tenant administrators and manage membership lifecycle and owner roles.
          </p>
        </header>
        <MembersPanel />
      </div>
    </main>
  );
}
