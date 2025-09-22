import { z } from 'zod';

export const narrativeSchema = z.object({
  title: z.string().min(4),
  period: z.string().min(4),
  bank: z.string().min(2),
  metrics: z.object({
    top_hysa_apy: z.number(),
    peer_median_apy: z.number(),
    peer_p75_apy: z.number(),
    effr: z.number(),
    spread_vs_median_bps: z.number(),
  }),
  highlights: z.array(z.string()).min(3).max(6),
  benchmarking: z.string().min(10),
  forecast_insights: z.string().min(10),
  recommendations: z.array(z.string()).min(2).max(5),
  risks: z.array(z.string()).min(2).max(5),
  compliance: z.string().min(6),
});

export type Narrative = z.infer<typeof narrativeSchema>;
