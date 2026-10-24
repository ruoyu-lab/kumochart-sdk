import { deepFreeze } from '../utils/merge';
import type { Theme } from './types';

export const darkTheme: Theme = deepFreeze({
  background: '#0e0e0e',
  text: '#d8d8d8',
  textMuted: '#9b9b9b',
  grid: 'rgba(140, 140, 140, 0.085)',
  border: 'rgba(140, 140, 140, 0.17)',
  crosshair: 'rgba(216, 216, 216, 0.45)',
  crosshairLabelBackground: '#2a2a2a',
  crosshairLabelText: '#f2f2f2',
  up: '#2fb57e',
  down: '#ef5d5d',
  volumeUp: 'rgba(47, 181, 126, 0.4)',
  volumeDown: 'rgba(239, 93, 93, 0.4)',
  accent: '#3a74dc',
  palette: ['#e8b04a', '#5b9cf0', '#b48cf0', '#3cc4b0', '#ef7d8e', '#9fcf4a', '#ee8a3c', '#d77fd8'],
  buy: '#2fb57e',
  sell: '#ef5d5d',
  alert: '#e3a33b'
});

export const lightTheme: Theme = deepFreeze({
  background: '#ffffff',
  text: '#1c2433',
  textMuted: '#6b7485',
  grid: 'rgba(28, 36, 51, 0.06)',
  border: 'rgba(28, 36, 51, 0.12)',
  crosshair: 'rgba(28, 36, 51, 0.42)',
  crosshairLabelBackground: '#1c2433',
  crosshairLabelText: '#ffffff',
  up: '#14a37f',
  down: '#e5484d',
  volumeUp: 'rgba(20, 163, 127, 0.32)',
  volumeDown: 'rgba(229, 72, 77, 0.32)',
  accent: '#4f46e5',
  palette: ['#f59e0b', '#4f46e5', '#0891b2', '#db2777', '#65a30d', '#9333ea', '#ea580c', '#0d9488'],
  buy: '#14a37f',
  sell: '#e5484d',
  alert: '#f59e0b'
});
