'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import { LOCALES, t as translate } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function AuthPage() {
  const { locale, setLocale } = useLocale();
  // Tela de login sempre em inglês; cadastro usa o idioma selecionado
  const [isLogin, setIsLogin] = useState(true);
  const t = (key: string) => isLogin ? translate(key, 'en') : translate(key, locale);
  const [email, setEmail] = useState('');

  // Reseta idioma pra inglês ao entrar na tela de auth
  useEffect(() => {
    setLocale('en');
  }, []);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'professor' | 'student'>('student');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        await signUp(email, password, name, role, avatar || undefined, locale);
      }
      router.push('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <div className="absolute inset-0 -z-10">
        <Image src="/bg-campus.jpg" alt="" fill className="object-cover" priority />
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      </div>

      <Image src="/logo.png" alt="UEL Connect" width={260} height={86} priority className="mb-8 drop-shadow-lg" />

      <div className="w-full max-w-sm bg-black/40 backdrop-blur-md rounded-3xl p-6 border border-white/10">
        {/* Tabs */}
        <div className="flex mb-6 bg-white/10 rounded-xl p-1">
          <button onClick={() => setIsLogin(true)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${isLogin ? 'bg-primary text-white' : 'text-gray-400'}`}>
            {t('auth.login')}
          </button>
          <button onClick={() => setIsLogin(false)} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${!isLogin ? 'bg-primary text-white' : 'text-gray-400'}`}>
            {t('auth.register')}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <>
              {/* Seletor de idioma */}
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wider mb-2 block">{t('auth.language')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {LOCALES.map((l) => (
                    <button key={l.code} type="button" onClick={() => setLocale(l.code)} className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${locale === l.code ? 'bg-primary text-white' : 'bg-white/10 text-gray-400'}`}>
                      {l.flag} {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <input type="text" placeholder={t('auth.name')} value={name} onChange={(e) => setName(e.target.value)} required className="w-full bg-white/10 border border-gray-800 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-primary focus:outline-none" />
              <div className="flex gap-2">
                <button type="button" onClick={() => setRole('student')} className={`flex-1 py-3 rounded-xl text-sm font-medium transition-colors ${role === 'student' ? 'bg-tertiary text-white' : 'bg-white/10 text-gray-400 border border-gray-800'}`}>
                  {t('auth.student')}
                </button>
                <button type="button" onClick={() => setRole('professor')} className={`flex-1 py-3 rounded-xl text-sm font-medium transition-colors ${role === 'professor' ? 'bg-primary text-white' : 'bg-white/10 text-gray-400 border border-gray-800'}`}>
                  {t('auth.professor')}
                </button>
              </div>
              <div className="flex flex-col items-center gap-2">
                <label className="cursor-pointer">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-primary" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-white/10 border-2 border-dashed border-gray-600 flex items-center justify-center text-gray-400 text-xs text-center">
                      {t('auth.photo')}
                    </div>
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) { setAvatar(file); setAvatarPreview(URL.createObjectURL(file)); } }} />
                </label>
                <span className="text-gray-500 text-xs">{t('auth.photo_tap')}</span>
              </div>
            </>
          )}

          <input type="email" placeholder={t('auth.email')} value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full bg-white/10 border border-gray-800 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-primary focus:outline-none" />
          <input type="password" placeholder={t('auth.password')} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="w-full bg-white/10 border border-gray-800 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-primary focus:outline-none" />

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-semibold py-4 rounded-2xl transition-colors">
            {loading ? t('auth.loading') : isLogin ? t('auth.submit_login') : t('auth.submit_register')}
          </button>
        </form>
      </div>

      <Image src="/paises.png" alt="Idiomas disponíveis" width={384} height={80} className="mt-6 max-w-sm w-full opacity-80" />
      <p className="text-gray-400 text-xs mt-4">UEL Connect &copy; 2026</p>
    </main>
  );
}

