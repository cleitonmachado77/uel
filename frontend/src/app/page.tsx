'use client';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { supabase } from '@/lib/supabase';
import Image from 'next/image';
import Link from 'next/link';

export default function Home() {
  const { user, role, loading, signOut } = useAuth();
  const { resetLocale, t } = useLocale();
  const router = useRouter();
  const [userName, setUserName] = useState('');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || !role) return;
    const table = role === 'professor' ? 'professors' : 'students';
    supabase.from(table).select('name').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (data) setUserName(data.name); });
  }, [user, role]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <div className="absolute inset-0 -z-10 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: 'url(/bg-app.jpg)' }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      </div>

      <div className="mb-8">
        <Image src="/logo.png" alt="UEL Connect" width={180} height={60} priority className="mx-auto drop-shadow-lg" />
      </div>

      <div className="w-full max-w-sm bg-black/40 backdrop-blur-md rounded-3xl p-8 border border-white/10">
        <p className="text-gray-300 text-center mb-1 text-sm tracking-wide">
          Tradução em tempo real para alunos internacionais
        </p>
        <p className="text-gray-500 text-center text-xs mb-6">
          Real-time translation for international students
        </p>
        <p className="text-gray-400 text-sm text-center mb-6">
          {t('home.hello')}, {userName || user.email}
        </p>

        <div className="flex flex-col gap-4">
          {role === 'professor' && (
            <Link href="/professor" className="flex items-center justify-center gap-3 bg-primary hover:bg-primary-dark text-white font-semibold py-4 px-6 rounded-2xl transition-colors">
              <MicIcon />
              {t('home.start_broadcast')}
            </Link>
          )}

          {role === 'student' && (
            <Link href="/student" className="flex items-center justify-center gap-3 bg-tertiary hover:bg-tertiary-dark text-white font-semibold py-4 px-6 rounded-2xl transition-colors">
              <HeadphonesIcon />
              {t('home.live_classes')}
            </Link>
          )}

          {!role && (
            <>
              <Link href="/professor" className="flex items-center justify-center gap-3 bg-primary hover:bg-primary-dark text-white font-semibold py-4 px-6 rounded-2xl transition-colors">
                <MicIcon />
                {t('home.professor')}
              </Link>
              <Link href="/student" className="flex items-center justify-center gap-3 bg-tertiary hover:bg-tertiary-dark text-white font-semibold py-4 px-6 rounded-2xl transition-colors">
                <HeadphonesIcon />
                {t('home.student')}
              </Link>
            </>
          )}

          <div className="flex gap-3 mt-2 justify-center">
            <Link href="/profile" className="text-gray-400 hover:text-white text-sm transition-colors">
              {t('home.edit_profile')}
            </Link>
            <button onClick={() => { signOut(); resetLocale(); }} className="text-gray-400 hover:text-white text-sm transition-colors">
              {t('home.logout')}
            </button>
          </div>
        </div>
      </div>

      <p className="text-gray-400 text-xs mt-8">UEL Connect &copy; 2026</p>
    </main>
  );
}

function MicIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function HeadphonesIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}
