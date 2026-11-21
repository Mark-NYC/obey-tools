-- Daily SOS scheduler. Runs every ten minutes, but dispatch remains disabled
-- until public.sos_email_runtime.enabled is deliberately set to true.
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule(
  'daily-sos-delivery-every-10-minutes',
  '*/10 * * * *',
  $job$
    select net.http_post(
      url := 'https://mjiswwujcsmayuytoaul.supabase.co/functions/v1/daily-sos-delivery',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sos-cron-secret', (select cron_secret from public.sos_email_runtime where singleton=true)
      ),
      timeout_milliseconds := 15000
    );
  $job$
);
