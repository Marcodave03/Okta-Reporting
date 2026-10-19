'use client';
import { createContext, useContext } from 'react';
import type { SessionUser } from '@/lib/jwt';

export const UserCtx = createContext<SessionUser>({ sub: '', email: '', name: '', role: 'reviewer' });
export const useUser = () => useContext(UserCtx);
export const useIsAdmin = () => useContext(UserCtx).role === 'admin';
