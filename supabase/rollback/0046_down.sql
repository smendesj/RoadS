-- Rollback of 0046_controls_subscriptions.sql.
-- Drops the ControlS vault table (and its RLS policies with it) and the membership helper function.
-- The ciphertext in `secret_password` is destroyed with the table — there is no plain-text password anywhere
-- to leak, and the encryption key lived only in CONTROLS_VAULT_KEY, never in the database.

drop table if exists public.subscriptions;
drop function if exists public.is_controls_member();
