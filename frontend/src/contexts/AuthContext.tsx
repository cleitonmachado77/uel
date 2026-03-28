'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: 'professor' | 'student' | null;
};

type AuthContextType = AuthState & {
  signUp: (email: string, password: string, name: string, role: 'professor' | 'student', avatar?: File, locale?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    role: null,
  });

  useEffect(() => {
    let mounted = true;

    // Timeout de segurança: se demorar mais de 3s, para de carregar
    const timeout = setTimeout(() => {
      if (mounted) setState((s) => ({ ...s, loading: false }));
    }, 3000);

    // Recupera sessão atual
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        detectRole(session.user.id).then((role) => {
          if (mounted) {
            clearTimeout(timeout);
            setState({ user: session.user, session, loading: false, role });
          }
        }).catch(() => {
          if (mounted) {
            clearTimeout(timeout);
            setState({ user: session.user, session, loading: false, role: null });
          }
        });
      } else {
        clearTimeout(timeout);
        setState((s) => ({ ...s, loading: false }));
      }
    }).catch(() => {
      if (mounted) {
        clearTimeout(timeout);
        setState((s) => ({ ...s, loading: false }));
      }
    });

    // Escuta mudanças de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;
        if (session?.user) {
          const role = await detectRole(session.user.id).catch(() => null);
          if (mounted) setState({ user: session.user, session, loading: false, role });
        } else {
          if (mounted) setState({ user: null, session: null, loading: false, role: null });
        }
      }
    );

    return () => {
      mounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  async function detectRole(userId: string): Promise<'professor' | 'student' | null> {
    const [profResult, stuResult] = await Promise.all([
      supabase.from('professors').select('id, locale').eq('id', userId).maybeSingle(),
      supabase.from('students').select('id, locale').eq('id', userId).maybeSingle(),
    ]);
    if (profResult.data) {
      if (profResult.data.locale) localStorage.setItem('uel-locale', profResult.data.locale);
      return 'professor';
    }
    if (stuResult.data) {
      if (stuResult.data.locale) localStorage.setItem('uel-locale', stuResult.data.locale);
      return 'student';
    }
    return null;
  }

  async function signUp(email: string, password: string, name: string, role: 'professor' | 'student', avatar?: File, locale?: string) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    if (!data.user) throw new Error('Erro ao criar conta');

    if (!data.session) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
    }

    let avatar_url = null;
    if (avatar) {
      const ext = avatar.name.split('.').pop();
      const path = `${data.user.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, avatar, { upsert: true });
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        avatar_url = urlData.publicUrl;
      }
    }

    const table = role === 'professor' ? 'professors' : 'students';
    const { error: profileError } = await supabase
      .from(table)
      .insert({ id: data.user.id, name, email, avatar_url, locale: locale || 'pt' });

    if (profileError) throw profileError;
  }

  async function signIn(email: string, password: string) {
    console.time('signIn-total');
    console.time('signIn-auth');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    console.timeEnd('signIn-auth');
    if (error) throw error;
    if (data.user && data.session) {
      setState({ user: data.user, session: data.session, loading: false, role: null });
      detectRole(data.user.id).then((role) => {
        setState((s) => ({ ...s, role }));
      }).catch(() => {});
    }
    console.timeEnd('signIn-total');
  }

  async function signOut() {
    await supabase.auth.signOut();
    localStorage.removeItem('uel-locale');
    setState({ user: null, session: null, loading: false, role: null });
  }

  return (
    <AuthContext.Provider value={{ ...state, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
