import { create } from 'zustand';

let _timerId = null;

export const useSnackbar = create((set) => ({
  show: false,
  message: '',
  type: 'info', // 'success' | 'info' | 'error'

  notify: (message, type = 'info') => {
    if (_timerId) clearTimeout(_timerId);
    set({ show: true, message, type });
    _timerId = setTimeout(() => {
      set({ show: false });
      _timerId = null;
    }, 4000);
  },

  dismiss: () => {
    if (_timerId) clearTimeout(_timerId);
    _timerId = null;
    set({ show: false });
  },
}));
