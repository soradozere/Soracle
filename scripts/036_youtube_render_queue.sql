-- 036_youtube_render_queue.sql
--
-- Demos queued for rendering to mp4 and publishing to the community YouTube
-- channel.
--
-- One row per request, from the moment an uploader asks for it through to a
-- published video id. Nothing here is self-serve: every row stops at
-- pending_review until an admin approves it, and the status column is the only
-- thing that says where a job actually is.
--
-- The row also has to outlive the job. A render runs in GitHub Actions, which
-- can fail in ways nothing here observes -- so github_run_id exists to trace a
-- stuck row back to the run that abandoned it, and error exists so a failure
-- says why rather than leaving a row spinning.
--
-- Idempotent.

begin;

create table if not exists public.youtube_render_queue (
  id            uuid primary key default gen_random_uuid(),
  demo_id       uuid not null references public.demos(id) on delete cascade,

  /*
   * Who asked for this.
   *
   * Null when an admin did it, which is not the same as unknown -- Soracle has
   * two unrelated logins, and requireAdmin() confirms admin status without
   * revealing which user, with nothing mapping a Supabase auth user to a
   * players row. So an admin-made request genuinely cannot name a player, and
   * requested_source says so explicitly rather than leaving a bare null to be
   * misread as lost data. Mirrors demos.source, which solved the same problem.
   */
  requested_by     uuid references public.players(id) on delete set null,
  requested_source text not null default 'player' check (requested_source in ('player', 'admin')),

  -- What YouTube will show. Kept here rather than read from the demo at publish
  -- time so that editing a demo's title later cannot silently rewrite the title
  -- of a video that is already live.
  title       text not null check (char_length(trim(title)) >= 3),
  description text,

  -- Who the clip is about. Defaults to the demo's protagonist in the UI, but
  -- stored separately: a demo can yield several clips about different players.
  protagonist_player_id uuid references public.players(id) on delete set null,

  -- Locked for the whole clip -- no mid-render camera changes in v1.
  cam_mode text not null default 'follow' check (cam_mode in ('follow', 'chase', 'free')),

  /*
   * POV target, as an engine client number.
   *
   * NOT an index into the demo's player list, and not contiguous from zero:
   * the four players in the demo used to prove this pipeline sat at client
   * slots 4, 5, 6 and 7. Following an unoccupied slot renders a silent
   * fallback rather than an error, so this must carry the real client number
   * the demo reports, never a guessed or re-based one.
   *
   * Null for cam_mode 'free', which follows nobody.
   */
  follow_client_id integer check (follow_client_id >= 0 and follow_client_id < 32),

  -- The segment to render, in milliseconds from the demo's first frame.
  -- Deliberately uncapped: clips run from ~30s highlights to full ~2h matches.
  start_ms integer not null check (start_ms >= 0),
  end_ms   integer not null check (end_ms > start_ms),

  fps integer not null default 60 check (fps in (30, 60)),

  /*
   * pending_render -> rendering -> pending_review -> publishing -> published
   *                        |             |
   *                        v             v
   *                     failed        rejected
   *
   * A dispatch that fails to reach GitHub goes straight to failed: a row left
   * at pending_render with nothing coming is indistinguishable from one that is
   * merely queued, and that is exactly the state nobody notices.
   */
  status text not null default 'pending_render' check (status in (
    'pending_render', 'rendering', 'pending_review',
    'rejected', 'publishing', 'published', 'failed'
  )),
  error text,

  -- Temp mp4 under the renders/ prefix, nulled once published or rejected.
  -- R2 is staging here, not storage -- YouTube is where the video lives, and
  -- a 24h lifecycle rule on the prefix backstops any key this column loses.
  render_r2_key text,

  youtube_video_id text,

  -- bigint, not integer: Actions run ids are already past the 2.1bn int4
  -- ceiling (31043669297 was observed while building this).
  github_run_id bigint,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists youtube_render_queue_status_idx
  on public.youtube_render_queue(status, created_at desc);

create index if not exists youtube_render_queue_demo_idx
  on public.youtube_render_queue(demo_id, created_at desc);

-- Counting today's published rows against the daily cap is the one read that
-- happens on every approval.
create index if not exists youtube_render_queue_published_idx
  on public.youtube_render_queue(status, updated_at desc)
  where status = 'published';

/*
 * One in-flight render per demo, enforced here rather than only in the action.
 *
 * The app checks for an existing pending row before inserting, but two clicks
 * a few milliseconds apart both pass that check and both insert -- and the
 * second one dispatches a duplicate Actions run that burns a render and races
 * the first to the callback. A partial unique index makes the second insert
 * fail instead. Terminal states are excluded, so a demo can be rendered again
 * after one is published, rejected or has failed.
 */
create unique index if not exists youtube_render_queue_one_active_per_demo
  on public.youtube_render_queue(demo_id)
  where status in ('pending_render', 'rendering', 'pending_review', 'publishing');

-- Reuses the function created in 001.
drop trigger if exists update_youtube_render_queue_updated_at on public.youtube_render_queue;
create trigger update_youtube_render_queue_updated_at
  before update on public.youtube_render_queue
  for each row
  execute function public.update_updated_at_column();

/*
 * Admin-only reading, and no public select at all -- a queue row names a
 * player, carries an unreviewed title, and points at an mp4 nobody has
 * approved yet.
 *
 * Note what this policy deliberately does not attempt. The brief asked to
 * scope reads to the requesting player as well, but player logins are a signed
 * cookie the app verifies, not a Postgres identity -- there is no auth.uid()
 * for them, so no RLS predicate can express "this player's own rows". That
 * check lives in the server action, exactly as it does for demo edits. Writes
 * are service-role only, which bypasses RLS by design.
 */
alter table public.youtube_render_queue enable row level security;

drop policy if exists "youtube_render_queue_select_admin" on public.youtube_render_queue;
create policy "youtube_render_queue_select_admin" on public.youtube_render_queue
  for select to authenticated using (public.is_admin());

commit;
