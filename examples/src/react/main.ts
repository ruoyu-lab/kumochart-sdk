import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './react.css';

const element = document.getElementById('app');

if (!element) {
  throw new Error('The page has no #app element.');
}

createRoot(element).render(createElement(StrictMode, null, createElement(App)));
