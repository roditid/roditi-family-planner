// Shared database row types. Kept hand-written for readability;
// regenerate via `supabase gen types typescript` later if preferred.

export type UserRole = 'admin' | 'helper';
export type HelperKind = 'grandparent' | 'nanny' | 'other';
export type SlotStatus = 'unclaimed' | 'claimed' | 'completed' | 'canceled';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone_number: string | null;
  home_address: string | null;
  home_lat: number | null;
  home_lng: number | null;
  role: UserRole;
  helper_kind: HelperKind | null;
  color: string | null;
  /** Path to the helper's portrait, e.g. `/helpers/vovo.jpg`. */
  photo_url: string | null;
  email_enabled: boolean;
  sms_enabled: boolean;
}

export interface Household {
  id: string;
  name: string;
  timezone: string;
  locale: string;
}

export interface Location {
  id: string;
  household_id: string;
  label: string;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  is_common: boolean;
}

export interface Child {
  id: string;
  household_id: string;
  name: string;
  color: string;
  school_name: string | null;
  school_location_id: string | null;
  home_location_id: string | null;
  /** When this kid is dismissed from their Gan, used for default Gan→Home pickups. */
  gan_dismissal_time: string | null;
  photo_url: string | null;
  notes: string | null;
}

export interface Activity {
  id: string;
  child_id: string;
  title: string;
  default_pickup_location_id: string | null;
  default_destination_location_id: string | null;
  weekday: number | null;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  event_keyword: string | null;
  /** Recurring "what to bring" reminder. Sent the night before via cron. */
  pack_list: string | null;
}

export interface PickupSlot {
  id: string;
  household_id: string;
  child_id: string;
  activity_id: string | null;
  source_event_id: string | null;
  source: 'calendar' | 'manual';
  title: string;
  date: string;          // yyyy-mm-dd
  pickup_time: string;   // HH:mm:ss — when helper picks the kid up
  /** Actual activity start (e.g. Soccer 17:00). Distinct from pickup_time. */
  activity_start_time: string | null;
  end_time: string | null;
  pickup_location_id: string | null;
  via_location_id: string | null;
  destination_location_id: string | null;
  pickup_location_text: string | null;
  via_location_text: string | null;
  destination_text: string | null;
  /** Other kids in this trip after the primary child_id, in pickup-order. */
  additional_child_ids: string[];
  notes: string | null;
  parent_notes: string | null;
  /** Per-event one-off pack reminder ("fancy clothes for Pesach"). */
  pack_notes: string | null;
  status: SlotStatus;
  reminder_sent_at: string | null;
  claim_cutoff_at: string | null;
}

export interface SlotAssignment {
  id: string;
  pickup_slot_id: string;
  assigned_to_user_id: string;
  assigned_by_user_id: string | null;
  assigned_at: string;
  released_at: string | null;
  status: 'active' | 'released' | 'overridden';
}

// Hydrated slot — what the UI actually consumes.
export interface SlotView extends PickupSlot {
  child: Child;
  /** Combined-trip siblings (in pickup-order). Empty when this is a solo trip. */
  additional_children: Child[];
  activity: Activity | null;
  pickup_location: Location | null;
  via_location: Location | null;
  destination_location: Location | null;
  assignment: (SlotAssignment & { profile: Profile | null }) | null;
}
