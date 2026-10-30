-- Add "needs verification" state for optimization tasks
ALTER TYPE "OptimizationStatus" ADD VALUE IF NOT EXISTS 'NEEDS_VERIFICATION';
