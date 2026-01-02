
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as webpush from 'https://esm.sh/web-push'

Deno.serve(async (req: Request) => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    webpush.setVapidDetails(
        'mailto:contato@boletoflow.com',
        vapidPublicKey,
        vapidPrivateKey
    )

    // 1. Buscar boletos que vencem hoje e não estão pagos
    const today = new Date().toISOString().split('T')[0]
    const { data: boletos, error: bError } = await supabase
        .from('boletos')
        .select('id, title, amount, user_id')
        .eq('due_date', today)
        .eq('status', 'pending')

    if (bError) return new Response(JSON.stringify({ error: bError.message }), { status: 500 })

    const results = []

    for (const boleto of boletos) {
        // 2. Buscar inscrições de push para o usuário
        const { data: subscriptions, error: sError } = await supabase
            .from('push_subscriptions')
            .select('*')
            .eq('user_id', boleto.user_id)

        if (sError) continue

        for (const sub of subscriptions) {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth
                }
            }

            const payload = JSON.stringify({
                title: 'Boleto Vence Hoje!',
                body: `Sua conta "${boleto.title}" no valor de R$ ${boleto.amount} vence hoje.`,
                url: '/'
            })

            try {
                await webpush.sendNotification(pushSubscription, payload)
                results.push({ boletoId: boleto.id, success: true })
            } catch (err) {
                console.error('Erro ao enviar push:', err)
                // Se o endpoint for inválido, podemos remover do banco
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await supabase.from('push_subscriptions').delete().eq('id', sub.id)
                }
                results.push({ boletoId: boleto.id, success: false, error: err.message })
            }
        }
    }

    return new Response(JSON.stringify({ results }), {
        headers: { 'Content-Type': 'application/json' }
    })
})
