'use server';
/**
 * Family documents — upload, delete, signed-URL fetch.
 *
 * Storage layout: bucket "family-documents", keys
 *   <household_id>/<doc_id>/<sanitized_filename>
 *
 * Uploaded payloads never become public URLs. Downloads always go
 * through a signed URL with a short expiry (5 min) generated on demand.
 */
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logNotification } from '@/lib/notify-log';

const BUCKET = 'family-documents';
const SIGNED_URL_EXPIRY_SECONDS = 5 * 60;

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s.-]/g, '_').replace(/\s+/g, '_').slice(0, 100);
}

export async function uploadDocumentAction(formData: FormData) {
  const ctx = await requireAdmin();
  const file = formData.get('file') as File | null;
  const label = String(formData.get('label') ?? '').trim();
  const kind = String(formData.get('kind') ?? '').trim() || null;
  const ownerKind = String(formData.get('owner_kind') ?? 'household');
  const ownerChildId = String(formData.get('owner_child_id') ?? '').trim() || null;
  const ownerProfileId = String(formData.get('owner_profile_id') ?? '').trim() || null;
  const expiresOn = String(formData.get('expires_on') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (!file || file.size === 0) {
    return { ok: false, error: 'Choose a file to upload.' };
  }
  if (!label) {
    return { ok: false, error: 'Give the document a label.' };
  }
  // 25 MB ceiling — passport photos rarely exceed 5 MB; this is a sanity
  // guard against a 100MB scan blowing past the Supabase storage quota.
  const MAX_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 25 MB.` };
  }

  const sb = supabaseAdmin();
  const docId = crypto.randomUUID();
  const cleanName = sanitizeFilename(file.name);
  const storagePath = `${ctx.household!.id}/${docId}/${cleanName}`;

  // Push the bytes to Storage
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, buf, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (upErr) {
    return { ok: false, error: `Upload failed: ${upErr.message}` };
  }

  // Insert metadata
  const { error: dbErr } = await sb.from('documents').insert({
    id: docId,
    household_id: ctx.household!.id,
    uploaded_by: ctx.user.id,
    owner_kind: ownerKind,
    owner_child_id: ownerKind === 'child' ? ownerChildId : null,
    owner_profile_id: ownerKind === 'adult' ? ownerProfileId : null,
    label,
    kind,
    storage_path: storagePath,
    file_size_bytes: file.size,
    mime_type: file.type || null,
    expires_on: expiresOn,
    notes,
  });
  if (dbErr) {
    // Roll back the storage object — leaving an orphan file would
    // be hard to clean up later.
    await sb.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, error: `Saving record failed: ${dbErr.message}` };
  }

  // Log to the activity feed so there's an audit trail of doc uploads.
  await logNotification(sb, {
    household_id: ctx.household!.id,
    kind: 'document_uploaded',
    channel: 'email',
    recipient: '-',
    subject: `Document uploaded: ${label}`,
    actor_user_id: ctx.user.id,
  });

  revalidatePath('/admin/documents');
  return { ok: true };
}

export async function deleteDocumentAction(formData: FormData) {
  const ctx = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const sb = supabaseAdmin();
  const { data: doc } = await sb
    .from('documents')
    .select('storage_path, label')
    .eq('id', id)
    .eq('household_id', ctx.household!.id)
    .maybeSingle();
  if (!doc) return;

  await sb.storage.from(BUCKET).remove([doc.storage_path]);
  await sb.from('documents').delete().eq('id', id).eq('household_id', ctx.household!.id);

  await logNotification(sb, {
    household_id: ctx.household!.id,
    kind: 'document_deleted',
    channel: 'email',
    recipient: '-',
    subject: `Document deleted: ${doc.label}`,
    actor_user_id: ctx.user.id,
  });

  revalidatePath('/admin/documents');
}

/**
 * Generate a short-lived signed URL for downloading. Called from a
 * client-side button that opens it in a new tab.
 */
export async function getDocumentSignedUrl(id: string): Promise<{ url: string | null; error?: string }> {
  const ctx = await requireAdmin();
  const sb = supabaseAdmin();
  const { data: doc } = await sb
    .from('documents')
    .select('storage_path')
    .eq('id', id)
    .eq('household_id', ctx.household!.id)
    .maybeSingle();
  if (!doc) return { url: null, error: 'not found' };

  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data?.signedUrl) return { url: null, error: error?.message ?? 'sign failed' };
  return { url: data.signedUrl };
}
