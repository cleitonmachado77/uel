import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️  SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados');
}

// Backend usa service_role key para bypass de RLS
export const supabase = createClient(supabaseUrl || '', supabaseServiceKey || '');

/**
 * Cria uma sessão no banco
 */
export async function createSession(professorId, subject, language) {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      professor_id: professorId,
      subject,
      language,
      status: 'live',
    })
    .select()
    .single();

  if (error) throw new Error(`Erro ao criar sessão: ${error.message}`);
  return data;
}

/**
 * Encerra uma sessão
 */
export async function endSession(sessionId) {
  const { error } = await supabase
    .from('sessions')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (error) throw new Error(`Erro ao encerrar sessão: ${error.message}`);
}

/**
 * Busca sessões ao vivo
 */
export async function getLiveSessions() {
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      subject,
      language,
      listener_count,
      started_at,
      professors ( id, name, department, avatar_url )
    `)
    .eq('status', 'live')
    .order('started_at', { ascending: false });

  if (error) throw new Error(`Erro ao buscar sessões: ${error.message}`);
  return data;
}

/**
 * Registra participação de aluno (upsert, sem incrementar contador)
 */
export async function joinSessionDB(sessionId, studentId, targetLanguage) {
  const { error } = await supabase
    .from('session_participants')
    .upsert(
      {
        session_id: sessionId,
        student_id: studentId,
        target_language: targetLanguage,
        joined_at: new Date().toISOString(),
        left_at: null,
      },
      { onConflict: 'session_id,student_id' }
    );

  if (error) {
    console.warn('joinSessionDB warning:', error.message);
  }
}

/**
 * Registra saída de aluno (sem decrementar contador)
 */
export async function leaveSessionDB(sessionId, studentId) {
  const { error } = await supabase
    .from('session_participants')
    .update({ left_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .eq('student_id', studentId);

  if (error) console.error('Erro ao registrar saída:', error.message);
}

/**
 * Atualiza o listener_count no banco com o valor real do Map em memória
 */
export async function syncListenerCount(sessionId, count) {
  const { error } = await supabase
    .from('sessions')
    .update({ listener_count: count })
    .eq('id', sessionId);

  if (error) console.error('syncListenerCount error:', error.message);
}

/**
 * Encerra todas as sessões 'live' no banco (limpeza de sessões órfãs ao reiniciar o servidor)
 */
export async function cleanupStaleSessions() {
  const { data, error } = await supabase
    .from('sessions')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
    })
    .eq('status', 'live')
    .select('id');

  if (error) {
    console.error('Erro ao limpar sessões órfãs:', error.message);
    return 0;
  }

  const count = data?.length || 0;
  if (count > 0) {
    console.log(`[Startup] ${count} sessão(ões) órfã(s) encerrada(s)`);
  }
  return count;
}

/**
 * Valida token JWT do Supabase Auth
 */
export async function validateToken(token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}
