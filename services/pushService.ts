
import { supabase } from './supabaseClient';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export async function registerServiceWorker() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registrado com sucesso:', registration);
            return registration;
        } catch (error) {
            console.error('Falha ao registrar Service Worker:', error);
        }
    }
    return null;
}

export async function subscribeUserToPush() {
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });

        console.log('Usuário inscrito:', subscription);

        // Salvar no Supabase
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            const subJSON = subscription.toJSON();
            const { error } = await supabase.from('push_subscriptions').upsert({
                user_id: session.user.id,
                endpoint: subJSON.endpoint,
                p256dh: subJSON.keys?.p256dh,
                auth: subJSON.keys?.auth
            }, { onConflict: 'endpoint' });

            if (error) throw error;
            return true;
        }
    } catch (error) {
        console.error('Falha ao inscrever usuário:', error);
    }
    return false;
}

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
