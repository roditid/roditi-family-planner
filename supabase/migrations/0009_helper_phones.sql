-- Migration 0009 — populate helper phone numbers
--
-- These are the Israeli WhatsApp numbers Paula provided for the grandparents,
-- the nanny, and herself. Used by:
--   • the "Send to my WhatsApp" share button on the claim modal (deep-links
--     into the helper's own WhatsApp chat with the trip summary)
--   • Saturday-evening claim reminder cron (grandparents only)
--   • Sunday-morning admin summary cron (Paula)
--
-- Format: digits-and-plus only — strip everything else before storing.

update profiles set phone_number = '+972524456049' where full_name = 'Nonna (Eliane)';
update profiles set phone_number = '+972548857171' where full_name = 'Vovo (Levanah)';
update profiles set phone_number = '+972544301506' where full_name = 'Paula Roditi';
update profiles set phone_number = '+972548867171' where full_name = 'Tataia (Liviu)';
update profiles set phone_number = '+972533531143' where full_name = 'Liezel';
