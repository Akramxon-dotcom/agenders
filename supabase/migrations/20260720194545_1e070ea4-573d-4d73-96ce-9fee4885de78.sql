
-- Anonymous auth-based multi-device workspace
CREATE TABLE public.spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.space_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  device_name TEXT,
  user_agent TEXT,
  is_master BOOLEAN NOT NULL DEFAULT false,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, user_id)
);

CREATE TABLE public.qr_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | revoked | expired
  space_id UUID REFERENCES public.spaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '2 minutes')
);

CREATE INDEX idx_space_members_space ON public.space_members(space_id);
CREATE INDEX idx_space_members_user ON public.space_members(user_id);
CREATE INDEX idx_qr_sessions_requester ON public.qr_sessions(requester_user_id);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.space_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_sessions TO authenticated;
GRANT ALL ON public.spaces TO service_role;
GRANT ALL ON public.space_members TO service_role;
GRANT ALL ON public.qr_sessions TO service_role;

-- RLS
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_sessions ENABLE ROW LEVEL SECURITY;

-- Helper: is user a non-revoked member of the space?
CREATE OR REPLACE FUNCTION public.is_space_member(_space_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.space_members
    WHERE space_id = _space_id AND user_id = _user_id AND revoked = false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_space_master(_space_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.space_members
    WHERE space_id = _space_id AND user_id = _user_id AND is_master = true AND revoked = false
  );
$$;

-- spaces policies
CREATE POLICY "members can read space"
  ON public.spaces FOR SELECT TO authenticated
  USING (public.is_space_member(id, auth.uid()));

CREATE POLICY "members can update space data"
  ON public.spaces FOR UPDATE TO authenticated
  USING (public.is_space_member(id, auth.uid()))
  WITH CHECK (public.is_space_member(id, auth.uid()));

CREATE POLICY "user creates own space"
  ON public.spaces FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "owner deletes own space"
  ON public.spaces FOR DELETE TO authenticated
  USING (auth.uid() = owner_id);

-- space_members policies
CREATE POLICY "members read their space members"
  ON public.space_members FOR SELECT TO authenticated
  USING (public.is_space_member(space_id, auth.uid()));

CREATE POLICY "self insert as member (own row only)"
  ON public.space_members FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "self update own row"
  ON public.space_members FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "master can update any member of space"
  ON public.space_members FOR UPDATE TO authenticated
  USING (public.is_space_master(space_id, auth.uid()))
  WITH CHECK (public.is_space_master(space_id, auth.uid()));

CREATE POLICY "master can delete member of space"
  ON public.space_members FOR DELETE TO authenticated
  USING (public.is_space_master(space_id, auth.uid()));

-- qr_sessions: requester sees own; master (of any space) can read pending
CREATE POLICY "requester reads own qr"
  ON public.qr_sessions FOR SELECT TO authenticated
  USING (auth.uid() = requester_user_id);

CREATE POLICY "authenticated can read pending qr by id"
  ON public.qr_sessions FOR SELECT TO authenticated
  USING (status = 'pending' AND expires_at > now());

CREATE POLICY "requester inserts own qr"
  ON public.qr_sessions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = requester_user_id);

CREATE POLICY "master approves qr (writes space_id)"
  ON public.qr_sessions FOR UPDATE TO authenticated
  USING (status = 'pending' AND expires_at > now())
  WITH CHECK (space_id IS NOT NULL AND public.is_space_master(space_id, auth.uid()));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_spaces_touch BEFORE UPDATE ON public.spaces
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.spaces;
ALTER PUBLICATION supabase_realtime ADD TABLE public.space_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.qr_sessions;
