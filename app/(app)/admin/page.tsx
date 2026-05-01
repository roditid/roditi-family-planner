/**
 * /admin previously rendered the week's schedule + unassigned warning,
 * but admins manage assignments from /home now. The Overview is gone;
 * /admin is just a redirect into the first settings tab. The settings
 * tabs (Invites, Calendar, Children, Locations, Helpers, Reminders) live
 * under /admin/* and are still surfaced by the AdminLayout sub-nav.
 */
import { redirect } from 'next/navigation';

export default function AdminIndex() {
  redirect('/admin/calendar');
}
