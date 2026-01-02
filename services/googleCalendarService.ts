
import { Boleto } from "../types";

const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com'; // Placeholder
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

export const initGoogleClient = (callback: (auth: any) => void) => {
  const gapi = (window as any).gapi;
  const google = (window as any).google;

  if (!gapi || !google) return;

  gapi.load('client', async () => {
    await gapi.client.init({
      discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
    });
  });
};

export const createCalendarEvent = async (boleto: Boleto): Promise<string | null> => {
  const gapi = (window as any).gapi;
  if (!gapi?.client?.calendar) return null;

  const event = {
    'summary': `Vencimento: ${boleto.title}`,
    'description': `Lembrete de pagamento do boleto.\nValor: R$ ${boleto.amount.toFixed(2)}\nCódigo de barras: ${boleto.barcode || 'Não informado'}`,
    'start': {
      'date': boleto.dueDate,
    },
    'end': {
      'date': boleto.dueDate,
    },
    'reminders': {
      'useDefault': false,
      'overrides': [
        { 'method': 'popup', 'minutes': 24 * 60 }, // 1 day before
        { 'method': 'email', 'minutes': 24 * 60 },
      ],
    },
  };

  try {
    const request = gapi.client.calendar.events.insert({
      'calendarId': 'primary',
      'resource': event,
    });
    const response = await request;
    return response.result.id;
  } catch (err) {
    console.error('Erro ao criar evento na agenda:', err);
    return null;
  }
};

export const updateCalendarEvent = async (boleto: Boleto): Promise<boolean> => {
  const gapi = (window as any).gapi;
  if (!gapi?.client?.calendar || !boleto.calendarEventId) return false;

  const event = {
    'summary': `Vencimento: ${boleto.title}`,
    'description': `Lembrete de pagamento do boleto.\nValor: R$ ${boleto.amount.toFixed(2)}\nCódigo de barras: ${boleto.barcode || 'Não informado'}`,
    'start': {
      'date': boleto.dueDate,
    },
    'end': {
      'date': boleto.dueDate,
    },
  };

  try {
    await gapi.client.calendar.events.patch({
      'calendarId': 'primary',
      'eventId': boleto.calendarEventId,
      'resource': event,
    });
    return true;
  } catch (err) {
    console.error('Erro ao atualizar evento na agenda:', err);
    return false;
  }
};

export const deleteCalendarEvent = async (eventId: string): Promise<boolean> => {
  const gapi = (window as any).gapi;
  if (!gapi?.client?.calendar) return false;

  try {
    await gapi.client.calendar.events.delete({
      'calendarId': 'primary',
      'eventId': eventId,
    });
    return true;
  } catch (err) {
    console.error('Erro ao remover evento da agenda:', err);
    return false;
  }
};
