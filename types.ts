
export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
}

export interface Boleto {
  id: string;
  userId: string; // Vincula o boleto ao usuário
  title: string;
  amount: number;
  dueDate: string;
  barcode?: string;
  status: 'pending' | 'paid' | 'overdue';
  category?: string;
  is_recurring: boolean;
  calendarEventId?: string;
  createdAt: number;
}

export interface ExtractedBoletoInfo {
  title: string;
  amount: number;
  dueDate: string;
  barcode?: string;
  category: string;
}

export interface GoogleAuthState {
  isSignedIn: boolean;
  user: any | null;
  error: string | null;
}
