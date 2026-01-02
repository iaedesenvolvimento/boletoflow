
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Boleto, User } from './types';
import { extractBoletoInfo } from './services/geminiService';
import { initGoogleClient, createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from './services/googleCalendarService';
import { supabase } from './services/supabaseClient';
import { registerServiceWorker, subscribeUserToPush, checkPushSubscription } from './services/pushService';
import {
  PlusIcon,
  CalendarIcon,
  TrashIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  BellIcon,
  SparklesIcon,
  CreditCardIcon,
  XMarkIcon,
  DocumentTextIcon,
  PencilSquareIcon,
  BellAlertIcon,
  BellSlashIcon,
  InformationCircleIcon,
  CheckIcon,
  ArrowUturnLeftIcon,
  UserIcon,
  EnvelopeIcon,
  LockClosedIcon,
  ArrowRightOnRectangleIcon
} from '@heroicons/react/24/outline';

const NOTIFICATION_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

const App: React.FC = () => {
  // Auth State
  const [session, setSession] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [authErrors, setAuthErrors] = useState<Record<string, string>>({});
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // App State
  const [allBoletos, setAllBoletos] = useState<Boleto[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingBoletoId, setEditingBoletoId] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission>(typeof Notification !== 'undefined' ? Notification.permission : 'default');
  const [isPushActive, setIsPushActive] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Audio state
  const lastNotifiedRef = useRef<Set<string>>(new Set());

  // Form States for Boletos
  const [formTitle, setFormTitle] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formBarcode, setFormBarcode] = useState('');
  const [formCategory, setFormCategory] = useState('Outros');
  const [aiInput, setAiInput] = useState('');
  const [showAiInput, setShowAiInput] = useState(false);

  const categories = [
    "Moradia", "Saúde", "Educação", "Lazer", "Serviços",
    "Alimentação", "Transporte", "Assinaturas", "Cartão de Crédito",
    "Impostos", "Seguros", "Investimentos", "Trabalho", "Pets", "Outros"
  ];

  // --- Auth Logic ---

  useEffect(() => {
    registerServiceWorker().then(() => {
      checkPushSubscription().then(active => {
        console.log('Push status check:', active);
        setIsPushActive(active);
      });
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        syncUser(session.user);
      }
    });

    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        syncUser(session.user);
      } else {
        setCurrentUser(null);
        setAllBoletos([]);
      }
    });

    // --- Realtime Subscription ---
    const boletosChannel = supabase
      .channel('public:boletos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boletos' }, (payload) => {
        console.log('Realtime change received:', payload);
        fetchBoletos();
      })
      .subscribe();

    return () => {
      authSub.unsubscribe();
      supabase.removeChannel(boletosChannel);
    };
  }, []);

  const syncUser = async (supabaseUser: any) => {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', supabaseUser.id)
      .single();

    if (error) {
      console.error('syncUser error:', error);
      // If profile doesn't exist, maybe it's a first time login without profile insert success
      if (error.code === 'PGRST116') {
        console.warn('Profile not found, attempting to create one...');
        const { error: insertError } = await supabase.from('profiles').insert([
          { id: supabaseUser.id, name: supabaseUser.user_metadata?.name || supabaseUser.email?.split('@')[0], email: supabaseUser.email }
        ]);
        if (!insertError) return syncUser(supabaseUser);
      }
    }

    if (profile) {
      setCurrentUser({
        id: profile.id,
        name: profile.name,
        email: profile.email
      });
      fetchBoletos();
    }
  };

  const fetchBoletos = async () => {
    const { data, error } = await supabase
      .from('boletos')
      .select('*')
      .order('due_date', { ascending: true });

    if (data) {
      setAllBoletos(data.map(b => ({
        ...b,
        userId: b.user_id,
        amount: b.amount,
        dueDate: b.due_date,
        calendarEventId: b.calendar_event_id,
        createdAt: new Date(b.created_at).getTime()
      })));
    }
    setHasInitialized(true);
  };

  const validateAuth = () => {
    const errors: Record<string, string> = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (authMode === 'register' && !authForm.name.trim()) errors.name = 'Nome é obrigatório';
    if (!authForm.email.trim()) errors.email = 'E-mail é obrigatório';
    else if (!emailRegex.test(authForm.email)) errors.email = 'E-mail inválido';

    if (!authForm.password) errors.password = 'Senha é obrigatória';
    else if (authForm.password.length < 6) errors.password = 'Mínimo de 6 caracteres';

    if (authMode === 'register' && authForm.password !== authForm.confirmPassword) {
      errors.confirmPassword = 'As senhas não coincidem';
    }

    setAuthErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAuth()) return;

    setIsAuthLoading(true);

    try {
      if (authMode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: authForm.email,
          password: authForm.password,
        });

        if (error) throw error;
        if (data.user) {
          await supabase.from('profiles').insert([
            { id: data.user.id, name: authForm.name, email: authForm.email }
          ]);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) throw error;
      }
    } catch (error: any) {
      console.error('Auth Error Details:', error);
      alert(`Erro na autenticação: ${error.message || JSON.stringify(error)}`);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // --- Notification & Audio Logic ---

  const playNotificationSound = useCallback(() => {
    const audio = new Audio(NOTIFICATION_SOUND_URL);
    audio.play().catch(e => console.error("Erro ao tocar som:", e));
  }, []);

  const sendNotification = useCallback((title: string, body: string, playSound = true) => {
    if (playSound) playNotificationSound();

    if (typeof Notification === 'undefined') {
      console.log(`${title}\n${body}`);
      return;
    }
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: 'https://cdn-icons-png.flaticon.com/512/5968/5968292.png',
          tag: 'boleto-flow'
        });
      } catch (e) { console.log(`🔔 ${title}\n\n${body}`); }
    }
  }, [playNotificationSound]);

  useEffect(() => {
    if (!hasInitialized || !currentUser) return;

    const checkDueSoon = () => {
      const today = new Date().toISOString().split('T')[0];
      allBoletos.forEach(b => {
        if (b.status === 'pending' && b.dueDate === today && !lastNotifiedRef.current.has(b.id)) {
          sendNotification(`Boleto Vence Hoje!`, `Sua conta "${b.title}" vence hoje no valor de ${formatCurrency(b.amount)}.`);
          lastNotifiedRef.current.add(b.id);
        }
      });
    };

    checkDueSoon();
    const interval = setInterval(checkDueSoon, 1000 * 60 * 60); // Check every hour
    return () => clearInterval(interval);
  }, [allBoletos, currentUser, hasInitialized, sendNotification]);

  const handleRequestNotification = async () => {
    const permission = await Notification.requestPermission();
    setNotificationStatus(permission);
    if (permission === 'granted') sendNotification("Sistema Ativado!", "Notificações ligadas.", false);
  };

  const handleActivatePush = async () => {
    const success = await subscribeUserToPush();
    if (success) {
      setIsPushActive(true);
      alert("Notificações Push ativadas com sucesso!");
    } else {
      alert("Falha ao ativar notificações push. Verifique se seu navegador suporta.");
    }
  };

  // --- App Logic ---

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return '--/--';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const handleSaveBoleto = async () => {
    if (!formTitle || !formAmount || !formDueDate || !currentUser) return;

    const boletoData = {
      user_id: currentUser.id,
      title: formTitle,
      amount: parseFloat(formAmount),
      due_date: formDueDate,
      barcode: formBarcode,
      category: formCategory,
      status: 'pending' as const
    };

    try {
      if (editingBoletoId) {
        const { error } = await supabase
          .from('boletos')
          .update({ ...boletoData })
          .eq('id', editingBoletoId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('boletos')
          .insert([boletoData]);
        if (error) throw error;
      }
      fetchBoletos();
      setIsModalOpen(false);
      resetForm();
    } catch (error: any) {
      alert(error.message);
    }
  };

  const resetForm = () => {
    setFormTitle(''); setFormAmount(''); setFormDueDate(''); setFormBarcode(''); setFormCategory('Outros'); setAiInput(''); setShowAiInput(false); setEditingBoletoId(null);
  };

  const toggleBoletoStatus = async (id: string) => {
    const boleto = allBoletos.find(b => b.id === id);
    if (!boleto) return;

    const newStatus = boleto.status === 'paid' ? 'pending' : 'paid';
    const { error } = await supabase
      .from('boletos')
      .update({ status: newStatus })
      .eq('id', id);

    if (!error) fetchBoletos();
  };

  const handleDeleteBoleto = async (id: string) => {
    if (confirm("Excluir conta?")) {
      const { error } = await supabase
        .from('boletos')
        .delete()
        .eq('id', id);
      if (!error) fetchBoletos();
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  const sortedBoletos = useMemo(() => {
    return [...allBoletos].sort((a, b) => {
      if (a.status === b.status) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      return a.status === 'paid' ? 1 : -1;
    });
  }, [allBoletos]);

  const totalPendente = useMemo(() => {
    return allBoletos.filter(b => b.status === 'pending').reduce((acc, curr) => acc + curr.amount, 0);
  }, [allBoletos]);

  // --- Views ---

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-500">
          <div className="text-center mb-10">
            <div className="w-16 h-16 bg-indigo-600 rounded-[20px] flex items-center justify-center text-white shadow-2xl shadow-indigo-200 mx-auto mb-4">
              <CreditCardIcon className="w-10 h-10" />
            </div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Boleto<span className="text-indigo-600">Flow</span></h1>
            <p className="text-slate-500 font-medium mt-2">Sua gestão financeira inteligente</p>
          </div>

          <div className="bg-white rounded-[40px] shadow-2xl shadow-slate-200/50 p-10 border border-white">
            <div className="flex bg-slate-100 p-1.5 rounded-[20px] mb-8">
              <button
                onClick={() => { setAuthMode('login'); setAuthErrors({}); }}
                className={`flex-1 py-3 rounded-[15px] text-xs font-black uppercase tracking-widest transition-all ${authMode === 'login' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}
              >
                Entrar
              </button>
              <button
                onClick={() => { setAuthMode('register'); setAuthErrors({}); }}
                className={`flex-1 py-3 rounded-[15px] text-xs font-black uppercase tracking-widest transition-all ${authMode === 'register' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}
              >
                Cadastrar
              </button>
            </div>

            <form onSubmit={handleAuth} className="space-y-5">
              {authMode === 'register' && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nome Completo</label>
                  <div className="relative">
                    <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="text"
                      value={authForm.name}
                      onChange={e => setAuthForm({ ...authForm, name: e.target.value })}
                      className={`w-full pl-12 pr-5 py-4 rounded-2xl bg-slate-50 border transition-all outline-none font-bold ${authErrors.name ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-indigo-600'}`}
                      placeholder="Seu nome"
                    />
                  </div>
                  {authErrors.name && <p className="text-[10px] font-bold text-rose-500 ml-1">{authErrors.name}</p>}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">E-mail</label>
                <div className="relative">
                  <EnvelopeIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={e => setAuthForm({ ...authForm, email: e.target.value })}
                    className={`w-full pl-12 pr-5 py-4 rounded-2xl bg-slate-50 border transition-all outline-none font-bold ${authErrors.email ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-indigo-600'}`}
                    placeholder="email@exemplo.com"
                  />
                </div>
                {authErrors.email && <p className="text-[10px] font-bold text-rose-500 ml-1">{authErrors.email}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Senha</label>
                <div className="relative">
                  <LockClosedIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="password"
                    value={authForm.password}
                    onChange={e => setAuthForm({ ...authForm, password: e.target.value })}
                    className={`w-full pl-12 pr-5 py-4 rounded-2xl bg-slate-50 border transition-all outline-none font-bold ${authErrors.password ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-indigo-600'}`}
                    placeholder="••••••"
                  />
                </div>
                {authErrors.password && <p className="text-[10px] font-bold text-rose-500 ml-1">{authErrors.password}</p>}
              </div>

              {authMode === 'register' && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Confirmar Senha</label>
                  <div className="relative">
                    <LockClosedIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="password"
                      value={authForm.confirmPassword}
                      onChange={e => setAuthForm({ ...authForm, confirmPassword: e.target.value })}
                      className={`w-full pl-12 pr-5 py-4 rounded-2xl bg-slate-50 border transition-all outline-none font-bold ${authErrors.confirmPassword ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-indigo-600'}`}
                      placeholder="••••••"
                    />
                  </div>
                  {authErrors.confirmPassword && <p className="text-[10px] font-bold text-rose-500 ml-1">{authErrors.confirmPassword}</p>}
                </div>
              )}

              <button
                type="submit"
                disabled={isAuthLoading}
                className="w-full bg-indigo-600 text-white py-5 rounded-[20px] font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {isAuthLoading ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : null}
                {authMode === 'login' ? 'Acessar Conta' : 'Criar minha conta'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm backdrop-blur-md bg-white/80">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <CreditCardIcon className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Boleto<span className="text-indigo-600">Flow</span></h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center bg-slate-100 p-1 rounded-full border border-slate-200">
              <div className="flex items-center gap-1.5 px-2">
                <button
                  onClick={handleRequestNotification}
                  className={`p-2 rounded-full transition-all ${notificationStatus === 'granted' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:bg-slate-100'}`}
                  title="Som de Alerta"
                >
                  <BellAlertIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={handleActivatePush}
                  className={`flex items-center gap-2 px-3 py-2 rounded-full transition-all ${isPushActive ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'text-slate-400 hover:bg-slate-100 border border-transparent'}`}
                  title="Notificações Push (Mesmo Offline)"
                >
                  <SparklesIcon className={`w-4 h-4 ${isPushActive ? 'animate-pulse' : ''}`} />
                  <span className="text-[10px] font-bold uppercase tracking-tight">Push {isPushActive ? 'ON' : 'OFF'}</span>
                </button>
              </div>
              <div className="flex items-center gap-2 pr-3 pl-1">
                <div className="w-6 h-6 bg-slate-200 rounded-full flex items-center justify-center">
                  <UserIcon className="w-3.5 h-3.5 text-slate-500" />
                </div>
                <span className="text-[10px] font-black uppercase text-slate-500 max-w-[80px] truncate">{currentUser?.name || 'Usuário'}</span>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-rose-500 transition-colors"
                title="Sair"
              >
                <ArrowRightOnRectangleIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          <div className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-200">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Pendente</p>
            <p className="text-3xl font-black text-slate-900 tabular-nums">{formatCurrency(totalPendente)}</p>
          </div>
          <div className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-200">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Próximo Vencimento</p>
            <p className="text-3xl font-black text-indigo-600 tabular-nums">
              {sortedBoletos.find(b => b.status === 'pending')?.dueDate
                ? formatDateDisplay(sortedBoletos.find(b => b.status === 'pending')!.dueDate)
                : '--/--'}
            </p>
          </div>
          <div className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-200">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Boletos Pagos</p>
            <p className="text-3xl font-black text-emerald-600 tabular-nums">{allBoletos.filter(b => b.status === 'paid').length}</p>
          </div>
        </div>

        {allBoletos.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-[40px] border border-slate-200 border-dashed">
            <SparklesIcon className="w-16 h-16 text-indigo-100 mx-auto mb-4" />
            <h2 className="text-xl font-black text-slate-900">Nenhum boleto por aqui</h2>
            <p className="text-slate-400 text-sm mt-1">Comece adicionando seu primeiro lembrete.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedBoletos.map((boleto) => (
              <div
                key={boleto.id}
                className={`group bg-white p-6 rounded-[32px] border transition-all duration-300 ${boleto.status === 'paid' ? 'border-emerald-100 opacity-60' : 'border-slate-200 hover:shadow-xl'
                  }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-start gap-5">
                    <div className={`mt-1.5 p-3 rounded-[20px] shadow-sm ${boleto.status === 'paid' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'
                      }`}>
                      {boleto.status === 'paid' ? <CheckIcon className="w-7 h-7 stroke-[3px]" /> : <BellIcon className="w-7 h-7" />}
                    </div>
                    <div>
                      <h3 className={`text-xl font-black ${boleto.status === 'paid' ? 'line-through' : 'text-slate-900'}`}>{boleto.title}</h3>
                      <div className="flex items-center gap-3 mt-2 text-sm font-bold">
                        <span className="flex items-center gap-1.5 text-slate-700">
                          <CalendarIcon className="w-4.5 h-4.5" /> {formatDateDisplay(boleto.dueDate)}
                        </span>
                        <span className="px-3 py-1 bg-slate-100 rounded-full text-[10px] uppercase font-black text-slate-500">
                          {boleto.category}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 pt-5 md:pt-0">
                    <div className="text-right">
                      <p className="text-[10px] font-black text-slate-400 uppercase">Valor</p>
                      <p className="text-2xl font-black">{formatCurrency(boleto.amount)}</p>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        onClick={() => toggleBoletoStatus(boleto.id)}
                        className={`h-12 px-6 rounded-2xl text-sm font-black transition-all ${boleto.status === 'paid'
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                          }`}
                      >
                        {boleto.status === 'paid' ? 'Pendente' : 'Marcar Pago'}
                      </button>

                      <button
                        onClick={() => handleDeleteBoleto(boleto.id)}
                        className="p-3 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-2xl transition-all"
                      >
                        <TrashIcon className="w-6 h-6" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <button
        onClick={() => { resetForm(); setIsModalOpen(true); }}
        className="fixed bottom-8 right-8 bg-indigo-600 text-white px-7 py-5 rounded-[28px] shadow-2xl hover:bg-indigo-700 hover:scale-105 transition-all flex items-center gap-3 z-40 border-4 border-white"
      >
        <PlusIcon className="w-7 h-7 stroke-[4px]" />
        <span className="font-black text-lg">Nova Conta</span>
      </button>

      {/* Reutilizando Modal de Inclusão com Estilo Refinado */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" onClick={() => setIsModalOpen(false)}></div>
          <div className="bg-white rounded-[40px] w-full max-w-lg shadow-2xl relative z-10 overflow-hidden max-h-[92vh] flex flex-col border border-white">
            <div className="p-10 overflow-y-auto custom-scrollbar">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-black text-slate-900 tracking-tighter">Detalhes da Conta</h2>
                <button onClick={() => setIsModalOpen(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-400 hover:text-slate-600">
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Descrição</label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:border-indigo-600 outline-none font-bold"
                    placeholder="Ex: Conta de Luz"
                  />
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Valor (R$)</label>
                    <input
                      type="number"
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:border-indigo-600 outline-none font-black text-indigo-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Vencimento</label>
                    <input
                      type="date"
                      value={formDueDate}
                      onChange={(e) => setFormDueDate(e.target.value)}
                      className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:border-indigo-600 outline-none font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Categoria</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:border-indigo-600 outline-none font-bold appearance-none"
                  >
                    {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>

                <div className="flex gap-4 pt-6">
                  <button
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-6 py-5 rounded-[24px] font-black text-slate-400 bg-slate-100 uppercase text-[10px] tracking-widest"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveBoleto}
                    className="flex-[2] px-6 py-5 rounded-[24px] font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100 uppercase text-[10px] tracking-widest"
                  >
                    Salvar Conta
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
