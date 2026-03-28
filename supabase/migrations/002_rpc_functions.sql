-- Funções RPC para contagem de ouvintes

create or replace function increment_listeners(sid uuid)
returns void as $$
  update sessions
  set listener_count = listener_count + 1
  where id = sid;
$$ language sql security definer;

create or replace function decrement_listeners(sid uuid)
returns void as $$
  update sessions
  set listener_count = greatest(listener_count - 1, 0)
  where id = sid;
$$ language sql security definer;
