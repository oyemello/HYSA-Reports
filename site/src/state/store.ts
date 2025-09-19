import { create } from 'zustand';
import type { LatestData, LoadState } from '../types';
import { fetchLatestData } from '../lib/api';

interface DashboardState {
  data: LatestData | null;
  status: LoadState;
  error?: string;
  selectedBanks: string[];
  showFed: boolean;
  onboardingComplete: boolean;
  llmProvider: 'Gemini';
  primaryBank: string;
  actions: {
    initialize: () => Promise<void>;
    toggleBank: (bank: string) => void;
    clearBankFilters: () => void;
    setShowFed: (value: boolean) => void;
    completeOnboarding: () => void;
  };
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  data: null,
  status: 'idle',
  selectedBanks: [],
  showFed: true,
  onboardingComplete: false,
  llmProvider: 'Gemini',
  primaryBank: 'American Express',
  actions: {
    initialize: async () => {
      set({ status: 'loading', error: undefined });
      try {
        const payload = await fetchLatestData();
        set({ data: payload, status: 'ready' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load data';
        set({ status: 'error', error: message });
      }
    },
    toggleBank: (bank: string) => {
      const { selectedBanks } = get();
      if (selectedBanks.includes(bank)) {
        set({ selectedBanks: selectedBanks.filter((item) => item !== bank) });
      } else {
        set({ selectedBanks: [...selectedBanks, bank] });
      }
    },
    clearBankFilters: () => set({ selectedBanks: [] }),
    setShowFed: (value: boolean) => set({ showFed: value }),
    completeOnboarding: () => set({ onboardingComplete: true }),
  },
}));
