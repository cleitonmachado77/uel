-- UEL Connect - Schema inicial
-- Execute este SQL no SQL Editor do Supabase

-- Habilita extensão UUID
create extension if not exists "uuid-ossp";

-- Tabela de professores
create table professors (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  department text,
  default_language text not null default 'pt',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Tabela de alunos
create table students (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  nationality text,
  preferred_language text not null default 'en',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Tabela de sessões (transmissões)
create table sessions (
  id uuid primary key default uuid_generate_v4(),
  professor_id uuid not null references professors(id) on delete cascade,
  subject text not null,
  language text not null default 'pt',
  status text not null default 'live' check (status in ('live', 'ended')),
  listener_count int not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Tabela de participações (aluno entrou na sessão)
create table session_participants (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  target_language text not null default 'en',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique(session_id, student_id)
);

-- Índices
create index idx_sessions_professor on sessions(professor_id);
create index idx_sessions_status on sessions(status);
create index idx_participants_session on session_participants(session_id);
create index idx_participants_student on session_participants(student_id);

-- RLS (Row Level Security)
alter table professors enable row level security;
alter table students enable row level security;
alter table sessions enable row level security;
alter table session_participants enable row level security;

-- Políticas: professores podem ver/editar próprio perfil
create policy "Professors can view own profile"
  on professors for select using (auth.uid() = id);

create policy "Professors can update own profile"
  on professors for update using (auth.uid() = id);

-- Políticas: alunos podem ver/editar próprio perfil
create policy "Students can view own profile"
  on students for select using (auth.uid() = id);

create policy "Students can update own profile"
  on students for update using (auth.uid() = id);

-- Políticas: sessões visíveis para todos autenticados
create policy "Anyone can view live sessions"
  on sessions for select using (auth.role() = 'authenticated');

create policy "Professors can create sessions"
  on sessions for insert with check (auth.uid() = professor_id);

create policy "Professors can update own sessions"
  on sessions for update using (auth.uid() = professor_id);

-- Políticas: participações
create policy "Students can join sessions"
  on session_participants for insert with check (auth.uid() = student_id);

create policy "Participants can view own participation"
  on session_participants for select using (auth.uid() = student_id);

create policy "Participants can update own participation"
  on session_participants for update using (auth.uid() = student_id);

-- Professores podem ver participantes das suas sessões
create policy "Professors can view session participants"
  on session_participants for select using (
    exists (
      select 1 from sessions s
      where s.id = session_participants.session_id
      and s.professor_id = auth.uid()
    )
  );
