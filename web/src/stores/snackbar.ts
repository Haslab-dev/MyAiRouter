import { create } from 'zustand'

export type SnackbarType = 'success' | 'info' | 'error'

interface SnackbarState {
  show: boolean
  message: string
  type: SnackbarType
  notify: (message: string, type?: SnackbarType) => void
  dismiss: () => void
}

let timerId: ReturnType<typeof setTimeout> | null = null

export const useSnackbar = create<SnackbarState>((set) => ({
  show: false,
  message: '',
  type: 'info',

  notify: (message, type = 'info') => {
    if (timerId) clearTimeout(timerId)
    set({ show: true, message, type })
    timerId = setTimeout(() => {
      set({ show: false })
      timerId = null
    }, 4000)
  },

  dismiss: () => {
    if (timerId) clearTimeout(timerId)
    timerId = null
    set({ show: false })
  },
}))
