import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { demoMode, demoCurrentUser } from '@/lib/demo-session';
import { allUsers } from '@/lib/demo-store';

export const dynamic = 'force-dynamic';

type Person = { id: string; full_name: string; email: string | null; helper_kind: string | null; magic_slug: string | null; photo_url: string | null; role: 'admin' | 'helper' };

export default async function Landing() {
  // Auto-redirect signed-in users to their role-appropriate landing.
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

  // Pull household members so we can render a "tap who you are" grid for helpers.
  // Uses service role since the visitor isn't signed in yet — RLS would block reads.
  let members: Person[] = [];
  if (demoMode()) {
    members = allUsers().map((u: any) => ({
      id: u.id, full_name: u.full_name, email: u.email, helper_kind: u.helper_kind,
      magic_slug: u.magic_slug ?? null, photo_url: u.photo_url ?? null, role: u.role,
    }));
  } else {
    const admin = supabaseAdmin();
    const { data: hh } = await admin.from('households').select('id').limit(1).single();
    if (hh) {
      const { data } = await admin
        .from('household_members')
        .select('role, helper_kind, profiles:user_id(id, full_name, email, magic_slug, photo_url)')
        .eq('household_id', hh.id);
      members = (data ?? []).map((m: any) => ({ ...m.profiles, helper_kind: m.helper_kind, role: m.role }));
    }
  }

  const helpers = members.filter((m) => m.role === 'helper').sort((a, b) => a.full_name.localeCompare(b.full_name));
  const admins = members.filter((m) => m.role === 'admin');

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-md px-5 sm:px-6 pt-10 sm:pt-14 pb-16">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-8">
          <svg viewBox="0 0 100 100" width="48" height="48" aria-hidden className="shrink-0">
            <path
              d="M50 90 C 4 62, 4 20, 28 20 C 40 20, 48 28, 50 36 C 52 28, 60 20, 72 20 C 96 20, 96 62, 50 90 Z"
              fill="#5C7A5F"
            />
            <text x="50" y="68" textAnchor="middle"
              style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic' }}
              fontSize="46" fontWeight="500" fill="#FBF6EC">R</text>
          </svg>
          <div className="leading-tight">
            <div className="font-display text-xl leading-none tracking-tight">Roditi</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-ink-700/55 font-semibold mt-1">Family Planner</div>
          </div>
        </div>

        {/* Hero */}
        <h1 className="font-display text-[34px] sm:text-[40px] leading-[1.05] tracking-tight">
          Who's picking up
          <br />
          <span className="text-[#6BA3C5]">Adam</span>, <span className="text-sage-500">Liam</span>, and <span className="text-coral-500">Yali</span>?
        </h1>

        {/* Helpers — tap to enter */}
        {helpers.length > 0 && (
          <section className="mt-8 sm:mt-10">
            <div className="label mb-3">Helpers — tap to open your pickups</div>
            <div className="grid grid-cols-2 gap-2.5">
              {helpers.map((h) => (
                <HelperCard key={h.id} h={h} />
              ))}
            </div>
          </section>
        )}

        {/* Admins — proper sign-in */}
        {admins.length > 0 && (
          <section className="mt-7">
            <div className="label mb-3">Parents — sign in</div>
            <div className="space-y-2">
              {admins.map((a) => (
                <Link
                  key={a.id}
                  href={a.email ? `/login?email=${encodeURIComponent(a.email)}` : '/login'}
                  className="card flex items-center gap-3 p-3.5 hover:border-sage-500/40 active:scale-[0.99] transition-all duration-150"
                >
                  <div className="h-10 w-10 rounded-full bg-sage-500/15 text-sage-700 grid place-items-center font-semibold">
                    {a.full_name.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{a.full_name}</div>
                    <div className="text-xs text-ink-700/55 truncate">{a.email ?? 'Sign in with email or Google'}</div>
                  </div>
                  <span className="text-ink-700/30">→</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="text-xs text-ink-700/45 mt-10 leading-relaxed">
          Helpers: tap once and you're in — no password.{' '}
          <span className="block sm:inline mt-1">On iPhone, tap Share → <b>Add to Home Screen</b> for a one-tap icon.</span>
        </p>
      </div>
    </main>
  );
}

function HelperCard({ h }: { h: Person }) {
  // Friendly slug if available, otherwise fall back to /login (shouldn't normally happen).
  // Use a plain <a> instead of <Link> so the click triggers a full
  // navigation. Next.js client-side routing was occasionally landing the
  // user on a stale session because cookies set by the slug route's
  // verifyOtp weren't being applied before the next-page render.
  const href = h.magic_slug ? `/${h.magic_slug}` : '/login';
  const first = (h.full_name ?? '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || h.full_name;
  // Photo: prefer the profile's photo_url; fall back to the conventional
  // /helpers/{slug}.jpg path; initials only if neither resolves at render.
  const photo = h.photo_url ?? (h.magic_slug ? `/helpers/${h.magic_slug}.jpg` : null);
  return (
    <a
      href={href}
      className="card flex flex-col items-center text-center p-4 hover:border-sage-500/40 hover:shadow-cardHover active:scale-[0.97] transition-all duration-150"
    >
      <div className="h-16 w-16 rounded-full overflow-hidden bg-sage-500/15 text-sage-700 grid place-items-center font-semibold text-2xl mb-2 ring-2 ring-cream-50 shadow-sm">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={first} className="w-full h-full object-cover" style={{ objectPosition: '50% 30%' }} />
        ) : (
          first.slice(0, 1)
        )}
      </div>
      <div className="font-medium text-base leading-tight">{first}</div>
      {h.full_name !== first && (
        <div className="text-[11px] text-ink-700/50 mt-0.5 leading-tight">{h.full_name.replace(first, '').trim().replace(/^[(\s]+|[)\s]+$/g, '')}</div>
      )}
      <div className="text-[10px] text-ink-700/40 uppercase tracking-wider mt-1.5">
        {h.helper_kind === 'nanny' ? 'nanny' : 'grandparent'}
      </div>
    </a>
  );
}
