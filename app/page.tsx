import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { demoMode, demoCurrentUser } from '@/lib/demo-session';

export default async function Landing() {
  // Redirect signed-in users to their role-appropriate landing.
  if (demoMode()) {
    if (demoCurrentUser()) redirect('/my-pickups');
  } else {
    const sb = supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const { data: m } = await sb.from('household_members').select('role').eq('user_id', user.id).maybeSingle();
      redirect(m?.role === 'admin' ? '/admin' : '/my-pickups');
    }
  }

  const signInHref = demoMode() ? '/demo-login' : '/login';

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-xl px-5 sm:px-6 pt-12 sm:pt-20 pb-16">
        <div className="flex items-center gap-3 mb-12 sm:mb-16">
          <div className="h-10 w-10 rounded-xl bg-sage-500 grid place-items-center text-cream-50 font-display text-xl">P</div>
          <div>
            <div className="font-display text-xl leading-none">Pickup Planner</div>
            <div className="text-xs text-ink-700/60 mt-0.5">Family logistics, simplified</div>
          </div>
        </div>

        <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] tracking-tight">
          Who's picking up <span className="text-[#6BA3C5]">Adam</span>, <span className="text-sage-500">Liam</span>, and <span className="text-coral-500">Yali</span> this week?
        </h1>
        <p className="mt-5 text-base sm:text-lg text-ink-700/80 leading-relaxed">
          See the family's week. Claim the pickups you can do. Get a reminder the morning of — with the child, the time, and exactly where to go.
        </p>

        <div className="mt-9 sm:mt-10">
          <Link href={signInHref} className="btn-primary w-full text-lg py-4">
            {demoMode() ? 'Open the demo' : 'Sign in'}
          </Link>
        </div>

        <div className="mt-12 sm:mt-14 space-y-3 text-sm text-ink-700/75 leading-relaxed">
          <Row>Grandparents tap their personal link → see the week → tap <b>Claim</b>.</Row>
          <Row>Parents see the dashboard with everyone's assignments + warnings.</Row>
          <Row>Every morning, whoever's on duty gets an email with the details.</Row>
        </div>

        {demoMode() && (
          <div className="mt-10 rounded-xl bg-sage-500/10 border border-sage-500/20 px-4 py-3 text-sm text-sage-700">
            <b>Demo mode.</b> Pick any family member on the next screen — in-memory data, no signup.
          </div>
        )}
      </div>
    </main>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-sage-500 shrink-0" />
      <p>{children}</p>
    </div>
  );
}
