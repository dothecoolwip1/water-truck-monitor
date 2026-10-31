-- Sign-ins issued before a password change stop working.
alter table users add column if not exists password_changed_at timestamptz;

-- Only one push of an invoice to QuickBooks runs at a time.
alter table invoices add column if not exists qbo_claimed_at timestamptz;
