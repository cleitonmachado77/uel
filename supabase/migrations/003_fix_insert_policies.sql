-- Políticas de INSERT para professores e alunos
-- Necessárias para o signup funcionar

create policy "Users can insert own professor profile"
  on professors for insert with check (auth.uid() = id);

create policy "Users can insert own student profile"
  on students for insert with check (auth.uid() = id);
