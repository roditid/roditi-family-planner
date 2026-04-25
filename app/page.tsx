import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode, demoCurrentUser } from '@/lib/demo-session';

export default async function Landing() {
  if (demoMode()) {
    if (demoCurrentUser()) redirect('/my-pickups');
  } else {
    const sb = supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (user) redirect('/my-pickups');
  }

  const signInHref = demoMode() ? '/demo-login' : '/login';

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl px-6 pt-20 pb-16">
        <div className="flex items-center gap-3 mb-16">
          <div className="h-10 w-10 rounded-xl bg-sage-500 grid place-items-center text-cream-50 font-display text-xl">P</div>
          <div>
            <div className="font-display text-xl leading-none">Pickup Planner</div>
            <div className="text-xs text-ink-700/60 mt-0.5">Family logistics, simplified</div>
          </div>
        </div>

        <h1 className="font-display text-5xl leading-[1.05] tracking-tight">
          Who's picking up <span className="text-[#6BA3C5]">Adam</span>, <span className="text-sage-500">Liam</span>, and <span className="text-coral-500">Yali</span> this week?
        </h1>
        <p className="mt-5 text-lg text-ink-700/80">
          See the kids' schedule. Claim the pickups you can do. Get a reminder the morning of — with the child, the time, and exactly where to go.
        </p>

        <div className="mt-10 space-y-3">
          <Link href={signInHref} className="btn-primary w-full text-lg py-4">
            {demoMode() ? 'Open the demo' : 'Sign in with Google'}
          </Link>
          {!demoMode() && (
            <Link href="/login?mode=email" className="btn-soft w-full text-base py-3">or use email</Link>
          )}
        </div>

        <div className="mt-14 space-y-4 text-sm text-ink-700/75">
          <Row>Grandparents: see the week and tap <b>Claim</b> on any pickup.</Row>
          <Row>Parents: overview of everyone's assignments, fill gaps, nudge.</Row>
          <Row>Every morning, whoever's on duty gets a note with the details.</Row>
        </div>

        {demoMode() && (
          <div className="mt-10 rounded-xl bg-sage-500/10 border border-sage-500/20 px-4 py-3 text-sm text-sage-700">
            <b>Demo mode is on.</b> In-memory seed data, no database. Pick any family member on the next screen.
          </div>
        )}
      </div>
    </main>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 h-1.5 w-1.5 rounded-full bg-sage-500" />
      <p>{children}</p>
    </div>
  );
}
