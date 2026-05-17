'use client';
/**
 * Document upload form. Client component so we can show
 * "Uploading…" feedback and per-attempt error messages.
 */
import { useState, useTransition } from 'react';
import { uploadDocumentAction } from '@/app/_actions/documents';

interface KidOption { id: string; name: string }
interface AdminOption { id: string; full_name: string }

interface Props {
  kids: KidOption[];
  admins: AdminOption[];
}

const KIND_OPTIONS = [
  { value: 'passport',     label: 'Passport' },
  { value: 'id',           label: 'ID / Teudat Zehut' },
  { value: 'insurance',    label: 'Insurance' },
  { value: 'vaccination',  label: 'Vaccination record' },
  { value: 'birth_cert',   label: 'Birth certificate' },
  { value: 'medical',      label: 'Medical / allergy info' },
  { value: 'school',       label: 'School / Gan' },
  { value: 'other',        label: 'Other' },
];

export default function DocumentUploadForm({ kids, admins }: Props) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<null | { ok: boolean; error?: string }>(null);
  const [ownerKind, setOwnerKind] = useState<'child' | 'adult' | 'household'>('child');

  function onSubmit(formData: FormData) {
    setResult(null);
    start(async () => {
      const r = await uploadDocumentAction(formData);
      setResult(r);
      if (r.ok) {
        // Reset form on success
        const form = document.getElementById('upload-form') as HTMLFormElement | null;
        form?.reset();
        setOwnerKind('child');
      }
    });
  }

  return (
    <form id="upload-form" action={onSubmit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Label" required>
          <input
            name="label"
            required
            placeholder="e.g. Liam — Israeli passport"
            className="input"
          />
        </Field>
        <Field label="Type">
          <select name="kind" defaultValue="passport" className="input">
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Whose document?">
        <div className="flex gap-2 flex-wrap text-sm">
          <OwnerRadio name="owner_kind" value="child"     current={ownerKind} setCurrent={setOwnerKind}>For a kid</OwnerRadio>
          <OwnerRadio name="owner_kind" value="adult"     current={ownerKind} setCurrent={setOwnerKind}>For an adult</OwnerRadio>
          <OwnerRadio name="owner_kind" value="household" current={ownerKind} setCurrent={setOwnerKind}>Whole household</OwnerRadio>
        </div>
      </Field>

      {ownerKind === 'child' && (
        <Field label="Which kid">
          <select name="owner_child_id" required={ownerKind === 'child'} className="input">
            <option value="">Pick one…</option>
            {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </Field>
      )}
      {ownerKind === 'adult' && (
        <Field label="Which adult">
          <select name="owner_profile_id" required={ownerKind === 'adult'} className="input">
            <option value="">Pick one…</option>
            {admins.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        </Field>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Expires on" hint="Optional — for passports, IDs">
          <input type="date" name="expires_on" className="input" />
        </Field>
        <Field label="Notes" hint="Optional">
          <input name="notes" placeholder="e.g. front + back" className="input" />
        </Field>
      </div>

      <Field label="File" required hint="PDF, JPG, or PNG. Max 25 MB.">
        <input
          name="file"
          type="file"
          required
          accept="image/*,application/pdf"
          className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-sage-500 file:text-cream-50 file:cursor-pointer hover:file:bg-sage-600"
        />
      </Field>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? 'Uploading…' : 'Upload'}
        </button>
        {result && result.ok && <span className="text-sm text-sage-700">✓ Saved</span>}
        {result && !result.ok && <span className="text-sm text-coral-600">⚠︎ {result.error}</span>}
      </div>
    </form>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">
        {label}{required && <span className="text-coral-500"> *</span>}
      </span>
      {children}
      {hint && <span className="text-[11px] text-ink-700/50 mt-1 block">{hint}</span>}
    </label>
  );
}

function OwnerRadio({
  name, value, current, setCurrent, children,
}: {
  name: string; value: 'child' | 'adult' | 'household';
  current: string; setCurrent: (v: any) => void;
  children: React.ReactNode;
}) {
  const isActive = current === value;
  return (
    <label className={`cursor-pointer rounded-xl px-3 py-2 border transition ${isActive ? 'bg-sage-500 text-cream-50 border-sage-600' : 'bg-cream-50 border-black/10 hover:border-sage-500/40'}`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={isActive}
        onChange={() => setCurrent(value)}
        className="sr-only"
      />
      {children}
    </label>
  );
}
