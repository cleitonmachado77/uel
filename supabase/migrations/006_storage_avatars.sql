-- Cria bucket para avatares
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);

-- Política: qualquer autenticado pode fazer upload do próprio avatar
CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Política: avatares são públicos pra leitura
CREATE POLICY "Avatars are public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
