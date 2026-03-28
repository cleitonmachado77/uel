'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import { LOCALES, type Locale } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

export default function ProfilePage() {
  const { user, role } = useAuth();
  const { t, locale, setLocale } = useLocale();
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [selectedLocale, setSelectedLocale] = useState<Locale>(locale);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user || !role) return;
    const table = role === 'professor' ? 'professors' : 'students';
    supabase.from(table).select('name, avatar_url, locale').eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setName(data.name);
          setAvatarUrl(data.avatar_url);
          setPreview(data.avatar_url);
          if (data.locale) setSelectedLocale(data.locale as Locale);
        }
      });
  }, [user, role]);

  const handleSave = async () => {
    if (!user || !role) return;
    setSaving(true);
    setMessage('');

    try {
      let newAvatarUrl = avatarUrl;

      if (avatarFile) {
        const ext = avatarFile.name.split('.').pop();
        const path = `${user.id}/avatar.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('avatars').upload(path, avatarFile, { upsert: true });
        if (!upErr) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
          newAvatarUrl = urlData.publicUrl;
        }
      }

      const table = role === 'professor' ? 'professors' : 'students';
      await supabase.from(table).update({ name, avatar_url: newAvatarUrl, locale: selectedLocale }).eq('id', user.id);

      // Atualiza idioma global
      setLocale(selectedLocale);

      if (password.trim().length >= 6) {
        const { error } = await supabase.auth.updateUser({ password: password.trim() });
        if (error) throw error;
      }

      setMessage(t('profile.saved'));
      setAvatarUrl(newAvatarUrl);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="relative min-h-screen flex flex-col items-center px-6 py-8">
      <div className="absolute inset-0 -z-10">
        <img src="/bg-app.jpg" alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      </div>
      <div className="w-full max-w-md mb-6">
        <a href="/" className="inline-flex items-center gap-1 px-4 py-2 rounded-full border border-white/20 bg-white/5 text-gray-300 text-sm hover:bg-white/10 hover:text-white transition-colors">{t('back')}</a>
      </div>

      <div className="w-full max-w-md bg-black/40 backdrop-blur-md rounded-3xl p-6 border border-white/10">
        <h1 className="text-2xl font-bold text-white mb-6">{t('profile.title')}</h1>

        <div className="space-y-5">
        <div className="flex flex-col items-center gap-2">
          <label className="cursor-pointer">
            {preview ? (
              <img src={preview} alt="" className="w-24 h-24 rounded-full object-cover border-2 border-primary" />
            ) : (
              <div className="w-24 h-24 rounded-full bg-white/10 border-2 border-dashed border-gray-600 flex items-center justify-center text-gray-400 text-3xl font-bold">
                {name.charAt(0).toUpperCase()}
              </div>
            )}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { setAvatarFile(f); setPreview(URL.createObjectURL(f)); }
            }} />
          </label>
          <span className="text-gray-500 text-xs">{t('profile.change_photo')}</span>
        </div>

        <input type="text" placeholder={t('profile.name')} value={name} onChange={(e) => setName(e.target.value)}
          className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-primary focus:outline-none" />

        <input type="password" placeholder={t('profile.new_password')} value={password} onChange={(e) => setPassword(e.target.value)} minLength={6}
          className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-primary focus:outline-none" />

        {/* Seletor de idioma */}
        <div>
          <label className="text-gray-400 text-xs uppercase tracking-wider mb-2 block">{t('auth.language')}</label>
          <div className="flex flex-wrap gap-1.5">
            {LOCALES.map((l) => (
              <button key={l.code} type="button" onClick={() => setSelectedLocale(l.code)}
                className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${selectedLocale === l.code ? 'bg-primary text-white' : 'bg-white/10 text-gray-400'}`}>
                {l.flag} {l.label}
              </button>
            ))}
          </div>
        </div>

        {message && (
          <p className={`text-sm text-center ${message.includes(t('profile.saved')) ? 'text-green-400' : 'text-red-400'}`}>{message}</p>
        )}

        <button onClick={handleSave} disabled={saving}
          className="w-full bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-semibold py-4 rounded-2xl transition-colors">
          {saving ? t('profile.saving') : t('profile.save')}
        </button>
        </div>
      </div>
    </main>
  );
}


