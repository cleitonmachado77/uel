-- Limpa sessões que ficaram como 'live' mas não têm professor conectado
UPDATE sessions SET status = 'ended', ended_at = now() WHERE status = 'live';
