-- Permite que qualquer usuário autenticado veja perfis de professores
CREATE POLICY "Anyone can view professors"
  ON professors FOR SELECT
  USING (auth.role() = 'authenticated');
