
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Boleto, User } from './types';
import { extractBoletoInfo } from './services/geminiService';
import { initGoogleClient, createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from './services/googleCalendarService';
import { supabase } from './services/supabaseClient';
import { registerServiceWorker, subscribeUserToPush, checkPushSubscription } from './services/pushService';
import {
  PencilIcon,
  PlusIcon,
  CheckIcon,
  TrashIcon,
  UsersIcon as UserIcon,
  ArrowPathIcon,
  BellIcon,
  SparklesIcon,
  CreditCardIcon,
  XMarkIcon,
  DocumentTextIcon,
  BellAlertIcon,
  BellSlashIcon,
  InformationCircleIcon,
  ArrowUturnLeftIcon,
  EnvelopeIcon,
  LockClosedIcon,
  ArrowRightOnRectangleIcon,
  CalendarIcon,
  CheckCircleIcon
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
  const [showAuthSuccess, setShowAuthSuccess] = useState(false);

  // App State
  const [allBoletos, setAllBoletos] = useState<Boleto[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingBoletoId, setEditingBoletoId] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission>(typeof Notification !== 'undefined' ? Notification.permission : 'default');
  const [isPushActive, setIsPushActive] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // Audio state
  const lastNotifiedRef = useRef<Set<string>>(new Set());

  // Form States for Boletos
  const [formTitle, setFormTitle] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formBarcode, setFormBarcode] = useState('');
  const [formCategory, setFormCategory] = useState('Outros');
  const [formIsRecurring, setFormIsRecurring] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyView, setHistoryView] = useState<'date' | 'category'>('date');
  const [aiInput, setAiInput] = useState('');
  const [showAiInput, setShowAiInput] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const categories = [
    "Moradia", "Saúde", "Educação", "Lazer", "Serviços",
    "Alimentação", "Transporte", "Assinaturas", "Cartão de Crédito",
    "Impostos", "Seguros", "Investimentos", "Trabalho", "Pets", "Outros"
  ];

  const [hasNewUpdate, setHasNewUpdate] = useState(false);

  // --- Core Utility Functions ---

  const fetchBoletos = useCallback(async () => {
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
  }, []);

  const fetchLogs = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data } = await supabase
      .from('boleto_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setLogs(data);
  }, [session?.user?.id]);

  const playNotificationSound = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(NOTIFICATION_SOUND_URL);
    }
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(e => console.error("Erro ao tocar som:", e));
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

    return () => authSub.unsubscribe();
  }, []);

  // --- Realtime Subscription ---
  useEffect(() => {
    if (!session?.user?.id) return;

    console.log('Realtime: Iniciando conexão...');

    const boletosChannel = supabase
      .channel('db-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'boletos'
      }, (payload: any) => {
        const newRecord = payload.new as any;
        const oldRecord = payload.old as any;
        const currentUserId = session.user.id;

        const belongsToUser = (newRecord && newRecord.user_id === currentUserId) ||
          (oldRecord && oldRecord.user_id === currentUserId);

        if (belongsToUser) {
          console.log('Realtime: Mudança válida detectada!', payload.eventType);
          setTimeout(fetchBoletos, 300);

          if (payload.eventType === 'INSERT') {
            sendNotification('Novo Boleto!', `O boleto "${newRecord.title}" foi adicionado.`, true);
          }
          setHasNewUpdate(true);
        }
      })
      .subscribe((status) => {
        console.log('Realtime Status:', status);
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      console.log('Realtime: Limpando conexão');
      supabase.removeChannel(boletosChannel);
    };
  }, [session?.user?.id, fetchBoletos, sendNotification]);

  // --- Logs Subscription ---
  useEffect(() => {
    if (!session?.user?.id) return;

    fetchLogs();

    const logsChannel = supabase
      .channel('public:boleto_logs')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'boleto_logs',
        filter: `user_id=eq.${session.user.id}`
      }, () => {
        fetchLogs();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(logsChannel);
    };
  }, [session?.user?.id, fetchLogs]);
  useEffect(() => {
    const primeAudio = () => {
      if (!audioRef.current) {
        audioRef.current = new Audio(NOTIFICATION_SOUND_URL);
        audioRef.current.load();
      }
      window.removeEventListener('click', primeAudio);
      window.removeEventListener('touchstart', primeAudio);
    };
    window.addEventListener('click', primeAudio);
    window.addEventListener('touchstart', primeAudio);
    return () => {
      window.removeEventListener('click', primeAudio);
      window.removeEventListener('touchstart', primeAudio);
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

  /* fetchBoletos removed from here */

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
          options: {
            data: { name: authForm.name }
          }
        });

        if (error) throw error;

        if (data.user) {
          await supabase.from('profiles').insert([
            { id: data.user.id, name: authForm.name, email: authForm.email }
          ]);

          setShowAuthSuccess(true);
          // Small delay to let user see the success state
          await new Promise(resolve => setTimeout(resolve, 1500));

          // FORCE SYNC and Navigation if onAuthStateChange hasn't fired yet
          if (!currentUser) {
            await syncUser(data.user);
          }
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) throw error;

        setShowAuthSuccess(true);
        await new Promise(resolve => setTimeout(resolve, 800));

        if (data.user && !currentUser) {
          await syncUser(data.user);
        }
      }
    } catch (error: any) {
      console.error('Auth Error Details:', error);
      let message = "Ocorreu um erro inesperado.";

      if (error.message === "User already registered") message = "Este e-mail já está cadastrado.";
      else if (error.message === "Invalid login credentials") message = "E-mail ou senha incorretos.";
      else if (error.status === 429) message = "Muitas tentativas. Tente novamente mais tarde.";
      else message = error.message;

      setAuthErrors({ ...authErrors, general: message });
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // --- Notification & Audio Logic ---

  /* sendNotification and playNotificationSound removed from here */

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
    setHasNewUpdate(false);
    const permission = await Notification.requestPermission();
    setNotificationStatus(permission);
    if (permission === 'granted') sendNotification("Sistema Ativado!", "Notificações ligadas.", false);
  };

  const handleActivatePush = async () => {
    const result = await subscribeUserToPush();
    if (result === true || (typeof result === 'object' && result.success)) {
      setIsPushActive(true);
      alert("Notificações Push ativadas com sucesso!");
    } else {
      const errorMsg = typeof result === 'object' ? result.error : "Navegador incompatível.";
      alert(`Falha ao ativar: ${errorMsg}\n\nNota: Se estiver no iPhone (iOS), você deve primeiro adicionar este site à "Tela de Início" pelo menu de compartilhamento do Safari.`);
    }
  };

  // --- App Logic ---

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return '--/--';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const handleSaveBoleto = async () => {
    if (!session?.user?.id || !formTitle || !formAmount || !formDueDate) return;

    const boletoData = {
      user_id: session.user.id,
      title: formTitle,
      amount: parseFloat(formAmount),
      due_date: formDueDate,
      barcode: formBarcode,
      category: formCategory,
      is_recurring: formIsRecurring,
      status: 'pending' as const
    };

    try {
      if (editingId) {
        const { error } = await supabase
          .from('boletos')
          .update(boletoData)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('boletos')
          .insert([boletoData]);
        if (error) throw error;
      }

      setIsModalOpen(false);
      resetForm();
      fetchBoletos();
    } catch (error: any) {
      console.error('Error saving boleto:', error);
      alert('Erro ao salvar boleto');
    }
  };

  const resetForm = () => {
    setFormTitle('');
    setFormAmount('');
    setFormDueDate('');
    setFormBarcode('');
    setFormCategory('Outros');
    setFormIsRecurring(false);
    setAiInput(''); setShowAiInput(false);
    setEditingId(null);
  };

  const handleEditBoleto = (boleto: Boleto) => {
    setEditingId(boleto.id);
    setFormTitle(boleto.title);
    setFormAmount(boleto.amount.toString());
    setFormDueDate(boleto.dueDate);
    setFormBarcode(boleto.barcode || '');
    setFormCategory(boleto.category);
    setFormIsRecurring(boleto.is_recurring);
    setIsModalOpen(true);
  };
  const toggleBoletoStatus = async (id: string) => {
    const boleto = allBoletos.find(b => b.id === id);
    if (!boleto) return;

    const newStatus = boleto.status === 'pending' ? 'paid' : 'pending';
    let newDueDate = boleto.dueDate;

    // Recurrence logic
    if (newStatus === 'paid' && boleto.is_recurring) {
      const current = new Date(boleto.dueDate);
      current.setMonth(current.getMonth() + 1);
      newDueDate = current.toISOString().split('T')[0];
    }

    try {
      const { error } = await supabase
        .from('boletos')
        .update({
          status: boleto.is_recurring && newStatus === 'paid' ? 'pending' : newStatus,
          due_date: newDueDate
        })
        .eq('id', id);

      if (error) throw error;
      fetchBoletos();
    } catch (error: any) {
      console.error('Error toggling status:', error);
    }
  };

  const handleDeleteBoleto = async (id: string) => {
    if (confirm("Excluir esta conta permanentemente?")) {
      try {
        const { error } = await supabase
          .from('boletos')
          .delete()
          .eq('id', id);

        if (error) throw error;
        fetchBoletos();
      } catch (error: any) {
        console.error('Error deleting boleto:', error);
        alert('Erro ao excluir boleto: ' + (error.message || 'Erro desconhecido'));
      }
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
              {authErrors.general && (
                <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
                  <p className="text-xs font-bold text-rose-500 text-center">{authErrors.general}</p>
                </div>
              )}

              {authMode === 'register' && (
                <div className="space-y-1.5 animate-in fade-in slide-in-from-left-4 duration-500">
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

              <div className="space-y-1.5 transition-all duration-500">
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

              <div className="space-y-1.5 transition-all duration-500">
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
                <div className="space-y-1.5 animate-in fade-in slide-in-from-right-4 duration-500">
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
                disabled={isAuthLoading || showAuthSuccess}
                className={`w-full py-5 rounded-[20px] font-black uppercase text-xs tracking-widest shadow-xl transition-all flex items-center justify-center gap-3 disabled:opacity-50 overflow-hidden relative ${showAuthSuccess
                  ? 'bg-emerald-500 text-white shadow-emerald-200'
                  : 'bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700 hover:-translate-y-0.5 active:translate-y-0'
                  }`}
              >
                {showAuthSuccess ? (
                  <div className="flex items-center gap-2 animate-in fade-in zoom-in duration-300">
                    <CheckCircleIcon className="w-5 h-5" />
                    <span>{authMode === 'login' ? 'Identificado!' : 'Bem-vindo(a)!'}</span>
                  </div>
                ) : (
                  <>
                    {isAuthLoading && <ArrowPathIcon className="w-5 h-5 animate-spin" />}
                    <span>{authMode === 'login' ? 'Acessar Conta' : 'Criar minha conta'}</span>
                  </>
                )}
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
                <div
                  className={`w-2 h-2 rounded-full mr-1 transition-all ${realtimeConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`}
                  title={realtimeConnected ? 'Sincronismo Ativo' : 'Sincronismo Desconectado'}
                />
                <button
                  onClick={handleRequestNotification}
                  className={`p-2 rounded-full transition-all relative ${notificationStatus === 'granted' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:bg-slate-100'}`}
                  title="Som de Alerta"
                >
                  <BellAlertIcon className="w-5 h-5" />
                  {hasNewUpdate && (
                    <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full border-2 border-white animate-bounce"></span>
                  )}
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
                onClick={() => setIsHistoryOpen(true)}
                className="p-2 rounded-full text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-all"
                title="Histórico de Atividades"
              >
                <ArrowPathIcon className="w-5 h-5" />
              </button>
              <div className="w-px h-6 bg-slate-200 mx-1"></div>
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
                        onClick={() => handleEditBoleto(boleto)}
                        className="p-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-2xl transition-all"
                        title="Editar"
                      >
                        <PencilIcon className="w-6 h-6" />
                      </button>

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

      {/* Modal de Inclusão */}
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

                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100 transition-all hover:bg-slate-100 cursor-pointer" onClick={() => setFormIsRecurring(!formIsRecurring)}>
                  <div className={`w-10 h-6 rounded-full relative transition-colors ${formIsRecurring ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                    <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${formIsRecurring ? 'translate-x-4' : ''}`} />
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-900">Repetir Mensalmente</p>
                    <p className="text-[10px] font-bold text-slate-400">Gera nova conta após o pagamento</p>
                  </div>
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

      {/* History Drawer */}
      {isHistoryOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsHistoryOpen(false)}></div>
          <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md animate-in slide-in-from-right duration-500">
              <div className="h-full flex flex-col bg-white shadow-2xl rounded-l-[40px] border-l border-white overflow-hidden">
                <div className="p-8 border-b border-slate-100">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-black text-slate-900 tracking-tighter flex items-center gap-3">
                      <ArrowPathIcon className="w-6 h-6 text-indigo-600" />
                      Histórico
                    </h2>
                    <button onClick={() => setIsHistoryOpen(false)} className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors">
                      <XMarkIcon className="w-6 h-6" />
                    </button>
                  </div>

                  <div className="flex p-1 bg-slate-100 rounded-xl">
                    <button
                      onClick={() => setHistoryView('date')}
                      className={`flex-1 py-1.5 text-xs font-black rounded-lg transition-all ${historyView === 'date' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Por Data
                    </button>
                    <button
                      onClick={() => setHistoryView('category')}
                      className={`flex-1 py-1.5 text-xs font-black rounded-lg transition-all ${historyView === 'category' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Por Categoria
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                  <div className="space-y-8">
                    {logs.length === 0 ? (
                      <div className="text-center py-20">
                        <InformationCircleIcon className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                        <p className="text-slate-400 font-bold">Nenhuma atividade recente.</p>
                      </div>
                    ) : (
                      Object.entries(
                        logs.reduce((acc: any, log) => {
                          let category = "Geral";
                          if (historyView === 'date') {
                            const date = new Date(log.created_at);
                            const today = new Date();
                            const yesterday = new Date();
                            yesterday.setDate(yesterday.getDate() - 1);

                            category = "Anteriores";
                            if (date.toDateString() === today.toDateString()) category = "Hoje";
                            else if (date.toDateString() === yesterday.toDateString()) category = "Ontem";
                          } else {
                            category = log.boleto_category || "Sem Categoria";
                          }

                          if (!acc[category]) acc[category] = [];
                          acc[category].push(log);
                          return acc;
                        }, {})
                      ).map(([category, items]: [string, any]) => (
                        <div key={category} className="space-y-4">
                          <div className="flex items-center gap-3 sticky top-0 bg-white/95 py-2 z-10">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{category}</h3>
                            <div className="flex-1 h-px bg-slate-50"></div>
                            <span className="text-[10px] font-bold text-slate-300 bg-slate-50 px-2 py-0.5 rounded-full">{items.length}</span>
                          </div>
                          <div className="space-y-4">
                            {items.map((log: any) => (
                              <div key={log.id} className="flex gap-4 group">
                                <div className="flex flex-col items-center">
                                  <div className={`p-2 rounded-xl border ${log.action.includes('Excluiu') ? 'bg-rose-50 border-rose-100 text-rose-500' :
                                    log.action.includes('Marcou como pendente') ? 'bg-amber-50 border-amber-100 text-amber-500' :
                                      log.action.includes('Manteve como pago') || log.action.includes('pago') ? 'bg-emerald-50 border-emerald-100 text-emerald-500' :
                                        'bg-indigo-50 border-indigo-100 text-indigo-500'
                                    }`}>
                                    {log.action.includes('Excluiu') ? <TrashIcon className="w-4 h-4" /> :
                                      log.action.includes('Marcou como pendente') ? <ArrowUturnLeftIcon className="w-4 h-4" /> :
                                        log.action.includes('Marcou como pago') || log.action.includes('pago') ? <CheckIcon className="w-4 h-4" /> :
                                          <PlusIcon className="w-4 h-4" />}
                                  </div>
                                  <div className="flex-1 w-px bg-slate-50 my-2 group-last:hidden"></div>
                                </div>
                                <div className="pb-4 w-full border-b border-slate-50 group-last:border-0 hover:bg-slate-25 transition-colors rounded-lg px-2 -mx-2">
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="font-extrabold text-slate-800 text-sm tracking-tight">{log.action}</p>
                                    <span className="text-[10px] font-bold text-slate-400">
                                      {new Date(log.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <p className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-200"></span>
                                    Boleto: <span className="text-indigo-600 font-black">{log.boleto_title}</span>
                                    {historyView === 'date' && log.boleto_category && (
                                      <>
                                        <span className="text-slate-300">•</span>
                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md">{log.boleto_category}</span>
                                      </>
                                    )}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div >
  );
};

export default App;
