export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'admin';
}

export interface SellerRates {
  rate1kg: number;
  rate2kg: number;
  rate3kg: number;
}

export interface SellerUser {
  id: string;
  name: string;
  email: string;
  password: string;
  rates: SellerRates;
  active: boolean;
  role: 'seller';
  createdAt: string;
}

export interface AgentUser {
  id: string;
  name: string;
  email: string;
  password: string;
  phone: string;
  active: boolean;
  role: 'agent';
  createdAt: string;
}

export type AppUser = AdminUser | SellerUser | AgentUser;

export const mockAdmin: AdminUser = {
  id: 'admin-1',
  name: 'Admin Principal',
  email: 'admin@codmanager.com',
  role: 'admin',
};

export const mockSellers: SellerUser[] = [
  {
    id: 'seller-1',
    name: 'Youssef Amrani',
    email: 'youssef@gmail.com',
    password: 'seller123',
    rates: { rate1kg: 35, rate2kg: 45, rate3kg: 55 },
    active: true,
    role: 'seller',
    createdAt: '2024-01-15',
  },
  {
    id: 'seller-2',
    name: 'Fatima Zahra',
    email: 'fatima.z@gmail.com',
    password: 'seller456',
    rates: { rate1kg: 30, rate2kg: 40, rate3kg: 50 },
    active: false,
    role: 'seller',
    createdAt: '2024-02-20',
  },
];

export const mockAgents: AgentUser[] = [
  {
    id: 'agent-1',
    name: 'Sara Bennani',
    email: 'sara.b@gmail.com',
    password: 'agent123',
    phone: '+212 6 12 34 56 78',
    active: true,
    role: 'agent',
    createdAt: '2024-03-10',
  },
  {
    id: 'agent-2',
    name: 'Karim El Idrissi',
    email: 'karim.e@gmail.com',
    password: 'agent456',
    phone: '+212 6 98 76 54 32',
    active: true,
    role: 'agent',
    createdAt: '2024-04-05',
  },
];
