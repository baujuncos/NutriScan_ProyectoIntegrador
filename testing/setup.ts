import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom no implementa scrollTo (usado por Modal.tsx para restaurar el scroll
// del body al cerrar) — sin esto, cada test que monta un modal logea "Not
// implemented: Window's scrollTo()" como ruido.
window.scrollTo = vi.fn();

afterEach(() => {
  cleanup();
});
