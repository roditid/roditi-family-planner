/**
 * /admin/documents — family documents store.
 *
 * Admin-only. Lists every uploaded document with metadata + an "Open ↗"
 * button that fetches a short-lived signed URL and opens the file in
 * a new tab.
 */
import { requireAdmin } from '@/lib/permissions';
import { supabaseServer } from '@/lib/supabase/server';
import { format, differenceInDays } from 'date-fns';
import DocumentUploadForm from '@/components/DocumentUploadForm';
import DocumentDownloadButton from '@/components/DocumentDownloadButton';
import { deleteDocumentAction } from '@/app/_actions/documents';

export const dynamic = 'force-dynamic';

interface DocRow {
  id: string;
  label: string;
  kind: string | null;
  owner_kind: 'child' | 'adult' | 'household';
  owner_child_id: string | null;
  owner_profile_id: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  expires_on: string | null;
  notes: string | null;
  created_at: string;
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function DocumentsAdmin() {
  const ctx = await requireAdmin();
  const sb = supabaseServer();

  const [docsResult, kidsResult, adminsResult] = await Promise.all([
    sb.from('documents')
      .select('*')
      .eq('household_id', ctx.household!.id)
      .order('created_at', { ascending: false }),
    sb.from('children')
      .select('id, name')
      .eq('household_id', ctx.household!.id)
      .order('name'),
    sb.from('household_members')
      .select('profiles:user_id(id, full_name)')
      .eq('household_id', ctx.household!.id)
      .eq('role', 'admin'),
  ]);

  const docs: DocRow[] = (docsResult.data ?? []) as any;
  const kids = (kidsResult.data ?? []) as { id: string; name: string }[];
  const admins = ((adminsResult.data ?? []) as any[])
    .map((m) => m.profiles)
    .filter(Boolean);

  const kidById = new Map(kids.map((k) => [k.id, k.name]));
  const adminById = new Map(admins.map((a) => [a.id, a.full_name]));

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="font-display text-3xl">Documents</h1>
        <p className="text-ink-700/70 mt-1 text-sm">
          Passports, IDs, insurance, vaccination records — anything you'd
          want to find in 10 seconds at the airport or doctor's office.
          Admin-only; helpers don't see this tab.
        </p>
      </header>

      <section className="card p-5">
        <h2 className="font-display text-xl mb-4">Upload a new document</h2>
        <DocumentUploadForm kids={kids} admins={admins} />
      </section>

      <section>
        <h2 className="font-display text-xl mb-3">Saved documents</h2>
        {docs.length === 0 ? (
          <div className="card p-6 text-sm text-ink-700/60 text-center">
            Nothing here yet. Upload above and it'll show up.
          </div>
        ) : (
          <div className="card divide-y divide-black/5">
            {docs.map((d) => {
              const ownerName = d.owner_kind === 'child' && d.owner_child_id
                ? kidById.get(d.owner_child_id)
                : d.owner_kind === 'adult' && d.owner_profile_id
                  ? adminById.get(d.owner_profile_id)
                  : null;
              const ownerLabel = d.owner_kind === 'household'
                ? 'Household'
                : ownerName ?? '—';
              const expiry = d.expires_on ? new Date(d.expires_on + 'T00:00:00') : null;
              const daysUntilExpiry = expiry ? differenceInDays(expiry, new Date()) : null;
              const expiryWarning = daysUntilExpiry != null && daysUntilExpiry <= 30;
              const expiryStale = daysUntilExpiry != null && daysUntilExpiry < 0;
              return (
                <div key={d.id} className="p-4 flex items-start gap-3 flex-wrap sm:flex-nowrap">
                  <div className="text-2xl mt-0.5">{iconFor(d.kind)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{d.label}</span>
                      {d.kind && (
                        <span className="text-[10px] uppercase tracking-[0.1em] font-semibold bg-black/[0.05] text-ink-700/70 px-2 py-0.5 rounded">
                          {d.kind.replace(/_/g, ' ')}
                        </span>
                      )}
                      <span className="text-xs text-ink-700/60">· {ownerLabel}</span>
                    </div>
                    <div className="text-xs text-ink-700/55 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{fmtSize(d.file_size_bytes)}</span>
                      <span>·</span>
                      <span>Added {format(new Date(d.created_at), 'MMM d, yyyy')}</span>
                      {expiry && (
                        <>
                          <span>·</span>
                          <span className={expiryStale ? 'text-coral-600 font-semibold' : expiryWarning ? 'text-coral-600' : ''}>
                            {expiryStale
                              ? `Expired ${format(expiry, 'MMM d, yyyy')}`
                              : `Expires ${format(expiry, 'MMM d, yyyy')}`}
                          </span>
                        </>
                      )}
                    </div>
                    {d.notes && <div className="text-xs text-ink-700/55 italic mt-0.5">{d.notes}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <DocumentDownloadButton id={d.id} />
                    <form action={deleteDocumentAction} className="inline-flex">
                      <input type="hidden" name="id" value={d.id} />
                      <button
                        type="submit"
                        formNoValidate
                        className="text-xs text-ink-700/50 hover:text-coral-600 px-2 py-1"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-xs text-ink-700/45 leading-relaxed">
        Stored privately in Supabase Storage. Files aren't publicly
        accessible — every "Open" tap generates a fresh signed URL that
        expires after 5 minutes. Max 25 MB per file. PDFs and images
        render in the browser; other formats download.
      </p>
    </div>
  );
}

function iconFor(kind: string | null): string {
  switch (kind) {
    case 'passport':    return '🛂';
    case 'id':          return '🪪';
    case 'insurance':   return '🛡️';
    case 'vaccination': return '💉';
    case 'birth_cert':  return '📜';
    case 'medical':     return '🏥';
    case 'school':      return '🏫';
    default:            return '📄';
  }
}
